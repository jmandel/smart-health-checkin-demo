/**
 * Demo wrapper: OID4VP relay + static file serving for the SMART Health Check-in demo.
 *
 * This layers the demo's static site on top of the relay handler.
 * Used by start-local.sh and start-static.sh.
 */

import { join, resolve } from 'path';
import { createRelayHandler } from './handler.ts';

const PORT = parseInt(process.env.PORT || '3003', 10);
const VERIFIER_BASE = process.env.VERIFIER_BASE || `http://localhost:${PORT}`;
const STATIC_DIR = process.env.STATIC_DIR || '';

const { handler } = await createRelayHandler({
  verifierBase: VERIFIER_BASE,
  metadata: { client_name: "Dr. Mandel's Family Medicine" },
});

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    // Relay routes first
    const resp = await handler(req);
    if (resp) return resp;

    const url = new URL(req.url);

    // Static files
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

    // Health check
    if (req.method === 'GET' && url.pathname === '/') {
      return Response.json({ status: 'ok', relay: 'smart-health-checkin' });
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  },
});

console.log(`Demo server listening on http://localhost:${PORT}`);
console.log(`  VERIFIER_BASE: ${VERIFIER_BASE}`);
if (STATIC_DIR) console.log(`  Static files: ${STATIC_DIR}`);
