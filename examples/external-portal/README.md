# External Portal Example

A standalone static page that uses the SMART Health Check-in protocol with a shared verifier relay. This demonstrates the cross-origin same-device flow: the frontend is on one domain (e.g., GitHub Pages) while the verifier/relay runs on another (`smart-health-checkin.exe.xyz`).

## What this shows

- A third-party site can use the protocol without running its own relay
- The shim library is loaded from the relay server's `/dist/` path
- The `well_known:` verifier identity is the relay server's origin, not this page's domain
- Same-device `redirect_uri` points back to this page — the relay must approve that origin
- End-to-end encryption still works: the relay never sees the plaintext

## How it works

1. This page loads `smart-health-checkin.iife.js` from the relay server
2. On click, it calls `SHL.request()` with `verifierBase` pointing to the relay
3. The shim opens a popup to the picker (also on the relay server)
4. The wallet/source app verifies the signed Request Object from the relay
5. The wallet encrypts and POSTs the response to the relay's `response_uri`
6. The relay redirects the popup back to this page with `#response_code=...`
7. This page's `maybeHandleReturn()` broadcasts via BroadcastChannel
8. The shim fetches the encrypted result and decrypts it locally

## Deploy

This is a single HTML file. Deploy it to any static host:

```bash
# GitHub Pages, Netlify, Vercel, S3, etc.
cp index.html /your/deploy/path/
```

## Requirements

The relay server at `smart-health-checkin.exe.xyz` must:

1. Be running and accessible
2. Have this page's origin in `ALLOWED_SAME_DEVICE_ORIGINS`
3. Serve the shim library at `/dist/smart-health-checkin.iife.js`
4. Serve the picker UI at `/checkin/`
5. Serve at least one source app (e.g., `/source-app/`)

## Customization

Edit the three constants at the top of the `<script>` block:

```javascript
const VERIFIER_BASE = 'https://smart-health-checkin.exe.xyz';
const CHECKIN_BASE = VERIFIER_BASE + '/checkin';
const SHIM_URL = VERIFIER_BASE + '/dist/smart-health-checkin.iife.js';
```
