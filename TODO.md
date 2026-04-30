# TODO: Reference Implementation for `well_known:` + Same-Device / Cross-Device Flows

This file turns the updated protocol in [README.md](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/README.md) into a concrete implementation plan for the reference demo and shim library.

## Goals

- Show the new authenticated verifier mode using `well_known:<https-origin>`.
- Demonstrate two distinct ceremony modes:
  - same-device: closes the loop with `#response_code`
  - cross-device: no browser-loop redirect; requester retrieves via its authenticated read path
- Keep the shim API simple so the caller can declare the intended flow without rebuilding request logic.
- Show trust behavior clearly:
  - trusted `well_known:` client: richer metadata-driven name/logo UX
  - untrusted but valid `well_known:` client: bare origin only

## Recommended Shim API

Target API for [src/smart-health-checkin.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/src/smart-health-checkin.ts):

```ts
const result = await request(dcqlQuery, {
  walletUrl: 'https://picker.example.com',
  wellKnownClientUrl: 'https://clinic.example.com',
  flow: 'same-device' | 'cross-device',
  rehydrate: true,
  timeout: 120000,
  onRequestStart(info) {},
});
```

Notes:

- Replace the current `relayUrl` mental model with `wellKnownClientUrl`.
- The shim should derive:
  - `client_id = well_known:${wellKnownClientUrl}`
  - metadata URL = `${wellKnownClientUrl}/.well-known/openid4vp-client`
  - request endpoint, response endpoint, and read endpoint from conventions under `wellKnownClientUrl`
- `flow` is the single high-level mode selector:
  - `same-device`: open popup, expect `#response_code`
  - `cross-device`: do not rely on redirect completion; instead expose QR/link details and wait on the read path
- `onRequestStart` should receive enough info for the demo UI to render the request:
  - `flow`
  - `client_id`
  - `request_uri`
  - `launch_url`
  - `transaction_id` only if needed locally by the requester app

## Phase 1: Verifier Backend / Response Endpoint

Primary file: [demo/relay/server.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/relay/server.ts)

- Replace the current anonymous `session_id` relay API with a transaction-oriented API.
- Add `POST /oid4vp/init`:
  - require the requester to declare `flow = same-device | cross-device`
  - create `transaction_id`
  - create `request_id`
  - persist the declared flow mode in transaction state
  - return `request_uri` and requester-local transaction handles
- Add `GET /.well-known/openid4vp-client`:
  - emit metadata for `well_known:${wellKnownClientUrl}`
  - include `jwks_uri`
  - include allowed `response_uri_prefixes`
  - include allowed `redirect_uris`
- Add `GET /.well-known/jwks.json`:
  - publish long-lived verifier signing keys
- Add `POST /oid4vp/request/:request_id`:
  - accept `wallet_metadata` and `wallet_nonce` if provided
  - return a signed Request Object
  - include request-specific ephemeral encryption key from the requester
  - include `state = request_id`
- Add request-specific write endpoint such as `POST /oid4vp/post/:request_id` or `POST /oid4vp/post/:write_token`:
  - accept `direct_post.jwt` responses
  - identify the transaction from the write path / token, not from decrypted `state`
  - store only opaque ciphertext plus associated `request_id`
- Do not require the response endpoint to read `state` from the incoming POST:
  - with `direct_post.jwt`, `state` is inside the encrypted JWT
  - validate `state` only after the ciphertext has been retrieved and decrypted by the Verifier side
- Add authenticated read path:
  - preferred: `POST /oid4vp/result`
  - input: `transaction_id` and optionally `response_code`
  - output: stored ciphertext or timeout/pending state
- Add same-device completion response:
  - when flow is `same-device`, the request-specific `POST /oid4vp/post/:request_id` or `POST /oid4vp/post/:write_token` endpoint returns JSON containing `redirect_uri`
  - `redirect_uri` should point at the requester return page with `#response_code=<fresh-secret>`
- Ensure there is no read API where `request_id` alone is enough to retrieve data.

## Phase 2: Verifier Signing and Metadata

Primary files:
- [demo/relay/server.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/relay/server.ts)
- [demo/config.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/config.ts)

- Generate and load a demo long-lived verifier signing key.
- Sign Request Objects with JOSE.
- Keep encryption keys request-scoped and separate from verifier identity keys.
- Decide and document exact well-known conventions:
  - metadata: `/.well-known/openid4vp-client`
  - JWKS: `/.well-known/jwks.json`
  - request: `/oid4vp/request/:request_id`
  - response post prefix: `/oid4vp/post/`
  - result fetch: `/oid4vp/result`
  - return page: `/oid4vp/return`
- Make the demo config expose `wellKnownClientUrl` explicitly instead of only `relay.url`.

## Phase 3: Shim Library

Primary file: [src/smart-health-checkin.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/src/smart-health-checkin.ts)

- Replace `redirect_uri:` request construction with `well_known:`.
- Replace `createRelaySession()` with transaction initialization against `/oid4vp/init`.
- Add `flow` to `RequestOptions`.
- Rename `relayUrl` to `wellKnownClientUrl` in the public API.
- Pass the selected `flow` to `/oid4vp/init` instead of inferring it later.
- Construct a minimal bootstrap request:
  - `client_id`
  - `request_uri`
  - `request_uri_method=post`
- Continue to generate ephemeral encryption keys in-browser.
- Send the ephemeral public JWK to the verifier backend during init so it can be embedded in the signed Request Object.
- Add same-device launch behavior:
  - open popup
  - wait for popup return to `#response_code`
  - exchange `transaction_id + response_code` for ciphertext
- Add cross-device behavior:
  - do not assume popup completion
  - surface `launch_url` to the caller for QR rendering
  - poll or subscribe using `transaction_id` and verifier session binding
- Keep `rehydrateResponse()` unchanged except for any new envelope fields.
- Preserve `maybeHandleReturn()`, but redefine it around `response_code` instead of a generic popup close.

## Phase 4: Same-Device Return Flow

Primary files:
- [src/smart-health-checkin.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/src/smart-health-checkin.ts)
- [demo/requester/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/requester/src/App.tsx)

- Add a requester return route/page under the requester origin.
- Update `maybeHandleReturn()` to:
  - parse `location.hash` or query for `response_code`
  - signal the opener via `postMessage` or local storage/session storage
  - close the popup when appropriate
- Update the main requester app to:
  - start a same-device request
  - listen for the return signal
  - complete the result fetch with `transaction_id + response_code`
- Show in the demo UI that same-device is bound to the original tab/session.

## Phase 5: Cross-Device QR Flow

Primary files:
- [demo/requester/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/requester/src/App.tsx)
- [demo/checkin/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/checkin/src/App.tsx)

- Add a clear cross-device entry point in the requester UI.
- Render the `launch_url` as a QR code and copyable link.
- Keep the requester waiting on the authenticated read path rather than a popup return.
- Make the check-in page understand both entry modes:
  - popup/same-device launch
  - scanned QR / copied link
- Ensure the demo copy explains why the cross-device mode does not use `response_code`.

## Phase 6: Picker and Wallet / Source App Behavior

Primary files:
- [demo/checkin/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/checkin/src/App.tsx)
- [demo/source-app/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/source-app/src/App.tsx)

- Stop assuming all security-critical request parameters arrive inline in the URL.
- Make the source app resolve and verify the signed Request Object:
  - parse bootstrap `client_id` and `request_uri`
  - resolve `/.well-known/openid4vp-client`
  - fetch `jwks_uri`
  - fetch and verify the Request Object
  - use only Request Object values for `response_uri`, `state`, `nonce`, `dcql_query`, and encryption info
- Enforce `well_known:` rules:
  - client identifier must be bare origin
  - metadata path derived by convention
  - `response_uri` must be allowed by metadata
- Show the bare origin to the user in all valid `well_known:` flows.

## Phase 7: Trust Framework / Allowlist Demo

Primary files:
- [demo/config.ts](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/config.ts)
- [demo/checkin/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/checkin/src/App.tsx)
- [demo/source-app/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/source-app/src/App.tsx)

- Add a demo allowlist / trust-framework configuration keyed by exact `well_known:` client identifier or bare origin.
- For trusted verifier origins:
  - show metadata-derived `client_name`
  - show metadata-derived `logo_uri`
  - optionally show a “trusted program” badge
- For valid but untrusted verifier origins:
  - do not use metadata name/logo as trusted identity
  - show only the bare origin from `well_known:`
- Add a second demo verifier mode if useful:
  - trusted clinic
  - untrusted but valid clinic
- Make the UX difference obvious in screenshots and live behavior.

## Phase 8: Demo UX

Primary file: [demo/requester/src/App.tsx](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/demo/requester/src/App.tsx)

- Add an explicit flow selector in the requester UI:
  - `Use This Device`
  - `Use Another Device`
- Show current mode in the request log.
- Show `client_id` and `request_uri` in the demo debug panel.
- For same-device:
  - show popup opened
  - show waiting for `response_code`
  - show authenticated fetch complete
- For cross-device:
  - show QR rendered
  - show waiting for paired device
  - show result fetched without same-tab redirect

## Phase 9: Test Coverage

Primary file: [test-flow.spec.js](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/test-flow.spec.js)

- Add a same-device test:
  - verifier initializes transaction
  - source app posts response
  - response endpoint returns `redirect_uri#response_code=...`
  - requester fetch requires `transaction_id + response_code`
- Add a cross-device test:
  - verifier initializes transaction
  - requester renders QR/bootstrap link
  - source app posts response
  - requester fetch succeeds without `response_code`
- Add request verification tests:
  - invalid `well_known:` client identifier format
  - metadata fetch failure
  - JWKS / signature verification failure
  - `response_uri` not allowed by metadata
- Add trust behavior tests:
  - trusted verifier uses metadata name/logo
  - untrusted verifier falls back to bare origin
- Add negative read-path tests:
  - `request_id` alone cannot fetch result
  - same-device fetch without `response_code` fails

## Phase 10: Cleanup and Migration

- Update [README.md](/home/jmandel/hobby/SHCWalletApp/shl-share-picker/README.md) examples to match the actual shim API once implemented.
- Remove remaining `redirect_uri:` assumptions from the codebase.
- Remove or rename old `relayUrl` terminology once the new API lands.
- Rebuild `dist/` artifacts after the shim API changes.

## Exit Criteria

The reference implementation is done when all of the following are true:

- The shim can start a request with `flow: 'same-device'` or `flow: 'cross-device'`.
- Same-device uses `#response_code` to close the loop and requires it on the read path.
- Cross-device completes without `response_code` and relies only on the authenticated verifier transaction/read path defined by the profile.
- The source app verifies a signed Request Object discovered from `well_known:`.
- The demo visibly distinguishes:
  - trusted metadata presentation
  - untrusted bare-origin presentation
- No component uses metadata-supplied names/logos as trusted identity without an allowlist or trust framework.
