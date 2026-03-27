# Relay TODO: API and Implementation Changes

This file is a relay-specific implementation plan for the updated SMART Health Check-in profile.

It focuses on the changes needed in the relay itself, not the broader shim or demo UX. It should be read alongside the root [README.md](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/README.md) and root [TODO.md](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/TODO.md).

## Goals

- Keep the wallet-facing OpenID4VP surfaces public and standards-aligned.
- Split verifier-facing behavior into two explicit profiles:
  - `same-device`
  - `cross-device`
- Make the security model visible in the relay API instead of hiding it behind one generic `init/result` pair.
- Tighten cross-device initiation and result retrieval so they can be bound to an authenticated verifier session.
- Preserve the stronger same-device `#response_code` loop-closure flow.

## Current Gaps

The current relay in [handler.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/relay/handler.ts) is still a bearer-token demo:

- `POST /oid4vp/init` is public.
- `POST /oid4vp/result` is public apart from `transaction_id` and `read_secret`.
- `POST /oid4vp/post/:request_id` is named after the HTTP transport rather than the operation.
- `same-device` and `cross-device` are encoded only as transaction state, not as distinct verifier-facing API profiles.
- the same-device redirect currently leaks `transaction_id` back through the wallet redirect fragment even though the requester already knows it.

That is acceptable for a local demo, but it is not the right long-term API shape.

## Target Relay Surface

The relay should expose two categories of endpoints:

### 1. Public wallet-facing endpoints

These must remain callable without a verifier-side browser session:

| Method | Path | Called by | Purpose |
|---|---|---|---|
| `GET` | `/.well-known/openid4vp-client` | Wallet | Verifier metadata |
| `GET` | `/.well-known/jwks.json` | Wallet | Verifier signing keys |
| `POST` | `/oid4vp/requests/:request_id` | Wallet | Return signed Request Object |
| `POST` | `/oid4vp/responses/:write_token` | Wallet | Submit encrypted authorization response |

### 2. Verifier-facing profile endpoints

These are the API surfaces the requester or clinic app calls directly:

| Method | Path | Called by | Auth / Binding |
|---|---|---|---|
| `POST` | `/oid4vp/same-device/init` | Requester browser | no clinician session required |
| `POST` | `/oid4vp/same-device/results` | Requester browser | `transaction_id + read_secret + response_code` |
| `POST` | `/oid4vp/cross-device/init` | Requester / clinic app | authenticated verifier session required |
| `POST` | `/oid4vp/cross-device/results` | Requester / clinic app | authenticated verifier session required, plus transaction binding |

This split is specific to the reference implementation.

The public shim can still keep a single `flow: 'same-device' | 'cross-device'` option. Internally it should call the matching relay subpath.

## Binding Model

The relay should enforce four separate bindings.

### Verifier identity binding

- `client_id = well_known:<https-origin>`
- metadata at `/.well-known/openid4vp-client`
- Request Object signed by keys from `jwks_uri`

This proves the request was produced by the verifier origin.

### Transaction binding

- `request_id`
- `write_token`
- `read_secret`

This ties the wallet submission and verifier retrieval to the same transaction.

### Same-device redirect binding

- `response_code`

This closes the loop back to the initiating browser tab in the same-device flow.

### Cross-device session binding

- authenticated verifier session ownership recorded at init time

This prevents arbitrary outsiders from anonymously starting and redeeming cross-device transactions.

## Transaction Model Changes

Replace the current transaction object with one that explicitly separates public write capability from verifier-side read capability.

Suggested fields:

```ts
interface Transaction {
  transaction_id: string;
  request_id: string;
  write_token: string;
  read_secret: string;
  flow: 'same-device' | 'cross-device';
  verifier_session_id?: string;
  redirect_uri?: string;
  ephemeral_pub_jwk: JWK;
  dcql_query: object;
  nonce: string;
  response_code?: string;
  jwe?: string;
  created: number;
  waiters: Array<(jwe: string) => void>;
}
```

Required changes:

- add `write_token`
- stop using `request_id` directly as the write capability
- keep `request_id` as the OID4VP `state`
- add `verifier_session_id` for cross-device ownership binding
- keep `response_code` only for same-device

## Endpoint Contracts

### `POST /oid4vp/same-device/init`

Purpose:
- start a same-device popup flow

Caller:
- public requester browser page

Input:

```json
{
  "redirect_uri": "https://requester.example/oid4vp/return",
  "ephemeral_pub_jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "dcql_query": { "credentials": [] }
}
```

Output:

```json
{
  "transaction_id": "...",
  "request_id": "...",
  "read_secret": "...",
  "request_uri": "https://verifier.example/oid4vp/requests/...",
  "launch_url": "https://picker.example?...client_id=well_known:https://verifier.example&request_uri=..."
}
```

Notes:

- no clinician session required
- record `flow = same-device`
- do not return `write_token`

### `POST /oid4vp/same-device/results`

Purpose:
- redeem the stored encrypted response after popup completion

Input:

```json
{
  "transaction_id": "...",
  "read_secret": "...",
  "response_code": "..."
}
```

Checks:

- transaction exists
- `flow === 'same-device'`
- `read_secret` matches
- `response_code` matches

Output:

- `{ "status": "pending" }`
- or `{ "status": "complete", "response": "<JWE>" }`

### `POST /oid4vp/cross-device/init`

Purpose:
- start a cross-device verifier transaction

Caller:
- authenticated clinic / verifier app session

Input:

```json
{
  "ephemeral_pub_jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "dcql_query": { "credentials": [] }
}
```

Checks:

- caller has valid verifier session
- caller is authorized to start a transaction

Behavior:

- record `flow = cross-device`
- record `verifier_session_id`

Output:

```json
{
  "transaction_id": "...",
  "request_id": "...",
  "read_secret": "...",
  "request_uri": "https://verifier.example/oid4vp/requests/...",
  "launch_url": "https://picker.example?...client_id=well_known:https://verifier.example&request_uri=..."
}
```

### `POST /oid4vp/cross-device/results`

Purpose:
- return the stored encrypted response to the initiating verifier session

Input:

```json
{
  "transaction_id": "...",
  "read_secret": "..."
}
```

Checks:

- caller has valid verifier session
- `flow === 'cross-device'`
- verifier session matches the initiator session recorded at init time
- `read_secret` matches

Output:

- `{ "status": "pending" }`
- or `{ "status": "complete", "response": "<JWE>" }`

Notes:

- no `response_code`
- result retrieval should not be possible from an unrelated browser session

### `POST /oid4vp/requests/:request_id`

Purpose:
- return the signed Request Object to the wallet

Behavior:

- public endpoint
- emits signed Request Object
- `state = request_id`
- `response_uri = ${wellKnownClientUrl}/oid4vp/responses/${write_token}`

### `POST /oid4vp/responses/:write_token`

Purpose:
- accept the wallet's encrypted authorization response

Behavior:

- public endpoint
- write-only capability
- identify the transaction by `write_token`
- store only opaque ciphertext
- do not require decrypted access to validate `state` at receipt time

Same-device response:

```json
{
  "redirect_uri": "https://requester.example/oid4vp/return#response_code=<fresh-secret>"
}
```

Cross-device response:

```json
{
  "status": "ok"
}
```

Important:

- do not append `transaction_id` to the wallet-facing redirect
- the initiating requester already has `transaction_id`

## Authentication and CORS Changes

The relay should stop treating every endpoint as equally public.

### Public endpoints

These may continue to allow broad cross-origin access:

- `/.well-known/openid4vp-client`
- `/.well-known/jwks.json`
- `/oid4vp/requests/:request_id`
- `/oid4vp/responses/:write_token`

### Protected verifier-facing endpoints

These should no longer use `Access-Control-Allow-Origin: *` in the stronger deployment profile:

- `/oid4vp/cross-device/init`
- `/oid4vp/cross-device/results`

Recommended behavior:

- same-origin only by default
- or explicit verifier-origin allowlist
- support cookie-backed session auth, header auth, or host-app middleware injection

`same-device` endpoints may remain more permissive because they rely on `response_code` for final redemption, but they should still be treated as verifier-facing API, not wallet-facing API.

## Handler Refactor Plan

Primary file: [handler.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/relay/handler.ts)

### 1. Rename routes

- `/oid4vp/init` -> `/oid4vp/same-device/init` and `/oid4vp/cross-device/init`
- `/oid4vp/result` -> `/oid4vp/same-device/results` and `/oid4vp/cross-device/results`
- `/oid4vp/request/:request_id` -> `/oid4vp/requests/:request_id`
- `/oid4vp/post/:request_id` -> `/oid4vp/responses/:write_token`

### 2. Add session binding hooks

Extend `createRelayHandler()` to accept verifier-session callbacks for protected routes.

Suggested shape:

```ts
interface RelayConfig {
  wellKnownClientUrl: string;
  metadata?: Record<string, unknown>;
  signingKeyJwk?: string;
  sessionTtlMs?: number;
  longPollTimeoutMs?: number;
  getVerifierSessionId?: (req: Request) => Promise<string | null> | string | null;
  requireVerifierSessionForCrossDevice?: boolean;
}
```

Behavior:

- if `requireVerifierSessionForCrossDevice` is true, reject cross-device init/results unless `getVerifierSessionId()` returns a stable session id
- bind `verifier_session_id` into transaction state

### 3. Add `write_token`

- generate `write_token` at init
- index transactions by both `request_id` and `write_token`
- use `write_token` in `response_uri`

### 4. Stop leaking `transaction_id` in redirect

Same-device completion should return only:

```json
{
  "redirect_uri": "https://requester.example/oid4vp/return#response_code=..."
}
```

### 5. Tighten same-device init validation

- require `redirect_uri`
- optionally validate `redirect_uri` against configured allowlist in stronger deployments

### 6. Keep long-polling behavior, but split ownership checks

- same-device long-poll: gated by `transaction_id + read_secret + response_code`
- cross-device long-poll: gated by verifier session ownership plus `transaction_id + read_secret`

## Server Integration Changes

Primary file: [server.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/relay/server.ts)

- Keep standalone mode for local demo use.
- Add an example of mounting the relay behind an authenticated app for cross-device use.
- Make it clear that standalone mode is a bearer-token demo, not the strongest deployment profile.
- Prefer `https` `VERIFIER_BASE` for profile-compliant examples.
- Consider separate CORS policy for public wallet-facing routes versus protected verifier-facing routes.

## Demo / Shim Impact

The relay API change implies the following caller behavior:

- shim keeps a simple `flow` option
- `flow: 'same-device'` maps to:
  - `POST /oid4vp/same-device/init`
  - `POST /oid4vp/same-device/results`
- `flow: 'cross-device'` maps to:
  - `POST /oid4vp/cross-device/init`
  - `POST /oid4vp/cross-device/results`

The wallet and picker do not need to care about this split. They only see:

- `client_id = well_known:<origin>`
- `request_uri`
- a signed Request Object
- `response_uri`

## Migration Order

1. Add new route names alongside old ones.
2. Add `write_token` and switch Request Objects to use `/oid4vp/responses/:write_token`.
3. Stop emitting `transaction_id` in same-device redirect.
4. Split verifier-facing routes into `same-device` and `cross-device`.
5. Add session binding hook and require it for `cross-device`.
6. Update shim to call the new endpoints.
7. Remove old `/oid4vp/init`, `/oid4vp/result`, and `/oid4vp/post/:request_id` routes once the demo has moved over.

## Exit Criteria

The relay work is complete when all of the following are true:

- wallet-facing endpoints are public, write-only where appropriate, and no longer use `post` as a semantic route name
- same-device and cross-device have separate verifier-facing API profiles
- same-device redemption requires `response_code`
- cross-device init and result retrieval can be bound to an authenticated verifier session
- `transaction_id` is no longer sent through the wallet redirect
- `response_uri` uses `write_token`, not `request_id`
- the shim can target the new relay endpoints without changing the wallet-facing bootstrap format
