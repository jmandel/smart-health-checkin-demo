# OID4VP Relay for SMART Health Check-in

A drop-in OID4VP response endpoint implementing `well_known:` client identifiers, signed Request Objects, and E2E encrypted `direct_post.jwt` response handling.

The relay stores only opaque JWE ciphertext. It never possesses the decryption key and cannot read protected health information.

## Quick start

```bash
VERIFIER_BASE=https://clinic.example.com bun demo/relay/server.ts
```

If `SIGNING_KEY` is omitted, an ephemeral ES256 key pair is generated at startup.

## Deployment options

### 1. Standalone server

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

```typescript
import { createRelayHandler } from './demo/relay/handler.ts';

const { handler: relay } = await createRelayHandler({
  verifierBase: 'https://clinic.example.com',
  metadata: { client_name: 'My Clinic' },
});

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
| `POST` | `/oid4vp/requests/:request_id` | Returns signed Request Object JWT |
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

Same-device response:
```json
{ "redirect_uri": "https://clinic.example.com/checkin#response_code=..." }
```

Cross-device response:
```json
{ "status": "ok" }
```

## Security model

| Secret | Known by | Purpose |
|--------|----------|---------|
| `transaction_id` | Requester only | Identifies the transaction for result retrieval |
| `read_secret` | Requester only | Authenticates result retrieval |
| `write_token` | Wallet only (via signed Request Object) | Write-only capability for submitting the response |
| `response_code` | Requester (via redirect) | Same-device loop-closure; proves the popup completed |
| `request_id` | Public (in URLs, as OID4VP `state`) | Correlation handle; not sufficient to read data |

- `request_id` alone is never sufficient to retrieve stored data.
- `transaction_id` is never sent to the wallet or included in wallet-facing redirects.
- The relay cannot decrypt JWE payloads — only the requester's ephemeral private key can.

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
  verifierBase: string;
  metadata?: Record<string, unknown>;
  signingKeyJwk?: string;
  sessionTtlMs?: number;                 // default 300000 (5 min)
  longPollTimeoutMs?: number;             // default 120000 (2 min)
  getVerifierSessionId?: (req: Request) => Promise<string | null> | string | null;
  requireVerifierSessionForCrossDevice?: boolean;  // default false
}
```
