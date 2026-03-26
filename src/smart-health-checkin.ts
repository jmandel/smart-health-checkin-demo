/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 *
 * Uses well_known: client identifier prefix, signed Request Objects,
 * direct_post.jwt with ephemeral keys, and a verifier-controlled response endpoint.
 * Supports same-device (popup) and cross-device (QR) flows.
 */

import { generateKeyPair, exportJWK, compactDecrypt, type KeyLike } from 'jose';

// ============================================================================
// Types
// ============================================================================

export interface CredentialQuery {
  id: string;
  format: 'smart_artifact';
  require_cryptographic_holder_binding?: boolean;
  meta: {
    profile?: string;
    questionnaire?: object;
    questionnaireUrl?: string;
    signing_strategy?: string[];
  };
}

export interface CredentialSet {
  options: string[][];
  required: boolean;
}

export interface DCQLQuery {
  credentials: CredentialQuery[];
  credential_sets?: CredentialSet[];
}

export type ArtifactType = 'fhir_resource' | 'shc' | 'shl';

export interface FullArtifactPresentation {
  type: ArtifactType;
  data: unknown;
  artifact_id?: string;
}

export interface RefArtifactPresentation {
  artifact_ref: string;
}

export type Presentation = FullArtifactPresentation | RefArtifactPresentation;

export interface VPToken {
  [credentialId: string]: Presentation[];
}

export interface RawResponse {
  state: string;
  vp_token: VPToken;
}

export interface RehydratedResponse extends RawResponse {
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
  checkinBase: string;
  /** Bare HTTPS origin of the Verifier */
  verifierBase: string;
  /** Flow mode: same-device (popup) or cross-device (QR) */
  flow?: 'same-device' | 'cross-device';
  /** Callback invoked when OID4VP request is constructed */
  onRequestStart?: (info: RequestStartInfo) => void;
  /** If true (default), response includes rehydrated credentials object */
  rehydrate?: boolean;
  /** Request timeout in milliseconds (default: 120000) */
  timeout?: number;
}

export interface RequestStartInfo {
  flow: 'same-device' | 'cross-device';
  client_id: string;
  request_uri: string;
  launch_url: string;
  transaction_id: string;
  request_id: string;
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
  const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256' });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.use = 'enc';
  publicJwk.alg = 'ECDH-ES';
  return { publicKey, privateKey, publicJwk };
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
  read_secret: string;
  request_uri: string;
}

async function initTransaction(
  verifierBase: string,
  params: {
    flow: 'same-device' | 'cross-device';
    redirect_uri?: string;
    ephemeral_pub_jwk: object;
    dcql_query: DCQLQuery;
  }
): Promise<TransactionInit> {
  const resp = await fetch(`${verifierBase}/oid4vp/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Failed to init transaction: ${resp.status}`);
  return resp.json() as Promise<TransactionInit>;
}

async function fetchResult(
  verifierBase: string,
  params: { transaction_id: string; read_secret: string; response_code?: string }
): Promise<string> {
  const resp = await fetch(`${verifierBase}/oid4vp/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Result fetch error: ${resp.status}`);
  const data = await resp.json() as { status: string; response?: string };
  if (data.status === 'complete' && data.response) return data.response;
  if (data.status === 'pending') throw new Error('pending');
  throw new Error('Unexpected result status: ' + data.status);
}

function waitForResponseCode(transactionId: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const bc = new BroadcastChannel(`shc-return-${transactionId}`);
    const timer = setTimeout(() => {
      bc.close();
      reject(new Error('Timeout waiting for response_code'));
    }, timeout);

    bc.onmessage = (event: MessageEvent) => {
      if (event.data?.response_code) {
        clearTimeout(timer);
        bc.close();
        resolve(event.data.response_code);
      }
    };
  });
}

// ============================================================================
// Core Functions
// ============================================================================

export function rehydrateResponse(response: RawResponse): RehydratedResponse {
  const credentials: { [id: string]: unknown[] } = {};
  const catalog = new Map<string, unknown>();

  for (const presentations of Object.values(response.vp_token)) {
    for (const p of presentations) {
      if ('type' in p && 'data' in p && 'artifact_id' in p && p.artifact_id) {
        catalog.set(p.artifact_id, (p as FullArtifactPresentation).data);
      }
    }
  }

  for (const [id, presentations] of Object.entries(response.vp_token)) {
    credentials[id] = presentations.map(p => {
      if ('artifact_ref' in p) return catalog.get((p as RefArtifactPresentation).artifact_ref);
      return (p as FullArtifactPresentation).data;
    });
  }

  return { ...response, credentials };
}

async function decryptAndProcess(
  jweString: string,
  privateKey: KeyLike,
  expectedState: string,
  shouldRehydrate: boolean
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

  const response: RawResponse = { state: decrypted.state, vp_token: decrypted.vp_token };
  return shouldRehydrate ? rehydrateResponse(response) : response;
}

/**
 * Initiate a SMART Health Check-in credential request.
 */
export async function request(
  dcqlQuery: DCQLQuery,
  opts: RequestOptions
): Promise<RawResponse | RehydratedResponse> {
  const checkinBase = opts.checkinBase.replace(/\/+$/, '');
  const verifierBase = opts.verifierBase.replace(/\/+$/, '');
  if (!checkinBase) throw new Error('checkinBase required');
  if (!verifierBase) throw new Error('verifierBase required');

  if (!dcqlQuery || !Array.isArray(dcqlQuery.credentials)) {
    throw new Error('dcqlQuery must be an object with a credentials array');
  }

  const flow = opts.flow || 'same-device';
  const shouldRehydrate = opts.rehydrate !== false;
  const timeout = opts.timeout ?? 2 * 60 * 1000;

  // Generate ephemeral key pair for E2E encryption
  const { privateKey, publicJwk } = await generateEphemeralKeyPair();

  // Initialize transaction with verifier backend
  const txn = await initTransaction(verifierBase, {
    flow,
    redirect_uri: flow === 'same-device' ? `${verifierBase}/oid4vp/return` : undefined,
    ephemeral_pub_jwk: publicJwk,
    dcql_query: dcqlQuery,
  });

  // Build minimal bootstrap URL
  const client_id = `well_known:${verifierBase}`;
  const bootstrapParams = new URLSearchParams({
    client_id,
    request_uri: txn.request_uri,
    request_uri_method: 'post',
  });
  const launch_url = `${checkinBase}/?${bootstrapParams.toString()}`;

  if (opts.onRequestStart) {
    opts.onRequestStart({
      flow,
      client_id,
      request_uri: txn.request_uri,
      launch_url,
      transaction_id: txn.transaction_id,
      request_id: txn.request_id,
    });
  }

  if (flow === 'same-device') {
    const popup = window.open(launch_url, '_blank');
    if (!popup) throw new Error('Popup blocked - please allow popups for this site');

    try {
      const response_code = await waitForResponseCode(txn.transaction_id, timeout);
      const jweString = await fetchResult(verifierBase, {
        transaction_id: txn.transaction_id,
        read_secret: txn.read_secret,
        response_code,
      });
      return decryptAndProcess(jweString, privateKey, txn.request_id, shouldRehydrate);
    } finally {
      try { if (popup && !popup.closed) popup.close(); } catch { /* ignore */ }
    }
  } else {
    // Cross-device: caller renders launch_url as QR via onRequestStart
    // Long-poll for result
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const jweString = await fetchResult(verifierBase, {
          transaction_id: txn.transaction_id,
          read_secret: txn.read_secret,
        });
        return decryptAndProcess(jweString, privateKey, txn.request_id, shouldRehydrate);
      } catch (err) {
        if (err instanceof Error && err.message === 'pending') continue;
        throw err;
      }
    }
    throw new Error('Cross-device request timeout');
  }
}

/**
 * Handle return context in popup window.
 * Detects #response_code in the hash, signals the opener via postMessage.
 */
export async function maybeHandleReturn(): Promise<boolean> {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const responseCode = params.get('response_code');
  const transactionId = params.get('transaction_id');

  if (responseCode && transactionId) {
    const bc = new BroadcastChannel(`shc-return-${transactionId}`);
    bc.postMessage({ response_code: responseCode });
    bc.close();
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
    SHL?: {
      request: typeof request;
      maybeHandleReturn: typeof maybeHandleReturn;
      rehydrateResponse: typeof rehydrateResponse;
    };
  }
}

if (typeof window !== 'undefined') {
  window.SHL = { request, maybeHandleReturn, rehydrateResponse };
}
