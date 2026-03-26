/**
 * OID4VP Relay Handler — reusable core for SMART Health Check-in
 *
 * Handles verifier metadata, signed Request Objects, opaque JWE storage,
 * and authenticated result retrieval. Returns null for unhandled routes
 * so callers can layer their own logic on top.
 *
 * Usage:
 *   const { handler } = await createRelayHandler({ verifierBase: '...' });
 *   // Use handler(req) in any Bun.serve, Deno.serve, or framework router.
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
  verifierBase: string;

  /** Extra fields merged into the /.well-known/openid4vp-client metadata */
  metadata?: Record<string, unknown>;

  /** JWK JSON string for the signing private key. Auto-generates an ephemeral ES256 key if omitted. */
  signingKeyJwk?: string;

  /** Session TTL in ms (default 300000 = 5 min) */
  sessionTtlMs?: number;

  /** Long-poll timeout in ms (default 120000 = 2 min) */
  longPollTimeoutMs?: number;
}

// ============================================================================
// Internals
// ============================================================================

interface Transaction {
  transaction_id: string;
  request_id: string;
  read_secret: string;
  response_code?: string;
  flow: 'same-device' | 'cross-device';
  redirect_uri?: string;
  ephemeral_pub_jwk: JWK;
  dcql_query: object;
  nonce: string;
  jwe?: string;
  created: number;
  waiters: Array<(jwe: string) => void>;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================================
// Factory
// ============================================================================

export async function createRelayHandler(config: RelayConfig) {
  const {
    verifierBase,
    metadata: extraMetadata = {},
    sessionTtlMs = 5 * 60 * 1000,
    longPollTimeoutMs = 2 * 60 * 1000,
  } = config;

  // --- Signing key ---
  let signingPrivKey: KeyLike;
  let signingPubJwk: JWK;

  if (config.signingKeyJwk) {
    const jwk = JSON.parse(config.signingKeyJwk) as JWK;
    signingPrivKey = (await importJWK(jwk, 'ES256')) as KeyLike;
    const { privateKey: _, ...pubParts } = jwk as Record<string, unknown>;
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
  const transactions = new Map<string, Transaction>();
  const txnIndex = new Map<string, string>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, txn] of transactions) {
      if (now - txn.created > sessionTtlMs) {
        txnIndex.delete(txn.transaction_id);
        transactions.delete(id);
      }
    }
  }, 60_000);

  // --- Metadata ---
  const clientId = `well_known:${verifierBase}`;
  const metadataDoc = {
    client_id: clientId,
    jwks_uri: `${verifierBase}/.well-known/jwks.json`,
    request_object_signing_alg_values_supported: ['ES256'],
    response_uri_prefixes: [`${verifierBase}/oid4vp/post/`],
    vp_formats_supported: {},
    ...extraMetadata,
  };

  // --- Handler ---
  async function handler(req: Request): Promise<Response | null> {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // GET /.well-known/openid4vp-client
    if (req.method === 'GET' && url.pathname === '/.well-known/openid4vp-client') {
      return Response.json(metadataDoc, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // GET /.well-known/jwks.json
    if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      return Response.json({ keys: [signingPubJwk] }, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // POST /oid4vp/init
    if (req.method === 'POST' && url.pathname === '/oid4vp/init') {
      const body = await req.json() as {
        flow?: 'same-device' | 'cross-device';
        redirect_uri?: string;
        ephemeral_pub_jwk: JWK;
        dcql_query: object;
      };

      const transaction_id = generateId();
      const request_id = generateId();
      const read_secret = generateId();

      transactions.set(request_id, {
        transaction_id, request_id, read_secret,
        flow: body.flow || 'same-device',
        redirect_uri: body.redirect_uri,
        ephemeral_pub_jwk: body.ephemeral_pub_jwk,
        dcql_query: body.dcql_query,
        nonce: generateId(),
        created: Date.now(),
        waiters: [],
      });
      txnIndex.set(transaction_id, request_id);

      return Response.json({
        transaction_id, request_id, read_secret,
        request_uri: `${verifierBase}/oid4vp/request/${request_id}`,
      }, { headers: CORS });
    }

    // POST /oid4vp/request/:request_id — signed Request Object
    const requestMatch = url.pathname.match(/^\/oid4vp\/request\/([a-f0-9]+)$/);
    if (req.method === 'POST' && requestMatch) {
      const txn = transactions.get(requestMatch[1]);
      if (!txn) return Response.json({ error: 'not_found' }, { status: 404, headers: CORS });

      const jwt = await new SignJWT({
        iss: clientId, aud: 'https://self-issued.me/v2', client_id: clientId,
        response_type: 'vp_token', response_mode: 'direct_post.jwt',
        response_uri: `${verifierBase}/oid4vp/post/${txn.request_id}`,
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
        headers: { ...CORS, 'Content-Type': 'application/oauth-authz-req+jwt' },
      });
    }

    // POST /oid4vp/post/:request_id — wallet posts encrypted response
    const postMatch = url.pathname.match(/^\/oid4vp\/post\/([a-f0-9]+)$/);
    if (req.method === 'POST' && postMatch) {
      const txn = transactions.get(postMatch[1]);
      if (!txn) return Response.json({ error: 'not_found' }, { status: 404, headers: CORS });

      const ct = req.headers.get('content-type') || '';
      let jwe: string;
      if (ct.includes('application/x-www-form-urlencoded')) {
        jwe = new URLSearchParams(await req.text()).get('response') || '';
      } else {
        jwe = ((await req.json()) as { response?: string }).response || '';
      }
      if (!jwe) return Response.json({ error: 'missing_response' }, { status: 400, headers: CORS });

      txn.jwe = jwe;
      for (const resolve of txn.waiters) resolve(jwe);
      txn.waiters = [];

      if (txn.flow === 'same-device' && txn.redirect_uri) {
        const response_code = generateId();
        txn.response_code = response_code;
        return Response.json({
          redirect_uri: `${txn.redirect_uri}#response_code=${response_code}&transaction_id=${txn.transaction_id}`,
        }, { headers: CORS });
      }

      return Response.json({ status: 'ok' }, { headers: CORS });
    }

    // POST /oid4vp/result — authenticated result fetch
    if (req.method === 'POST' && url.pathname === '/oid4vp/result') {
      const body = await req.json() as {
        transaction_id: string;
        read_secret: string;
        response_code?: string;
      };

      const request_id = txnIndex.get(body.transaction_id);
      if (!request_id) return Response.json({ error: 'not_found' }, { status: 404, headers: CORS });

      const txn = transactions.get(request_id);
      if (!txn || txn.read_secret !== body.read_secret) {
        return Response.json({ error: 'unauthorized' }, { status: 403, headers: CORS });
      }

      if (txn.flow === 'same-device') {
        if (!body.response_code || body.response_code !== txn.response_code) {
          if (!txn.jwe) return Response.json({ status: 'pending' }, { headers: CORS });
          return Response.json({ error: 'invalid_response_code' }, { status: 403, headers: CORS });
        }
      }

      if (txn.jwe) {
        const jwe = txn.jwe;
        transactions.delete(request_id);
        txnIndex.delete(body.transaction_id);
        return Response.json({ status: 'complete', response: jwe }, { headers: CORS });
      }

      // Long-poll
      return new Promise<Response>((resolve) => {
        const timer = setTimeout(() => {
          txn.waiters = txn.waiters.filter(w => w !== onData);
          resolve(Response.json({ status: 'pending' }, { headers: CORS }));
        }, longPollTimeoutMs);

        const onData = (jwe: string) => {
          clearTimeout(timer);
          if (txn.flow !== 'same-device') {
            transactions.delete(request_id);
            txnIndex.delete(body.transaction_id);
          }
          resolve(Response.json({ status: 'complete', response: jwe }, { headers: CORS }));
        };
        txn.waiters.push(onData);
      });
    }

    return null; // not handled — let the caller deal with it
  }

  return { handler };
}
