/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 * Uses direct_post.jwt with ephemeral keys to a zero-trust relay for E2E encryption
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

/**
 * Artifact type identifiers for credential data
 * - "fhir_resource": A FHIR resource object (e.g., Coverage, Patient)
 * - "shc": A SMART Health Card (compact JWS format)
 * - "shl": A SMART Health Link (shlink:/ URI)
 */
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
  /** Base URL of the zero-trust relay server */
  relayUrl: string;
  /** Callback invoked when OID4VP request is constructed */
  onRequestStart?: (params: OID4VPRequestParams) => void;
  /** If true (default), response includes rehydrated credentials object */
  rehydrate?: boolean;
  /** Request timeout in milliseconds (default: 120000) */
  timeout?: number;
}

export interface OID4VPRequestParams {
  client_id: string;
  response_type: 'vp_token';
  response_mode: 'direct_post.jwt';
  response_uri: string;
  client_metadata: ClientMetadata;
  state: string;
  nonce: string;
  dcql_query: DCQLQuery;
}

export interface SHLError extends Error {
  code: string;
  state: string;
}

// ============================================================================
// Utilities
// ============================================================================

/** Generate 128-bit random hex string */
function generateRandomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate ephemeral ECDH-ES P-256 key pair for JWE encryption */
async function generateEphemeralKeyPair() {
  const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256' });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.use = 'enc';
  publicJwk.alg = 'ECDH-ES';
  return { publicKey, privateKey, publicJwk };
}

/** Decrypt a compact JWE string using the ephemeral private key */
async function decryptJwe(jwe: string, privateKey: KeyLike): Promise<unknown> {
  const { plaintext } = await compactDecrypt(jwe, privateKey);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** Create a relay session and return the session_id */
async function createRelaySession(relayUrl: string): Promise<string> {
  const resp = await fetch(`${relayUrl}/session`, { method: 'POST' });
  if (!resp.ok) throw new Error(`Failed to create relay session: ${resp.status}`);
  const data = await resp.json() as { session_id: string };
  return data.session_id;
}

/** Poll the relay until a response arrives or timeout */
async function pollRelay(relayUrl: string, sessionId: string, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout;
  const interval = 1000;
  while (Date.now() < deadline) {
    const resp = await fetch(`${relayUrl}/poll/${sessionId}`);
    if (!resp.ok) throw new Error(`Relay poll error: ${resp.status}`);
    const data = await resp.json() as { status: string; response?: string };
    if (data.status === 'complete' && data.response) {
      return data.response;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Request timeout: no response received from relay');
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Rehydrate vp_token by resolving inline references to actual data.
 * Two-pass resolution: catalog artifact_ids, then resolve artifact_refs.
 */
export function rehydrateResponse(response: RawResponse): RehydratedResponse {
  const credentials: { [id: string]: unknown[] } = {};
  const catalog = new Map<string, unknown>();

  // Pass 1: catalog artifact_ids
  for (const presentations of Object.values(response.vp_token)) {
    for (const p of presentations) {
      if ('type' in p && 'data' in p && 'artifact_id' in p && p.artifact_id) {
        catalog.set(p.artifact_id, (p as FullArtifactPresentation).data);
      }
    }
  }

  // Pass 2: resolve references
  for (const [id, presentations] of Object.entries(response.vp_token)) {
    credentials[id] = presentations.map(p => {
      if ('artifact_ref' in p) {
        return catalog.get((p as RefArtifactPresentation).artifact_ref);
      }
      return (p as FullArtifactPresentation).data;
    });
  }

  return { ...response, credentials };
}

/**
 * Initiate a SMART Health Check-in credential request
 * Uses direct_post.jwt with ephemeral keys and a zero-trust relay
 */
export async function request(
  dcqlQuery: DCQLQuery,
  opts: RequestOptions
): Promise<RawResponse | RehydratedResponse> {
  const checkinBase = opts.checkinBase.replace(/\/+$/, '');
  const relayUrl = opts.relayUrl.replace(/\/+$/, '');
  if (!checkinBase) throw new Error('checkinBase required');
  if (!relayUrl) throw new Error('relayUrl required');

  if (!dcqlQuery || !Array.isArray(dcqlQuery.credentials)) {
    throw new Error('dcqlQuery must be an object with a credentials array');
  }

  const state = generateRandomState();
  const nonce = generateRandomState();
  const shouldRehydrate = opts.rehydrate !== false;
  const timeout = opts.timeout ?? 2 * 60 * 1000;

  // Generate ephemeral key pair for E2E encryption
  const { privateKey, publicJwk } = await generateEphemeralKeyPair();

  // Create relay session
  const sessionId = await createRelaySession(relayUrl);

  // Build OID4VP request
  const redirectUrl = new URL(location.href);
  redirectUrl.hash = '';
  const redirectUri = redirectUrl.toString();
  const clientId = `redirect_uri:${redirectUri}`;

  const responseUri = `${relayUrl}/post/${sessionId}`;
  const clientMetadata: ClientMetadata = {
    jwks: { keys: [publicJwk] },
    encrypted_response_enc_values_supported: ['A256GCM']
  };

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'vp_token',
    response_mode: 'direct_post.jwt',
    response_uri: responseUri,
    client_metadata: JSON.stringify(clientMetadata),
    nonce,
    state,
    dcql_query: JSON.stringify(dcqlQuery)
  });

  if (opts.onRequestStart) {
    opts.onRequestStart({
      client_id: clientId,
      response_type: 'vp_token',
      response_mode: 'direct_post.jwt',
      response_uri: responseUri,
      client_metadata: clientMetadata,
      state,
      nonce,
      dcql_query: dcqlQuery
    });
  }

  const url = `${checkinBase}/?${params.toString()}`;
  const popup = window.open(url, '_blank');

  if (!popup) {
    throw new Error('Popup blocked - please allow popups for this site');
  }

  try {
    // Poll relay for encrypted response
    const jweString = await pollRelay(relayUrl, sessionId, timeout);

    // Decrypt JWE using ephemeral private key
    const decrypted = await decryptJwe(jweString, privateKey) as {
      state: string;
      vp_token?: VPToken;
      error?: string;
      error_description?: string;
    };

    // Validate state
    if (decrypted.state !== state) {
      throw new Error('State mismatch in decrypted response');
    }

    // Handle error responses
    if (decrypted.error) {
      const err = new Error(decrypted.error_description || decrypted.error) as unknown as SHLError;
      err.code = decrypted.error;
      err.state = decrypted.state;
      throw err;
    }

    if (!decrypted.vp_token) {
      throw new Error('No vp_token in decrypted response');
    }

    const response: RawResponse = {
      state: decrypted.state,
      vp_token: decrypted.vp_token
    };

    return shouldRehydrate ? rehydrateResponse(response) : response;
  } finally {
    try {
      if (popup && !popup.closed) popup.close();
    } catch { /* ignore */ }
  }
}

/**
 * Handle return context in popup window.
 * With direct_post.jwt, data flows through the relay, not the fragment.
 * This function is retained for popup cleanup only.
 */
export async function maybeHandleReturn(): Promise<boolean> {
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
  window.SHL = {
    request,
    maybeHandleReturn,
    rehydrateResponse
  };
}
