/**
 * Standalone OID4VP relay server.
 *
 * Configuration via environment variables:
 *   PORT          - listen port (default 3003)
 *   VERIFIER_BASE - external base URL (default http://localhost:$PORT)
 *   SIGNING_KEY   - JWK JSON string for signing key (auto-generates if omitted)
 *   CLIENT_NAME   - metadata client_name (optional)
 */

import { createRelayHandler } from './handler.ts';

const PORT = parseInt(process.env.PORT || '3003', 10);
const VERIFIER_BASE = process.env.VERIFIER_BASE || `http://localhost:${PORT}`;

const { handler } = await createRelayHandler({
  verifierBase: VERIFIER_BASE,
  signingKeyJwk: process.env.SIGNING_KEY,
  metadata: process.env.CLIENT_NAME ? { client_name: process.env.CLIENT_NAME } : undefined,
});

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const resp = await handler(req);
    if (resp) return resp;

    if (req.method === 'GET' && new URL(req.url).pathname === '/') {
      return Response.json({ status: 'ok', relay: 'smart-health-checkin' });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  },
});

console.log(`Relay listening on http://localhost:${PORT}`);
console.log(`  VERIFIER_BASE: ${VERIFIER_BASE}`);
