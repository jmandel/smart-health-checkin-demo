# OID4VP Relay for SMART Health Check-in

A drop-in OID4VP response endpoint implementing `well_known:` client identifiers, signed Request Objects, and E2E encrypted `direct_post.jwt` response handling.

The relay stores only opaque JWE ciphertext. It never possesses the decryption key and cannot read protected health information.

## Quick start

```bash
VERIFIER_BASE=https://clinic.example.com bun demo/relay/server.ts
```

This gives you same-device flows immediately. **Cross-device endpoints are disabled by default** — they reject with `verifier_session_required` because cross-device flows require authenticated session binding to prevent an attacker from creating a transaction, showing the QR to a victim, and stealing the decrypted PHI. To enable cross-device, mount the handler with your own `getVerifierSessionId` callback (see "Mounted in your own server" below).

If `SIGNING_KEY` is omitted, an ephemeral ES256 key pair is generated at startup.

## Deployment options

### 1. Standalone server

Same-device only (cross-device disabled for safety):

```bash
VERIFIER_BASE=https://clinic.example.com \
SIGNING_KEY='{"kty":"EC","crv":"P-256","d":"...","x":"...","y":"..."}' \
CLIENT_NAME="General Hospital" \
bun demo/relay/server.ts
```

### 2. Behind a reverse proxy

Run on an internal port and proxy the relay paths:

```nginx
location /.well-known/openid4vp-client { proxy_pass http://127.0.0.1:3003; }
location /.well-known/jwks.json        { proxy_pass http://127.0.0.1:3003; }
location /oid4vp/                      { proxy_pass http://127.0.0.1:3003; }
```

### 3. Mounted in your own server

Same-device only:

```typescript
import { createRelayHandler } from './demo/relay/handler.ts';

const { handler: relay } = await createRelayHandler({
  wellKnownClientUrl: 'https://clinic.example.com',
  metadata: { client_name: 'My Clinic' },
});
```

With cross-device enabled (requires session binding):

```typescript
const { handler: relay } = await createRelayHandler({
  wellKnownClientUrl: 'https://clinic.example.com',
  metadata: { client_name: 'My Clinic' },
  requireVerifierSessionForCrossDevice: true,
  getVerifierSessionId: (req) => {
    // Return a stable session ID from your auth layer (cookie, JWT, etc.)
    // Return null to reject the request.
    const session = getSessionFromYourAuthLayer(req);
    return session?.id ?? null;
  },
});
```

Then use in any Bun server:

```typescript
Bun.serve({
  async fetch(req) {
    const resp = await relay(req);
    if (resp) return resp;
    // ...your own routes
  },
});
```

The handler returns `null` for unrecognized routes so you can layer it with your own logic.

## API

### Public wallet-facing endpoints

These are called by wallets and source apps. They support CORS (`Access-Control-Allow-Origin: *`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/openid4vp-client` | Verifier metadata |
| `GET` | `/.well-known/jwks.json` | Verifier signing keys (JWKS) |
| `GET` | `/oid4vp/requests/:request_id` | Returns signed Request Object JWT |
| `POST` | `/oid4vp/responses/:write_token` | Wallet submits encrypted JWE response |

### Verifier-facing endpoints

These are called by the requester/clinic application.

#### Same-device flow

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/oid4vp/same-device/init` | Start a same-device transaction |
| `POST` | `/oid4vp/same-device/results` | Fetch result (requires `response_code`) |

#### Cross-device flow

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/oid4vp/cross-device/init` | Start a cross-device transaction |
| `POST` | `/oid4vp/cross-device/results` | Fetch result (long-polls if pending) |

### Same-device init

```
POST /oid4vp/same-device/init
```

```json
{
  "redirect_uri": "https://clinic.example.com/checkin",
  "ephemeral_pub_jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "dcql_query": { "credentials": [...] }
}
```

`redirect_uri` is required. The relay appends `#response_code=...` to it after the wallet posts.

Response:

```json
{
  "transaction_id": "...",
  "request_id": "...",
  "read_secret": "...",
  "request_uri": "https://clinic.example.com/oid4vp/requests/..."
}
```

### Same-device results

```
POST /oid4vp/same-device/results
```

```json
{
  "transaction_id": "...",
  "read_secret": "...",
  "response_code": "..."
}
```

All three fields are required. Returns `{ "status": "complete", "response": "<JWE>" }` or `{ "status": "pending" }`.

### Cross-device init

```
POST /oid4vp/cross-device/init
```

```json
{
  "ephemeral_pub_jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "dcql_query": { "credentials": [...] }
}
```

No `redirect_uri` — the wallet doesn't redirect back in cross-device mode.

If `requireVerifierSessionForCrossDevice` is enabled, the request must carry a valid verifier session (resolved via the `getVerifierSessionId` callback).

### Cross-device results

```
POST /oid4vp/cross-device/results
```

```json
{
  "transaction_id": "...",
  "read_secret": "..."
}
```

No `response_code`. Long-polls for up to 2 minutes if the wallet hasn't posted yet.

If `requireVerifierSessionForCrossDevice` is enabled, the verifier session must match the session that created the transaction.

### Wallet response endpoint

```
POST /oid4vp/responses/:write_token
Content-Type: application/x-www-form-urlencoded

response=eyJhbGci... (opaque JWE)
```

The `write_token` is an opaque capability token separate from `request_id`. The relay identifies the transaction from the URL path — it does not read `state` from the encrypted payload.

**First-write-wins:** The first POST stores the JWE and is authoritative. A retry with the same JWE returns the same response (idempotent). A POST with a different JWE is rejected with `409 already_submitted`.

Same-device response:
```json
{ "redirect_uri": "https://clinic.example.com/checkin#response_code=..." }
```

Cross-device response:
```json
{ "status": "ok" }
```

Conflict (different payload after first submission):
```json
{ "error": "already_submitted" }
```

## Security model

| Secret | Known by | Purpose |
|--------|----------|---------|
| `transaction_id` | Requester only | Identifies the transaction for result retrieval |
| `read_secret` | Requester only | Authenticates result retrieval |
| `write_token` | Any party that fetches the signed Request Object | One-time write capability for submitting the response |
| `response_code` | Requester (via redirect) | Same-device loop-closure; proves the popup completed |
| `request_id` | Public (in URLs, as OID4VP `state`) | Correlation handle; not sufficient to read data |

- `request_id` alone is never sufficient to retrieve stored data.
- `transaction_id` is never sent to the wallet or included in wallet-facing redirects.
- The relay cannot decrypt JWE payloads — only the requester's ephemeral private key can.

### Cross-device requires session binding

Without session binding, an attacker can create a cross-device transaction with their own ephemeral key, show the QR to a victim, then redeem and decrypt the PHI. The `transaction_id` and `read_secret` are not stolen — the attacker *created* them.

The standalone `server.ts` sets `requireVerifierSessionForCrossDevice: true` by default, which disables cross-device endpoints unless a `getVerifierSessionId` callback is provided. To enable cross-device, mount the handler in your own server with your auth layer.

## Configuration

| Env var | Required | Description |
|---------|----------|-------------|
| `VERIFIER_BASE` | Yes | External URL (e.g., `https://clinic.example.com`) |
| `PORT` | No | Listen port (default `3003`) |
| `SIGNING_KEY` | No | ES256 JWK JSON for signing. Auto-generates if omitted. |
| `CLIENT_NAME` | No | `client_name` in metadata (standalone mode only) |

### `createRelayHandler` config

```typescript
interface RelayConfig {
  wellKnownClientUrl: string;
  metadata?: Record<string, unknown>;
  signingKeyJwk?: string;
  sessionTtlMs?: number;                 // default 300000 (5 min)
  longPollTimeoutMs?: number;             // default 120000 (2 min)
  getVerifierSessionId?: (req: Request) => Promise<string | null> | string | null;
  requireVerifierSessionForCrossDevice?: boolean;  // default false
}
```
