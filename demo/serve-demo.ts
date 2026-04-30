/**
 * Demo server: mounts the OID4VP relay handler alongside static file serving,
 * and provides a simple staff login for the cross-device kiosk demo.
 */

import { join, resolve } from 'path';
import { createRelayHandler } from './relay/handler.ts';

const PORT = parseInt(process.env.PORT || '3003', 10);
const VERIFIER_BASE = process.env.VERIFIER_BASE || `http://localhost:${PORT}`;
const STATIC_DIR = process.env.STATIC_DIR || '';
const CANONICAL_ORIGIN = process.env.CANONICAL_ORIGIN || '';

// --- Staff session management (demo only) ---

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const staffSessions = new Set<string>();

function getSessionFromCookie(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/staff_session=([a-f0-9]+)/);
  return match ? match[1] : null;
}

// --- Relay with session binding ---

// Allowed origins for same-device redirect_uri (supports cross-origin frontends like GH Pages)
const ALLOWED_ORIGINS = (process.env.ALLOWED_SAME_DEVICE_ORIGINS || '').split(',').filter(Boolean);

const { handler: relay } = await createRelayHandler({
  wellKnownClientUrl: VERIFIER_BASE,
  metadata: { client_name: "Dr. Mandel's Family Medicine" },
  requireVerifierSessionForCrossDevice: true,
  allowedSameDeviceOrigins: ALLOWED_ORIGINS,
  getVerifierSessionId: (req) => {
    const sessionId = getSessionFromCookie(req);
    if (sessionId && staffSessions.has(sessionId)) return sessionId;
    return null;
  },
});

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    if (CANONICAL_ORIGIN) {
      const canonical = new URL(CANONICAL_ORIGIN);
      if (url.hostname.endsWith('.localhost') && url.host !== canonical.host) {
        const redirectUrl = new URL(url.pathname + url.search, canonical.origin);
        return Response.redirect(redirectUrl, 302);
      }
    }

    // --- Demo login endpoint ---

    if (req.method === 'POST' && url.pathname === '/demo/login') {
      const ct = req.headers.get('content-type') || '';
      let username = '', password = '';

      if (ct.includes('application/json')) {
        const body = await req.json() as { username?: string; password?: string };
        username = body.username || '';
        password = body.password || '';
      } else {
        const body = new URLSearchParams(await req.text());
        username = body.get('username') || '';
        password = body.get('password') || '';
      }

      // Demo credentials: any non-empty username with password "demo"
      if (!username || password !== 'demo') {
        return Response.json({ error: 'invalid_credentials' }, { status: 401 });
      }

      const sessionId = generateId();
      staffSessions.add(sessionId);

      return new Response(JSON.stringify({ status: 'ok', username }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `staff_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
        },
      });
    }

    // Check staff session for cross-device API (relay handler does the enforcement,
    // but we need to make sure the cookie is readable — it is via getVerifierSessionId above)

    // Relay routes
    const resp = await relay(req);
    if (resp) return resp;

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
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Private-Network': 'true',
            },
          });
        }
      }
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return Response.json({ status: 'ok', relay: 'smart-health-checkin' });
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  },
});

console.log(`Demo server listening on ${server.url}`);
console.log(`  VERIFIER_BASE: ${VERIFIER_BASE}`);
if (STATIC_DIR) console.log(`  Static files: ${STATIC_DIR}`);

function shutdown() {
  server.stop(true);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
