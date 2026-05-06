/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 *
 * Uses well_known: client identifier prefix, signed Request Objects,
 * direct_post.jwt with ephemeral keys, and a verifier-controlled response endpoint.
 * Supports same-device (popup) and cross-device (QR) flows.
 */

import { generateKeyPair, exportJWK, importJWK, compactDecrypt, type JWK, type KeyLike } from 'jose';
import {
  SMART_HEALTH_CHECKIN_CREDENTIAL_ID,
  artifactValuesByItem,
  artifactsByItem,
  buildSmartHealthCheckinDCQLQuery,
  extractSmartHealthCheckinResponse,
  validateResponseAgainstRequest,
  validateSmartHealthCheckinRequest,
  type DCQLQuery,
  type SmartArtifact,
  type SmartHealthCheckinRequest,
  type SmartHealthCheckinResponse,
} from './smart-health-checkin-protocol';

export * from './smart-health-checkin-protocol';

// ============================================================================
// Types
// ============================================================================

export interface VPToken {
  [credentialId: string]: SmartHealthCheckinResponse[];
}

export interface RawResponse {
  state: string;
  vp_token: VPToken;
  smartResponse: SmartHealthCheckinResponse;
}

export interface RehydratedResponse extends RawResponse {
  artifactsByItem: {
    [itemId: string]: SmartArtifact[];
  };
  credentials: {
    [credentialId: string]: unknown[];
  };
}

export interface ClientMetadata {
  jwks: { keys: object[] };
  encrypted_response_enc_values_supported: string[];
}

export interface RequestOptions {
  /** URL of the health app picker/check-in page */
  walletUrl: string;
  /** Bare HTTPS origin of the Verifier */
  wellKnownClientUrl: string;
  /** Flow mode: same-device (popup) or cross-device (QR) */
  flow?: 'same-device' | 'cross-device';
  /** Same-device browser handoff strategy. Defaults to opening the picker in a popup. */
  sameDeviceLaunch?: 'popup' | 'replace';
  /** Callback invoked when OID4VP request is constructed */
  onRequestStart?: (info: RequestStartInfo) => void;
  /** If true (default), response includes rehydrated credentials object */
  rehydrate?: boolean;
  /** Optional requester-side timeout in milliseconds. Omit to wait indefinitely. */
  timeout?: number;
}

export interface RequestStartInfo {
  flow: 'same-device' | 'cross-device';
  /** Transport-neutral SMART clinical request carried inside OID4VP */
  smart_request: SmartHealthCheckinRequest;
  /** OID4VP DCQL profile wrapper for the SMART clinical request */
  dcql_query: DCQLQuery;
  /** The protocol-level bootstrap request (what the wallet/picker sees) */
  bootstrap: {
    client_id: string;
    request_uri: string;
  };
  /** OID4VP Request Object JWT payload served from request_uri */
  request_object_claims: Record<string, unknown>;
  /** Full launch URL including bootstrap params */
  launch_url: string;
  /** Shim-internal transaction state (not sent to wallet) */
  transaction: {
    transaction_id: string;
    request_id: string;
    handoff_id?: string;
  };
}

export interface SameDeviceRedirectResult {
  requestInfo: RequestStartInfo;
  response: RawResponse | RehydratedResponse;
}

export interface SHLError extends Error {
  code: string;
  state: string;
}

// ============================================================================
// Utilities
// ============================================================================

function generateRandomHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateEphemeralKeyPair() {
  const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  publicJwk.use = 'enc';
  publicJwk.alg = 'ECDH-ES';
  privateJwk.use = 'enc';
  privateJwk.alg = 'ECDH-ES';
  return { publicKey, privateKey, publicJwk, privateJwk };
}

async function decryptJwe(jwe: string, privateKey: KeyLike): Promise<unknown> {
  const { plaintext } = await compactDecrypt(jwe, privateKey);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ============================================================================
// Transaction helpers
// ============================================================================

interface TransactionInit {
  transaction_id: string;
  request_id: string;
  request_uri: string;
  request_object_claims: Record<string, unknown>;
}

async function initTransaction(
  wellKnownClientUrl: string,
  flow: 'same-device' | 'cross-device',
  params: {
    redirect_uri?: string;
    ephemeral_pub_jwk: object;
    smart_health_checkin_request: SmartHealthCheckinRequest;
  }
): Promise<TransactionInit> {
  const resp = await fetch(`${wellKnownClientUrl}/oid4vp/${flow}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'same-origin',
  });
  if (!resp.ok) throw new Error(`Failed to init transaction: ${resp.status}`);
  return resp.json() as Promise<TransactionInit>;
}

async function fetchResult(
  wellKnownClientUrl: string,
  flow: 'same-device' | 'cross-device',
  params: { transaction_id: string; response_code?: string }
): Promise<string> {
  const resp = await fetch(`${wellKnownClientUrl}/oid4vp/${flow}/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    credentials: 'same-origin',
  });
  if (!resp.ok) throw new Error(`Result fetch error: ${resp.status}`);
  const data = await resp.json() as { status: string; response?: string };
  if (data.status === 'complete' && data.response) return data.response;
  if (data.status === 'pending') throw new Error('pending');
  throw new Error('Unexpected result status: ' + data.status);
}

/**
 * Wait for response_code via BroadcastChannel.
 * The return page broadcasts on a channel named after the redirect_uri's origin+path,
 * which the shim knows because it set the redirect_uri.
 */
function waitForResponseCode(channelName: string, timeout?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const bc = new BroadcastChannel(channelName);
    const timer = timeout
      ? setTimeout(() => {
          bc.close();
          reject(new Error('Timeout waiting for response_code'));
        }, timeout)
      : undefined;

    bc.onmessage = (event: MessageEvent) => {
      if (event.data?.response_code) {
        if (timer) clearTimeout(timer);
        bc.close();
        resolve(event.data.response_code);
      }
    };
  });
}

const HANDOFF_STORAGE_PREFIX = 'smart-health-checkin:handoff:';
const HANDOFF_STALE_MS = 10 * 60 * 1000;

interface StoredSameDeviceHandoff {
  version: 1;
  created_at: number;
  handoff_id: string;
  well_known_client_url: string;
  private_jwk: JWK;
  rehydrate: boolean;
  request_info: RequestStartInfo;
  smart_request: SmartHealthCheckinRequest;
}

function storageKey(handoffId: string): string {
  return `${HANDOFF_STORAGE_PREFIX}${handoffId}`;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function pruneStoredHandoffs(storage: Storage, now = Date.now()) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (!key?.startsWith(HANDOFF_STORAGE_PREFIX)) continue;
    try {
      const item = JSON.parse(storage.getItem(key) || '{}') as { created_at?: number };
      if (!item.created_at || now - item.created_at > HANDOFF_STALE_MS) {
        storage.removeItem(key);
      }
    } catch {
      storage.removeItem(key);
    }
  }
}

function storeSameDeviceHandoff(handoff: StoredSameDeviceHandoff) {
  const storage = getLocalStorage();
  if (!storage) throw new Error('Browser storage unavailable for same-device handoff');
  pruneStoredHandoffs(storage);
  storage.setItem(storageKey(handoff.handoff_id), JSON.stringify(handoff));
}

function takeSameDeviceHandoff(handoffId: string): StoredSameDeviceHandoff {
  const storage = getLocalStorage();
  if (!storage) throw new Error('Browser storage unavailable for same-device handoff');
  pruneStoredHandoffs(storage);

  const key = storageKey(handoffId);
  const raw = storage.getItem(key);
  if (!raw) throw new Error('No pending same-device handoff found for this return');

  const handoff = JSON.parse(raw) as StoredSameDeviceHandoff;
  if (handoff.version !== 1 || handoff.handoff_id !== handoffId) {
    storage.removeItem(key);
    throw new Error('Invalid same-device handoff state');
  }
  if (Date.now() - handoff.created_at > HANDOFF_STALE_MS) {
    storage.removeItem(key);
    throw new Error('Same-device handoff expired');
  }
  return handoff;
}

function clearSameDeviceHandoff(handoffId: string) {
  getLocalStorage()?.removeItem(storageKey(handoffId));
}

function broadcastHandoffState(handoffId: string, type: 'complete' | 'inactive') {
  if (typeof BroadcastChannel === 'undefined') return;
  const bc = new BroadcastChannel(`shc-handoff-${handoffId}`);
  bc.postMessage({ type });
  bc.close();
}

function currentRequesterUrl(handoffId?: string): string {
  const url = new URL(location.pathname, location.origin);
  if (handoffId) url.searchParams.set('shc_handoff', handoffId);
  return url.toString();
}

function cleanReturnUrl() {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.delete('shc_handoff');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function responseCodeFromHash(): string | null {
  return new URLSearchParams(window.location.hash.substring(1)).get('response_code');
}

function handoffIdFromSearch(): string | null {
  return new URLSearchParams(window.location.search).get('shc_handoff');
}

// ============================================================================
// Core Functions
// ============================================================================

export function rehydrateResponse(response: RawResponse): RehydratedResponse {
  return {
    ...response,
    artifactsByItem: artifactsByItem(response.smartResponse),
    credentials: artifactValuesByItem(response.smartResponse),
  };
}

async function decryptAndProcess(
  jweString: string,
  privateKey: KeyLike,
  expectedState: string,
  shouldRehydrate: boolean,
  smartRequest: SmartHealthCheckinRequest
): Promise<RawResponse | RehydratedResponse> {
  const decrypted = await decryptJwe(jweString, privateKey) as {
    state: string;
    vp_token?: VPToken;
    error?: string;
    error_description?: string;
  };

  if (decrypted.state !== expectedState) {
    throw new Error('State mismatch in decrypted response');
  }

  if (decrypted.error) {
    const err = new Error(decrypted.error_description || decrypted.error) as unknown as SHLError;
    err.code = decrypted.error;
    err.state = decrypted.state;
    throw err;
  }

  if (!decrypted.vp_token) throw new Error('No vp_token in decrypted response');

  const smartResponseResult = extractSmartHealthCheckinResponse(decrypted.vp_token, SMART_HEALTH_CHECKIN_CREDENTIAL_ID);
  if (!smartResponseResult.ok) throw new Error(smartResponseResult.error);

  const validation = validateResponseAgainstRequest(smartRequest, smartResponseResult.value);
  if (!validation.ok) throw new Error(`SMART Health Check-in response validation failed: ${validation.error}`);

  const response: RawResponse = {
    state: decrypted.state,
    vp_token: decrypted.vp_token,
    smartResponse: validation.value,
  };
  return shouldRehydrate ? rehydrateResponse(response) : response;
}

/**
 * Initiate a SMART Health Check-in credential request.
 */
export async function request(
  smartRequest: SmartHealthCheckinRequest,
  opts: RequestOptions
): Promise<RawResponse | RehydratedResponse> {
  const walletUrl = opts.walletUrl.replace(/\/+$/, '');
  const wellKnownClientUrl = opts.wellKnownClientUrl.replace(/\/+$/, '');
  if (!walletUrl) throw new Error('walletUrl required');
  if (!wellKnownClientUrl) throw new Error('wellKnownClientUrl required');

  const requestValidation = validateSmartHealthCheckinRequest(smartRequest);
  if (!requestValidation.ok) throw new Error(`Invalid SMART Health Check-in request: ${requestValidation.error}`);
  const validatedSmartRequest = requestValidation.value;
  const dcqlQuery = buildSmartHealthCheckinDCQLQuery(validatedSmartRequest);

  const flow = opts.flow || 'same-device';
  const shouldRehydrate = opts.rehydrate !== false;
  const timeout = opts.timeout;
  const sameDeviceLaunch = opts.sameDeviceLaunch || 'popup';
  const handoffId = flow === 'same-device' && sameDeviceLaunch === 'replace'
    ? generateRandomHex()
    : undefined;

  // Generate ephemeral key pair for E2E encryption
  const { privateKey, privateJwk, publicJwk } = await generateEphemeralKeyPair();

  // Determine redirect_uri for same-device (the requester's own page)
  const redirect_uri = flow === 'same-device'
    ? currentRequesterUrl(handoffId)
    : undefined;

  // Initialize transaction with verifier backend
  const txn = await initTransaction(wellKnownClientUrl, flow, {
    redirect_uri,
    ephemeral_pub_jwk: publicJwk,
    smart_health_checkin_request: validatedSmartRequest,
  });

  // Build minimal bootstrap URL
  const client_id = `well_known:${wellKnownClientUrl}`;
  const bootstrapParams = new URLSearchParams({
    client_id,
    request_uri: txn.request_uri,
  });
  if (handoffId) {
    bootstrapParams.set('shc_launch', 'replace');
    bootstrapParams.set('shc_handoff', handoffId);
  }
  const launch_url = `${walletUrl}/?${bootstrapParams.toString()}`;
  const requestInfo: RequestStartInfo = {
    flow,
    smart_request: validatedSmartRequest,
    dcql_query: dcqlQuery,
    bootstrap: {
      client_id,
      request_uri: txn.request_uri,
    },
    request_object_claims: txn.request_object_claims,
    launch_url,
    transaction: {
      transaction_id: txn.transaction_id,
      request_id: txn.request_id,
      handoff_id: handoffId,
    },
  };

  if (opts.onRequestStart) {
    opts.onRequestStart(requestInfo);
  }

  if (flow === 'same-device') {
    if (sameDeviceLaunch === 'replace') {
      if (!handoffId) throw new Error('Missing same-device handoff id');
      storeSameDeviceHandoff({
        version: 1,
        created_at: Date.now(),
        handoff_id: handoffId,
        well_known_client_url: wellKnownClientUrl,
        private_jwk: privateJwk,
        rehydrate: shouldRehydrate,
        request_info: requestInfo,
        smart_request: validatedSmartRequest,
      });
      location.replace(launch_url);
      return new Promise<RawResponse | RehydratedResponse>(() => {
        // The current document is navigating away; the redirect landing page resumes the transaction.
      });
    }

    const popup = window.open(launch_url, '_blank');
    if (!popup) throw new Error('Popup blocked - please allow popups for this site');

    try {
      const channelName = `shc-return-${redirect_uri}`;
      const response_code = await waitForResponseCode(channelName, timeout);
      const jweString = await fetchResult(wellKnownClientUrl, flow, {
        transaction_id: txn.transaction_id,
        response_code,
      });
      return decryptAndProcess(jweString, privateKey, txn.request_id, shouldRehydrate, validatedSmartRequest);
    } finally {
      try { if (popup && !popup.closed) popup.close(); } catch { /* ignore */ }
    }
  } else {
    // Cross-device: caller renders launch_url as QR via onRequestStart
    // Long-poll for result. The relay can return "pending" after a single
    // long-poll interval, but the requester app should not impose its own
    // deadline unless the caller explicitly provided one.
    const deadline = timeout ? Date.now() + timeout : undefined;
    while (!deadline || Date.now() < deadline) {
      try {
        const jweString = await fetchResult(wellKnownClientUrl, flow, {
          transaction_id: txn.transaction_id,
        });
        return decryptAndProcess(jweString, privateKey, txn.request_id, shouldRehydrate, validatedSmartRequest);
      } catch (err) {
        if (err instanceof Error && err.message === 'pending') continue;
        throw err;
      }
    }
    throw new Error('Request timed out');
  }
}

/**
 * Resume a same-device redirect that was launched with sameDeviceLaunch: "replace".
 * The redirected requester page takes over the session by redeeming response_code
 * with handoff state that was parked before navigation to the picker.
 */
export async function completeSameDeviceRedirect(): Promise<SameDeviceRedirectResult | null> {
  const response_code = responseCodeFromHash();
  const handoffId = handoffIdFromSearch();
  if (!response_code || !handoffId) return null;

  const handoff = takeSameDeviceHandoff(handoffId);
  const privateKey = await importJWK(handoff.private_jwk, 'ECDH-ES') as KeyLike;
  const jweString = await fetchResult(handoff.well_known_client_url, 'same-device', {
    transaction_id: handoff.request_info.transaction.transaction_id,
    response_code,
  });
  const response = await decryptAndProcess(
    jweString,
    privateKey,
    handoff.request_info.transaction.request_id,
    handoff.rehydrate,
    handoff.smart_request
  );

  clearSameDeviceHandoff(handoffId);
  cleanReturnUrl();
  broadcastHandoffState(handoffId, 'complete');

  return {
    requestInfo: handoff.request_info,
    response,
  };
}

/**
 * Handle return context in popup window.
 * Detects #response_code in the hash, signals the opener via postMessage.
 */
export async function maybeHandleReturn(): Promise<boolean> {
  const responseCode = responseCodeFromHash();

  if (responseCode) {
    if (handoffIdFromSearch()) return false;

    // Broadcast on a channel keyed by this page's URL (without the hash)
    const pageUrl = new URL(location.pathname, location.origin).toString();
    const bc = new BroadcastChannel(`shc-return-${pageUrl}`);
    bc.postMessage({ response_code: responseCode });
    bc.close();
    location.hash = '';
    window.close();
    return true;
  }

  if (window.opener) {
    window.close();
    return true;
  }
  return false;
}

// ============================================================================
// Browser Global (for <script> tag usage)
// ============================================================================

declare global {
  interface Window {
    SmartHealthCheckin?: {
      request: typeof request;
      completeSameDeviceRedirect: typeof completeSameDeviceRedirect;
      maybeHandleReturn: typeof maybeHandleReturn;
      rehydrateResponse: typeof rehydrateResponse;
    };
  }
}

if (typeof window !== 'undefined') {
  window.SmartHealthCheckin = { request, completeSameDeviceRedirect, maybeHandleReturn, rehydrateResponse };
}
