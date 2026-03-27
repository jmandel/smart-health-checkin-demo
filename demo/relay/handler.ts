/**
 * OID4VP Relay Handler — reusable core for SMART Health Check-in
 *
 * Two categories of endpoints:
 *
 * Public (wallet-facing):
 *   GET  /.well-known/openid4vp-client
 *   GET  /.well-known/jwks.json
 *   POST /oid4vp/requests/:request_id      — signed Request Object
 *   POST /oid4vp/responses/:write_token    — wallet submits encrypted response
 *
 * Verifier-facing:
 *   POST /oid4vp/same-device/init
 *   POST /oid4vp/same-device/results
 *   POST /oid4vp/cross-device/init
 *   POST /oid4vp/cross-device/results
 *
 * Returns null for unhandled routes so callers can layer their own logic.
 */

import {
  generateKeyPair, exportJWK, importJWK, SignJWT,
  type KeyLike, type JWK,
} from 'jose';

// ============================================================================
// Config
// ============================================================================

export interface RelayConfig {
  /** External base URL for this verifier (used in client_id, JWTs, metadata URLs) */
  wellKnownClientUrl: string;

  /** Extra fields merged into the /.well-known/openid4vp-client metadata */
  metadata?: Record<string, unknown>;

  /** JWK JSON string for the signing private key. Auto-generates ephemeral ES256 if omitted. */
  signingKeyJwk?: string;

  /** Session TTL in ms (default 300000 = 5 min) */
  sessionTtlMs?: number;

  /** Long-poll timeout in ms (default 120000 = 2 min) */
  longPollTimeoutMs?: number;

  /**
   * Extract a verifier session ID from the request (e.g., from a cookie or auth header).
   * Used for cross-device session binding when requireVerifierSessionForCrossDevice is true.
   */
  getVerifierSessionId?: (req: Request) => Promise<string | null> | string | null;

  /** If true, cross-device init/results require a valid verifier session. Default false. */
  requireVerifierSessionForCrossDevice?: boolean;

  /**
   * Allowed origins for same-device redirect_uri. If omitted or empty,
   * only same-origin redirects (matching wellKnownClientUrl) are accepted.
   * Set to ['*'] to allow any origin (not recommended for production).
   */
  allowedSameDeviceOrigins?: string[];
}

// ============================================================================
// Internals
// ============================================================================

interface Transaction {
  transaction_id: string;
  request_id: string;
  write_token: string;
  read_secret: string;
  flow: 'same-device' | 'cross-device';
  verifier_session_id?: string;
  redirect_uri?: string;
  ephemeral_pub_jwk: JWK;
  dcql_query: object;
  nonce: string;
  response_code?: string;
  jwe?: string;
  created: number;
  waiters: Array<(jwe: string) => void>;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

// ============================================================================
// Factory
// ============================================================================

export async function createRelayHandler(config: RelayConfig) {
  const {
    wellKnownClientUrl,
    metadata: extraMetadata = {},
    sessionTtlMs = 5 * 60 * 1000,
    longPollTimeoutMs = 2 * 60 * 1000,
    getVerifierSessionId,
    requireVerifierSessionForCrossDevice = false,
    allowedSameDeviceOrigins = [],
  } = config;

  const verifierOrigin = new URL(wellKnownClientUrl).origin;

  // --- Signing key ---
  let signingPrivKey: KeyLike;
  let signingPubJwk: JWK;

  if (config.signingKeyJwk) {
    const jwk = JSON.parse(config.signingKeyJwk) as JWK;
    signingPrivKey = (await importJWK(jwk, 'ES256')) as KeyLike;
    const { d: _, ...pubParts } = jwk as Record<string, unknown>;
    signingPubJwk = { ...pubParts, kid: jwk.kid || 'verifier-signing-1', use: 'sig', alg: 'ES256' } as JWK;
  } else {
    const kp = await generateKeyPair('ES256');
    signingPrivKey = kp.privateKey as KeyLike;
    signingPubJwk = {
      ...(await exportJWK(kp.publicKey)),
      kid: 'verifier-signing-1', use: 'sig', alg: 'ES256',
    };
  }

  // --- Transaction storage ---
  const byRequestId = new Map<string, Transaction>();
  const byWriteToken = new Map<string, Transaction>();
  const byTransactionId = new Map<string, Transaction>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, txn] of byRequestId) {
      if (now - txn.created > sessionTtlMs) {
        byRequestId.delete(id);
        byWriteToken.delete(txn.write_token);
        byTransactionId.delete(txn.transaction_id);
      }
    }
  }, 60_000);

  function storeTxn(txn: Transaction) {
    byRequestId.set(txn.request_id, txn);
    byWriteToken.set(txn.write_token, txn);
    byTransactionId.set(txn.transaction_id, txn);
  }

  function deleteTxn(txn: Transaction) {
    byRequestId.delete(txn.request_id);
    byWriteToken.delete(txn.write_token);
    byTransactionId.delete(txn.transaction_id);
  }

  // --- Redirect URI validation ---

  function validateSameDeviceRedirectUri(uri: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return 'redirect_uri must be an absolute URL';
    }
    if (parsed.hash) return 'redirect_uri must not contain a fragment';
    if (parsed.username || parsed.password) return 'redirect_uri must not contain credentials';

    const redirectOrigin = parsed.origin;

    // Same origin as verifier is always allowed
    if (redirectOrigin === verifierOrigin) return null;

    // Check allowlist
    if (allowedSameDeviceOrigins.includes('*')) return null;
    if (allowedSameDeviceOrigins.includes(redirectOrigin)) return null;

    return `redirect_uri origin ${redirectOrigin} is not allowed (verifier origin: ${verifierOrigin})`;
  }

  // --- Metadata ---
  const clientId = `well_known:${wellKnownClientUrl}`;
  const metadataDoc = {
    client_id: clientId,
    jwks_uri: `${wellKnownClientUrl}/.well-known/jwks.json`,
    request_object_signing_alg_values_supported: ['ES256'],
    vp_formats_supported: {},
    ...extraMetadata,
  };

  // --- Helpers ---

  async function resolveVerifierSession(req: Request): Promise<string | null> {
    if (!getVerifierSessionId) return null;
    return getVerifierSessionId(req);
  }

  function createTransaction(
    flow: 'same-device' | 'cross-device',
    body: { redirect_uri?: string; ephemeral_pub_jwk: JWK; dcql_query: object },
    verifierSessionId?: string | null,
  ) {
    const txn: Transaction = {
      transaction_id: generateId(),
      request_id: generateId(),
      write_token: generateId(),
      read_secret: generateId(),
      flow,
      verifier_session_id: verifierSessionId || undefined,
      redirect_uri: body.redirect_uri,
      ephemeral_pub_jwk: body.ephemeral_pub_jwk,
      dcql_query: body.dcql_query,
      nonce: generateId(),
      created: Date.now(),
      waiters: [],
    };
    storeTxn(txn);
    return txn;
  }

  function initResponse(txn: Transaction) {
    return Response.json({
      transaction_id: txn.transaction_id,
      request_id: txn.request_id,
      read_secret: txn.read_secret,
      request_uri: `${wellKnownClientUrl}/oid4vp/requests/${txn.request_id}`,
    }, { headers: PUBLIC_CORS });
  }

  function fetchResultForTxn(txn: Transaction, body: { read_secret: string; response_code?: string }) {
    if (txn.read_secret !== body.read_secret) {
      return Response.json({ error: 'unauthorized' }, { status: 403, headers: PUBLIC_CORS });
    }

    if (txn.flow === 'same-device') {
      if (!body.response_code || body.response_code !== txn.response_code) {
        if (!txn.jwe) return Response.json({ status: 'pending' }, { headers: PUBLIC_CORS });
        return Response.json({ error: 'invalid_response_code' }, { status: 403, headers: PUBLIC_CORS });
      }
    }

    if (txn.jwe) {
      const jwe = txn.jwe;
      deleteTxn(txn);
      return Response.json({ status: 'complete', response: jwe }, { headers: PUBLIC_CORS });
    }

    // Long-poll
    return new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        txn.waiters = txn.waiters.filter(w => w !== onData);
        resolve(Response.json({ status: 'pending' }, { headers: PUBLIC_CORS }));
      }, longPollTimeoutMs);

      const onData = (jwe: string) => {
        clearTimeout(timer);
        if (txn.flow !== 'same-device') deleteTxn(txn);
        resolve(Response.json({ status: 'complete', response: jwe }, { headers: PUBLIC_CORS }));
      };
      txn.waiters.push(onData);
    });
  }

  // --- Handler ---
  async function handler(req: Request): Promise<Response | null> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: PUBLIC_CORS });
    }

    // ===================== Public wallet-facing endpoints =====================

    // GET /.well-known/openid4vp-client
    if (req.method === 'GET' && url.pathname === '/.well-known/openid4vp-client') {
      return Response.json(metadataDoc, {
        headers: { ...PUBLIC_CORS, 'Content-Type': 'application/json' },
      });
    }

    // GET /.well-known/jwks.json
    if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      return Response.json({ keys: [signingPubJwk] }, {
        headers: { ...PUBLIC_CORS, 'Content-Type': 'application/json' },
      });
    }

    // POST /oid4vp/requests/:request_id — signed Request Object
    const requestMatch = url.pathname.match(/^\/oid4vp\/requests\/([a-f0-9]+)$/);
    if (req.method === 'POST' && requestMatch) {
      const txn = byRequestId.get(requestMatch[1]);
      if (!txn) return Response.json({ error: 'not_found' }, { status: 404, headers: PUBLIC_CORS });

      const jwt = await new SignJWT({
        iss: clientId, aud: 'https://self-issued.me/v2', client_id: clientId,
        response_type: 'vp_token', response_mode: 'direct_post.jwt',
        response_uri: `${wellKnownClientUrl}/oid4vp/responses/${txn.write_token}`,
        nonce: txn.nonce, state: txn.request_id,
        dcql_query: txn.dcql_query,
        client_metadata: {
          jwks: { keys: [txn.ephemeral_pub_jwk] },
          encrypted_response_enc_values_supported: ['A256GCM'],
        },
      })
        .setProtectedHeader({ alg: 'ES256', kid: signingPubJwk.kid! })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(signingPrivKey);

      return new Response(jwt, {
        headers: { ...PUBLIC_CORS, 'Content-Type': 'application/oauth-authz-req+jwt' },
      });
    }

    // POST /oid4vp/responses/:write_token — wallet submits encrypted response
    const responseMatch = url.pathname.match(/^\/oid4vp\/responses\/([a-f0-9]+)$/);
    if (req.method === 'POST' && responseMatch) {
      const txn = byWriteToken.get(responseMatch[1]);
      if (!txn) return Response.json({ error: 'not_found' }, { status: 404, headers: PUBLIC_CORS });

      const ct = req.headers.get('content-type') || '';
      let jwe: string;
      if (ct.includes('application/x-www-form-urlencoded')) {
        jwe = new URLSearchParams(await req.text()).get('response') || '';
      } else {
        jwe = ((await req.json()) as { response?: string }).response || '';
      }
      if (!jwe) return Response.json({ error: 'missing_response' }, { status: 400, headers: PUBLIC_CORS });

      // First-write-wins with idempotent retry
      if (txn.jwe) {
        if (txn.jwe === jwe) {
          // Idempotent retry — return same response as original
          if (txn.flow === 'same-device' && txn.redirect_uri && txn.response_code) {
            return Response.json({
              redirect_uri: `${txn.redirect_uri}#response_code=${txn.response_code}`,
            }, { headers: PUBLIC_CORS });
          }
          return Response.json({ status: 'ok' }, { headers: PUBLIC_CORS });
        }
        // Different payload — reject
        return Response.json({ error: 'already_submitted' }, { status: 409, headers: PUBLIC_CORS });
      }

      txn.jwe = jwe;
      for (const resolve of txn.waiters) resolve(jwe);
      txn.waiters = [];

      if (txn.flow === 'same-device' && txn.redirect_uri) {
        txn.response_code = generateId();
        return Response.json({
          redirect_uri: `${txn.redirect_uri}#response_code=${txn.response_code}`,
        }, { headers: PUBLIC_CORS });
      }

      return Response.json({ status: 'ok' }, { headers: PUBLIC_CORS });
    }

    // ===================== Verifier-facing endpoints =====================

    // POST /oid4vp/same-device/init
    if (req.method === 'POST' && url.pathname === '/oid4vp/same-device/init') {
      const body = await req.json() as {
        redirect_uri: string;
        ephemeral_pub_jwk: JWK;
        dcql_query: object;
      };
      if (!body.redirect_uri) {
        return Response.json({ error: 'redirect_uri required for same-device' }, { status: 400, headers: PUBLIC_CORS });
      }
      const validationError = validateSameDeviceRedirectUri(body.redirect_uri);
      if (validationError) {
        return Response.json({ error: 'invalid_redirect_uri', error_description: validationError }, { status: 400, headers: PUBLIC_CORS });
      }
      const txn = createTransaction('same-device', body);
      return initResponse(txn);
    }

    // POST /oid4vp/same-device/results
    if (req.method === 'POST' && url.pathname === '/oid4vp/same-device/results') {
      const body = await req.json() as {
        transaction_id: string;
        read_secret: string;
        response_code: string;
      };
      const txn = byTransactionId.get(body.transaction_id);
      if (!txn) return Response.json({ error: 'not_found' }, { status: 404, headers: PUBLIC_CORS });
      if (txn.flow !== 'same-device') return Response.json({ error: 'wrong_flow' }, { status: 400, headers: PUBLIC_CORS });
      return fetchResultForTxn(txn, body);
    }

    // POST /oid4vp/cross-device/init
    if (req.method === 'POST' && url.pathname === '/oid4vp/cross-device/init') {
      let verifierSessionId: string | null = null;
      if (requireVerifierSessionForCrossDevice) {
        verifierSessionId = await resolveVerifierSession(req);
        if (!verifierSessionId) {
          return Response.json({ error: 'verifier_session_required' }, { status: 403, headers: PUBLIC_CORS });
        }
      }
      const body = await req.json() as {
        ephemeral_pub_jwk: JWK;
        dcql_query: object;
      };
      const txn = createTransaction('cross-device', body, verifierSessionId);
      return initResponse(txn);
    }

    // POST /oid4vp/cross-device/results
    if (req.method === 'POST' && url.pathname === '/oid4vp/cross-device/results') {
      if (requireVerifierSessionForCrossDevice) {
        const sessionId = await resolveVerifierSession(req);
        if (!sessionId) {
          return Response.json({ error: 'verifier_session_required' }, { status: 403, headers: PUBLIC_CORS });
        }
        // Session ownership check happens after finding the txn below
      }

      const body = await req.json() as {
        transaction_id: string;
        read_secret: string;
      };
      const txn = byTransactionId.get(body.transaction_id);
      if (!txn) return Response.json({ error: 'not_found' }, { status: 404, headers: PUBLIC_CORS });
      if (txn.flow !== 'cross-device') return Response.json({ error: 'wrong_flow' }, { status: 400, headers: PUBLIC_CORS });

      if (requireVerifierSessionForCrossDevice && txn.verifier_session_id) {
        const sessionId = await resolveVerifierSession(req);
        if (sessionId !== txn.verifier_session_id) {
          return Response.json({ error: 'session_mismatch' }, { status: 403, headers: PUBLIC_CORS });
        }
      }

      return fetchResultForTxn(txn, body);
    }

    return null;
  }

  return { handler };
}
