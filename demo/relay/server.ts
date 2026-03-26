/**
 * Zero-Trust Relay Server for SMART Health Check-in
 *
 * A simple, stateless relay that temporarily caches opaque JWE strings.
 * It never possesses the private key and cannot read or alter PHI.
 *
 * Endpoints:
 *   POST /session          - Create a new session, returns { session_id }
 *   POST /post/:session_id - Wallet posts encrypted JWE response
 *   GET  /poll/:session_id - Browser polls for response
 */

const PORT = parseInt(process.env.PORT || '3003', 10);
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Session {
  jwe?: string;
  created: number;
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
      sessions.set(sessionId, { created: Date.now() });
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
        // Also accept JSON body for flexibility
        const body = await req.json() as { response?: string };
        jwe = body.response || '';
      }

      if (!jwe) {
        return Response.json({ error: 'missing_response' }, { status: 400, headers: corsHeaders });
      }

      session.jwe = jwe;
      return Response.json({ status: 'ok' }, { headers: corsHeaders });
    }

    // GET /poll/:session_id - Browser polls for response
    const pollMatch = url.pathname.match(/^\/poll\/([a-f0-9]+)$/);
    if (req.method === 'GET' && pollMatch) {
      const sessionId = pollMatch[1];
      const session = sessions.get(sessionId);
      if (!session) {
        return Response.json({ error: 'session_not_found' }, { status: 404, headers: corsHeaders });
      }

      if (session.jwe) {
        const jwe = session.jwe;
        sessions.delete(sessionId);
        return Response.json({ status: 'complete', response: jwe }, { headers: corsHeaders });
      }

      return Response.json({ status: 'pending' }, { headers: corsHeaders });
    }

    return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
  }
});

console.log(`Relay server listening on http://localhost:${PORT}`);
