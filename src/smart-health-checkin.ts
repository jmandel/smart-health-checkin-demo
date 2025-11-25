/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 */

// ============================================================================
// Types
// ============================================================================

export interface CredentialQuery {
  id: string;
  format: 'smart_artifact';
  optional?: boolean;
  require_cryptographic_holder_binding?: boolean;
  meta: {
    profile?: string;
    questionnaire?: object;
    questionnaireUrl?: string;
    signing_strategy?: string[];
  };
}

export interface DCQLQuery {
  credentials: CredentialQuery[];
}

/**
 * Artifact type identifiers for credential data
 * - "fhir_resource": A FHIR resource object (e.g., Coverage, Patient)
 * - "shc": A SMART Health Card (compact JWS format)
 * - "shl": A SMART Health Link (shlink:/ URI)
 */
export type ArtifactType = 'fhir_resource' | 'shc' | 'shl';

export interface Artifact {
  type: ArtifactType;
  data: unknown;
}

export interface Presentation {
  artifact: number;
}

export interface VPToken {
  [credentialId: string]: Presentation[];
}

export interface RawResponse {
  state: string;
  vp_token: VPToken;
  smart_artifacts: Artifact[];
}

export interface RehydratedResponse extends RawResponse {
  credentials: {
    [credentialId: string]: unknown[];
  };
}

export interface RequestOptions {
  /** URL of the health app picker/check-in page */
  checkinBase: string;
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
  response_mode: 'fragment';
  state: string;
  nonce: string;
  dcql_query: DCQLQuery;
}

export interface SHLError extends Error {
  code: string;
  state: string;
}

export interface ParsedReturnSuccess {
  type: 'success';
  state: string;
  vp_token: VPToken;
  smart_artifacts: Artifact[];
}

export interface ParsedReturnError {
  type: 'error';
  state: string;
  error: string;
  error_description?: string;
}

export type ParsedReturn = ParsedReturnSuccess | ParsedReturnError | null;

export interface HandleReturnOptions {
  /** If false, skip rendering UI (just broadcast and return) */
  renderUI?: boolean;
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

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse URL hash for OID4VP return parameters
 * Pure function - no side effects
 */
export function parseReturnHash(hash: string): ParsedReturn {
  if (!hash || hash === '#') return null;

  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const p = new URLSearchParams(h);
  const state = p.get('state');

  if (!state) return null;

  const error = p.get('error');
  if (error) {
    return {
      type: 'error',
      state,
      error,
      error_description: p.get('error_description') || undefined
    };
  }

  const vpToken = p.get('vp_token');
  const smartArtifacts = p.get('smart_artifacts');

  if (vpToken && smartArtifacts) {
    return {
      type: 'success',
      state,
      vp_token: JSON.parse(vpToken),
      smart_artifacts: JSON.parse(smartArtifacts)
    };
  }

  return null;
}

/**
 * Broadcast response to waiting request via BroadcastChannel
 */
export function broadcastResponse(state: string, data: object): void {
  const bc = new BroadcastChannel('shl-' + state);
  bc.postMessage({ state, ...data });
  bc.close();
}

/**
 * Rehydrate vp_token by resolving artifact indices to actual data
 */
export function rehydrateResponse(response: RawResponse): RehydratedResponse {
  const credentials: { [id: string]: unknown[] } = {};

  for (const [id, presentations] of Object.entries(response.vp_token)) {
    credentials[id] = presentations.map(presentation => {
      const artifact = response.smart_artifacts[presentation.artifact];
      return artifact?.data !== undefined ? artifact.data : artifact;
    });
  }

  return {
    ...response,
    credentials
  };
}

/**
 * Initiate a SMART Health Check-in credential request
 */
export async function request(
  dcqlQuery: DCQLQuery,
  opts: RequestOptions
): Promise<RawResponse | RehydratedResponse> {
  const checkinBase = opts.checkinBase.replace(/\/+$/, '');
  if (!checkinBase) {
    throw new Error('checkinBase required');
  }

  if (!dcqlQuery || !Array.isArray(dcqlQuery.credentials)) {
    throw new Error('dcqlQuery must be an object with a credentials array');
  }

  const state = generateRandomState();
  const nonce = generateRandomState();
  const shouldRehydrate = opts.rehydrate !== false;
  const timeout = opts.timeout ?? 2 * 60 * 1000;

  const chan = new BroadcastChannel('shl-' + state);
  let popup: Window | null = null;

  const done = new Promise<RawResponse | RehydratedResponse>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Request timeout'));
    }, timeout);

    chan.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || msg.state !== state) return;

      // Handle error responses
      if (msg.error) {
        cleanup();
        const err = new Error(msg.error_description || msg.error) as SHLError;
        err.code = msg.error;
        err.state = msg.state;
        reject(err);
        return;
      }

      // Handle success responses
      if (msg.vp_token && msg.smart_artifacts) {
        cleanup();
        const response: RawResponse = {
          state: msg.state,
          vp_token: msg.vp_token,
          smart_artifacts: msg.smart_artifacts
        };
        resolve(shouldRehydrate ? rehydrateResponse(response) : response);
      }
    };

    function cleanup() {
      clearTimeout(timeoutId);
      chan.close();
      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch {
        // Ignore errors closing popup
      }
    }
  });

  // Build OID4VP request
  const redirectUrl = new URL(location.href);
  redirectUrl.hash = '';
  const redirectUri = redirectUrl.toString();
  const clientId = `redirect_uri:${redirectUri}`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'vp_token',
    response_mode: 'fragment',
    nonce,
    state,
    dcql_query: JSON.stringify(dcqlQuery)
  });

  if (opts.onRequestStart) {
    opts.onRequestStart({
      client_id: clientId,
      response_type: 'vp_token',
      response_mode: 'fragment',
      state,
      nonce,
      dcql_query: dcqlQuery
    });
  }

  const url = `${checkinBase}/?${params.toString()}`;
  popup = window.open(url, '_blank');

  if (!popup) {
    chan.close();
    throw new Error('Popup blocked - please allow popups for this site');
  }

  return done;
}

/**
 * Render return UI in popup window
 */
export function renderReturnUI(success: boolean, message: string): void {
  document.body.textContent = '';
  const div = document.createElement('div');
  div.style.cssText = 'font-family:system-ui;padding:40px;text-align:center;background:#0f141c;color:#e9eef5;min-height:100vh';

  const h1 = document.createElement('h1');
  h1.style.cssText = success ? 'color:#4ade80' : 'color:#f87171';
  h1.textContent = success ? '✓ Shared' : '✗ Not Shared';

  const p = document.createElement('p');
  p.textContent = message;

  div.appendChild(h1);
  div.appendChild(p);
  document.body.appendChild(div);
}

/**
 * Handle return context in popup window
 * Call on page load to detect and process OID4VP responses
 * @returns true if this was a return context
 */
export async function maybeHandleReturn(opts: HandleReturnOptions = {}): Promise<boolean> {
  const renderUI = opts.renderUI !== false;
  const parsed = parseReturnHash(location.hash);

  if (!parsed) return false;

  if (parsed.type === 'error') {
    broadcastResponse(parsed.state, {
      error: parsed.error,
      error_description: parsed.error_description
    });

    if (renderUI) {
      renderReturnUI(false, parsed.error_description || parsed.error);
      window.close();
    }
    return true;
  }

  if (parsed.type === 'success') {
    broadcastResponse(parsed.state, {
      vp_token: parsed.vp_token,
      smart_artifacts: parsed.smart_artifacts
    });

    if (renderUI) {
      renderReturnUI(true, 'You can close this window.');
      window.close();
    }
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
      parseReturnHash: typeof parseReturnHash;
      rehydrateResponse: typeof rehydrateResponse;
    };
  }
}

if (typeof window !== 'undefined') {
  window.SHL = {
    request,
    maybeHandleReturn,
    parseReturnHash,
    rehydrateResponse
  };
}
