/**
 * Zero-Trust Relay Server for SMART Health Check-in
 *
 * A simple, stateless relay that temporarily caches opaque JWE strings.
 * It never possesses the private key and cannot read or alter PHI.
 *
 * Uses long polling: the GET /poll/:session_id request is held open until
 * the wallet POSTs the encrypted response, then responds instantly.
 *
 * Endpoints:
 *   POST /session          - Create a new session, returns { session_id }
 *   POST /post/:session_id - Wallet posts encrypted JWE response
 *   GET  /poll/:session_id - Browser long-polls for response
 *
 * If STATIC_DIR is set, also serves static files (e.g., the demo site)
 * for any path that doesn't match a relay endpoint.
 */

import { join, resolve } from 'path';

const PORT = parseInt(process.env.PORT || '3003', 10);
const STATIC_DIR = process.env.STATIC_DIR || '';
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LONG_POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

interface Session {
  jwe?: string;
  created: number;
  waiters: Array<(jwe: string) => void>;
}

const sessions = new Map<string, Session>();

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.created > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

// Periodic cleanup
setInterval(cleanupSessions, 60_000);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // POST /session - Create new session
    if (req.method === 'POST' && url.pathname === '/session') {
      const sessionId = generateSessionId();
      sessions.set(sessionId, { created: Date.now(), waiters: [] });
      return Response.json({ session_id: sessionId }, { headers: corsHeaders });
    }

    // POST /post/:session_id - Wallet posts encrypted response
    const postMatch = url.pathname.match(/^\/post\/([a-f0-9]+)$/);
    if (req.method === 'POST' && postMatch) {
      const sessionId = postMatch[1];
      const session = sessions.get(sessionId);
      if (!session) {
        return Response.json({ error: 'session_not_found' }, { status: 404, headers: corsHeaders });
      }

      const contentType = req.headers.get('content-type') || '';
      let jwe: string;

      if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = await req.text();
        const params = new URLSearchParams(body);
        jwe = params.get('response') || '';
      } else {
        const body = await req.json() as { response?: string };
        jwe = body.response || '';
      }

      if (!jwe) {
        return Response.json({ error: 'missing_response' }, { status: 400, headers: corsHeaders });
      }

      // Wake up any waiting long-poll clients
      for (const resolve of session.waiters) {
        resolve(jwe);
      }
      session.waiters = [];
      session.jwe = jwe;

      return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }

    // GET /poll/:session_id - Browser long-polls for response
    const pollMatch = url.pathname.match(/^\/poll\/([a-f0-9]+)$/);
    if (req.method === 'GET' && pollMatch) {
      const sessionId = pollMatch[1];
      const session = sessions.get(sessionId);
      if (!session) {
        return Response.json({ error: 'session_not_found' }, { status: 404, headers: corsHeaders });
      }

      // Already have data — return immediately
      if (session.jwe) {
        const jwe = session.jwe;
        sessions.delete(sessionId);
        return Response.json({ status: 'complete', response: jwe }, { headers: corsHeaders });
      }

      // Hold connection open until data arrives or timeout
      return new Promise<Response>((resolve) => {
        const timer = setTimeout(() => {
          // Remove this waiter and return timeout
          session.waiters = session.waiters.filter(w => w !== onData);
          resolve(Response.json({ status: 'timeout' }, { headers: corsHeaders }));
        }, LONG_POLL_TIMEOUT_MS);

        const onData = (jwe: string) => {
          clearTimeout(timer);
          sessions.delete(sessionId);
          resolve(Response.json({ status: 'complete', response: jwe }, { headers: corsHeaders }));
        };

        session.waiters.push(onData);
      });
    }

    // Serve static files if STATIC_DIR is configured
    if (STATIC_DIR) {
      const root = resolve(STATIC_DIR);
      const filePath = resolve(root, '.' + url.pathname);

      // Prevent path traversal (defense-in-depth; URL parser already resolves "..")
      if (!filePath.startsWith(root)) {
        return new Response('Forbidden', { status: 403 });
      }

      // Try exact path, then index.html for directories
      for (const candidate of [filePath, join(filePath, 'index.html')]) {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
    }

    return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
  }
});

if (STATIC_DIR) {
  console.log(`Relay + static server listening on http://localhost:${PORT}`);
  console.log(`  Serving static files from: ${STATIC_DIR}`);
} else {
  console.log(`Relay server listening on http://localhost:${PORT}`);
}
