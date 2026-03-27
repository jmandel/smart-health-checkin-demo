/**
 * Standalone OID4VP relay server.
 *
 * Same-device flows work out of the box. Cross-device endpoints reject
 * with 403 unless you provide your own session binding (see README).
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
  wellKnownClientUrl: VERIFIER_BASE,
  signingKeyJwk: process.env.SIGNING_KEY,
  metadata: process.env.CLIENT_NAME ? { client_name: process.env.CLIENT_NAME } : undefined,
  // Cross-device requires session binding — reject unless the caller
  // mounts the handler with their own getVerifierSessionId callback.
  requireVerifierSessionForCrossDevice: true,
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
console.log(`  Cross-device: disabled (no session binding configured)`);
console.log(`  Same-device: enabled`);
