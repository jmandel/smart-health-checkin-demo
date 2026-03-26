/**
 * Verifier Backend / Response Endpoint for SMART Health Check-in
 *
 * Implements the well_known: client identifier prefix, signed Request Objects,
 * transaction management, and same-device / cross-device flows.
 *
 * Endpoints:
 *   GET  /.well-known/openid4vp-client     - Verifier metadata
 *   GET  /.well-known/jwks.json            - Verifier signing keys
 *   POST /oid4vp/init                      - Initialize transaction
 *   POST /oid4vp/request/:request_id       - Return signed Request Object
 *   POST /oid4vp/post/:request_id          - Wallet posts encrypted response
 *   POST /oid4vp/result                    - Requester fetches result
 *   GET  /oid4vp/return                    - Same-device return page
 *
 * If STATIC_DIR is set, also serves static files for the demo.
 */

import { join, resolve } from 'path';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from 'jose';

const PORT = parseInt(process.env.PORT || '3003', 10);
const STATIC_DIR = process.env.STATIC_DIR || '';
const VERIFIER_BASE = process.env.VERIFIER_BASE || `http://localhost:${PORT}`;
const SESSION_TTL_MS = 5 * 60 * 1000;
const LONG_POLL_TIMEOUT_MS = 2 * 60 * 1000;

// --- Verifier signing key (generated at startup) ---

const { privateKey: verifierPrivKey, publicKey: verifierPubKey } = await generateKeyPair('ES256');
const verifierSigningJwk: JWK = {
  ...(await exportJWK(verifierPubKey)),
  kid: 'verifier-signing-1',
  use: 'sig',
  alg: 'ES256',
};

// --- Transaction storage ---

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

const transactions = new Map<string, Transaction>();       // request_id -> txn
const txnIndex = new Map<string, string>();                // transaction_id -> request_id

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cleanupTransactions() {
  const now = Date.now();
  for (const [id, txn] of transactions) {
    if (now - txn.created > SESSION_TTL_MS) {
      txnIndex.delete(txn.transaction_id);
      transactions.delete(id);
    }
  }
}

setInterval(cleanupTransactions, 60_000);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- Server ---

Bun.serve({
  port: PORT,
  idleTimeout: 255, // max for long-poll
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- well-known metadata ---

    if (req.method === 'GET' && url.pathname === '/.well-known/openid4vp-client') {
      return Response.json({
        client_id: `well_known:${VERIFIER_BASE}`,
        client_name: "Dr. Mandel's Family Medicine",
        jwks_uri: `${VERIFIER_BASE}/.well-known/jwks.json`,
        request_object_signing_alg_values_supported: ['ES256'],
        response_uri_prefixes: [`${VERIFIER_BASE}/oid4vp/post/`],
        vp_formats_supported: {},
      }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
      return Response.json({ keys: [verifierSigningJwk] }, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Transaction init ---

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
      const nonce = generateId();

      const txn: Transaction = {
        transaction_id,
        request_id,
        read_secret,
        flow: body.flow || 'same-device',
        redirect_uri: body.redirect_uri,
        ephemeral_pub_jwk: body.ephemeral_pub_jwk,
        dcql_query: body.dcql_query,
        nonce,
        created: Date.now(),
        waiters: [],
      };

      transactions.set(request_id, txn);
      txnIndex.set(transaction_id, request_id);

      return Response.json({
        transaction_id,
        request_id,
        read_secret,
        request_uri: `${VERIFIER_BASE}/oid4vp/request/${request_id}`,
      }, { headers: corsHeaders });
    }

    // --- Signed Request Object ---

    const requestMatch = url.pathname.match(/^\/oid4vp\/request\/([a-f0-9]+)$/);
    if (req.method === 'POST' && requestMatch) {
      const request_id = requestMatch[1];
      const txn = transactions.get(request_id);
      if (!txn) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
      }

      const clientId = `well_known:${VERIFIER_BASE}`;

      const jwt = await new SignJWT({
        iss: clientId,
        aud: 'https://self-issued.me/v2',
        client_id: clientId,
        response_type: 'vp_token',
        response_mode: 'direct_post.jwt',
        response_uri: `${VERIFIER_BASE}/oid4vp/post/${request_id}`,
        nonce: txn.nonce,
        state: request_id,
        dcql_query: txn.dcql_query,
        client_metadata: {
          jwks: { keys: [txn.ephemeral_pub_jwk] },
          encrypted_response_enc_values_supported: ['A256GCM'],
        },
      })
        .setProtectedHeader({ alg: 'ES256', kid: verifierSigningJwk.kid! })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(verifierPrivKey);

      return new Response(jwt, {
        headers: { ...corsHeaders, 'Content-Type': 'application/oauth-authz-req+jwt' },
      });
    }

    // --- Wallet response POST ---

    const postMatch = url.pathname.match(/^\/oid4vp\/post\/([a-f0-9]+)$/);
    if (req.method === 'POST' && postMatch) {
      const request_id = postMatch[1];
      const txn = transactions.get(request_id);
      if (!txn) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
      }

      const contentType = req.headers.get('content-type') || '';
      let jwe: string;
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = await req.text();
        jwe = new URLSearchParams(body).get('response') || '';
      } else {
        jwe = ((await req.json()) as { response?: string }).response || '';
      }

      if (!jwe) {
        return Response.json({ error: 'missing_response' }, { status: 400, headers: corsHeaders });
      }

      txn.jwe = jwe;

      for (const resolve of txn.waiters) {
        resolve(jwe);
      }
      txn.waiters = [];

      // Same-device: return redirect_uri with response_code and transaction_id for BroadcastChannel
      if (txn.flow === 'same-device' && txn.redirect_uri) {
        const response_code = generateId();
        txn.response_code = response_code;
        return Response.json({
          redirect_uri: `${txn.redirect_uri}#response_code=${response_code}&transaction_id=${txn.transaction_id}`,
        }, { headers: corsHeaders });
      }

      return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }

    // --- Authenticated result fetch ---

    if (req.method === 'POST' && url.pathname === '/oid4vp/result') {
      const body = await req.json() as {
        transaction_id: string;
        read_secret: string;
        response_code?: string;
      };

      const request_id = txnIndex.get(body.transaction_id);
      if (!request_id) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
      }

      const txn = transactions.get(request_id);
      if (!txn || txn.read_secret !== body.read_secret) {
        return Response.json({ error: 'unauthorized' }, { status: 403, headers: corsHeaders });
      }

      // Same-device requires response_code
      if (txn.flow === 'same-device') {
        if (!body.response_code || body.response_code !== txn.response_code) {
          // If no response_code yet and no jwe yet, that's expected — wallet hasn't posted yet
          if (!txn.jwe) {
            return Response.json({ status: 'pending' }, { headers: corsHeaders });
          }
          return Response.json({ error: 'invalid_response_code' }, { status: 403, headers: corsHeaders });
        }
      }

      if (txn.jwe) {
        const jwe = txn.jwe;
        transactions.delete(request_id);
        txnIndex.delete(body.transaction_id);
        return Response.json({ status: 'complete', response: jwe }, { headers: corsHeaders });
      }

      // Long-poll
      return new Promise<Response>((resolve) => {
        const timer = setTimeout(() => {
          txn.waiters = txn.waiters.filter(w => w !== onData);
          resolve(Response.json({ status: 'pending' }, { headers: corsHeaders }));
        }, LONG_POLL_TIMEOUT_MS);

        const onData = (jwe: string) => {
          clearTimeout(timer);
          // For same-device, the caller still needs response_code, so don't delete yet
          if (txn.flow !== 'same-device') {
            transactions.delete(request_id);
            txnIndex.delete(body.transaction_id);
          }
          resolve(Response.json({ status: 'complete', response: jwe }, { headers: corsHeaders }));
        };

        txn.waiters.push(onData);
      });
    }

    // --- Static files ---

    if (STATIC_DIR) {
      const root = resolve(STATIC_DIR);
      const filePath = resolve(root, '.' + url.pathname);

      if (!filePath.startsWith(root)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!url.pathname.endsWith('/')) {
        const indexFile = Bun.file(join(filePath, 'index.html'));
        if (await indexFile.exists()) {
          return Response.redirect(url.pathname + '/' + url.search, 301);
        }
      }

      for (const candidate of [filePath, join(filePath, 'index.html')]) {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
    }

    // Health check (when no static file matched for /)
    if (req.method === 'GET' && url.pathname === '/') {
      return Response.json({ status: 'ok', relay: 'smart-health-checkin' }, { headers: corsHeaders });
    }

    return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
  }
});

console.log(`Verifier backend listening on http://localhost:${PORT}`);
console.log(`  VERIFIER_BASE: ${VERIFIER_BASE}`);
if (STATIC_DIR) console.log(`  Serving static files from: ${STATIC_DIR}`);
