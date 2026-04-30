# SMART Health Check-in Protocol

**Public Demo**: https://smart-health-checkin.exe.xyz/

This repository contains:

- a SMART Health Check-in profile of OpenID for Verifiable Presentations (OID4VP)
- a browser shim, published as `smart-health-checkin`, for starting SMART Health Check-in requests from web apps
- a reference demo with two scenarios:
  - same-device patient portal
  - cross-device front-desk kiosk
- a demo verifier backend / response endpoint that serves metadata and signed Request Objects and stores opaque encrypted responses

## Demo Deployments

Demo host choices are explicit JSON profiles under `deployments/`. `DEMO_CONFIG` selects one JSON file:

- `DEMO_CONFIG=local` loads `deployments/local.json`; this is the default.
- `DEMO_CONFIG=public-demo` loads `deployments/public-demo.json`.
- `DEMO_CONFIG=joshuamandel` loads `deployments/joshuamandel.json`.
- `DEMO_CONFIG=./path/to/anything.json` loads a specific file.

Build and serve in one command:

```bash
bun run demo
DEMO_CONFIG=public-demo bun run demo
DEMO_CONFIG=joshuamandel bun run demo
```

Or split build and serve:

```bash
bun run build
bun run serve
```

The build step bakes the selected profile into the static browser bundles under `build/smart-health-checkin-demo/`. `bun run serve` serves that directory plus the verifier backend / response endpoint from one Bun server. By default, it reads `build/smart-health-checkin-demo/deployment-config.json`, so a split build/serve keeps the same origins. Setting `DEMO_CONFIG` while serving intentionally overrides that baked config.

Each deployment can also append share-sheet apps with a top-level `extraApps` array. These entries are merged into `clientConfig.checkin.apps` at load/build time and stripped from the emitted `deployment-config.json`, so they do not appear twice. The Android demo app is configured this way, so local builds can launch `smart-health-checkin-sample://authorize` while the hosted demo can launch the Android App Link host. Apps marked with `"platform": "android"` only appear in the picker on Android browsers.

For local phone testing, use a LAN-reachable origin:

```bash
LOCAL_DEMO_ORIGIN=http://10.0.0.13:3000 bun run demo
```

For a hosted demo, terminate TLS / proxy traffic for the selected profile's `serve.verifierOrigin` to the demo server. Hosted Android App Links default to Android-specific paths on reachable verifier hosts (`/android/authorize`). If `ANDROID_APP_LINK_BASE` points at a separate host, that host must resolve in DNS and serve the built `/.well-known/assetlinks.json` plus its authorize fallback path.

---

## 1. SMART Health Check-in Profile of OID4VP

This section defines the **Protocol Profile**, specifying how OID4VP is used to transport the request and response. To protect PHI in transit, **all responses SHALL be encrypted at the application layer and transported via a Verifier-controlled response endpoint.** A Verifier implementation can store opaque ciphertext for later retrieval, or it can deliver the encrypted response directly to a Verifier component that holds the decryption key.

### 1.1 Ephemeral Keys and Response Delivery

Before initiating a request, the Verifier SHALL:
1. Generate a fresh Ephemeral Key Pair (e.g., ECDH-ES using P-256 or X25519). The private key remains securely in the Verifier's control.
2. Produce a signed Request Object containing the ephemeral public key (see 1.4).

The `response_uri` in the signed Request Object SHALL be a request-specific, write-only Verifier-controlled endpoint. Because `direct_post.jwt` encrypts the entire Authorization Response, including `state`, any component that routes the POST before decryption SHALL identify the target transaction from the request-specific `response_uri` or another outer request handle, not from the encrypted payload.

**Same-device vs. cross-device completion:**

This profile supports two completion modes. The protocol does not prescribe the Verifier's internal storage or retrieval architecture; it requires these shared behaviors:

*   The Wallet encrypts and POSTs the response to `response_uri`.
*   The Verifier obtains the encrypted response, decrypts it, and validates `state`.
*   The Verifier performs the binding checks needed for the selected completion mode before using decrypted data.

The signed Request Object SHALL tell the Wallet what to expect after it POSTs the encrypted response:

*   `smart_health_checkin.completion = "redirect"` means the response endpoint will return a `redirect_uri` containing a fresh `response_code`. This is used when the check-in starts and finishes on one device.
*   `smart_health_checkin.completion = "deferred"` means the response endpoint will return a simple acknowledgement. This is used when the check-in is completed from another device, such as a QR code at a front desk.

How the Verifier validates return URIs, authenticates result retrieval, and binds transactions to application sessions is an implementation concern, not a protocol requirement. The [reference relay implementation](demo/relay/README.md) provides one approach.

Before decrypted response data is revealed downstream, including display to a user, persistence as clinical data, or onward sharing to another system, the Verifier SHALL confirm that the response is being completed in the expected application context. For `completion = "redirect"`, the Verifier SHALL bind the `response_code` to the initiating transaction and application session. For `completion = "deferred"`, the Verifier SHALL bind response access to an authenticated Verifier session authorized for that transaction, such as a valid staff session in a kiosk workflow.

### 1.2 Authenticated Verifier Discovery (`well_known:`)

This profile defines a custom Client Identifier Prefix:

*   `client_id`: SHALL use the `well_known` Client Identifier Prefix.
    *   Format: `well_known:<Verifier_Base_URL>`
    *   Example: `well_known:https://clinic.example.com`
    *   The `Verifier_Base_URL` SHALL be an `https` origin with no path, query, or fragment.
    *   The input to `well_known:` is the bare origin before `/.well-known/...`; the metadata document path is derived by convention and is not carried in the identifier.
    *   Bare `https:` client identifiers are not used by this profile.

For a `well_known:` client, the Wallet SHALL resolve Verifier metadata by fetching:

```text
<Verifier_Base_URL>/.well-known/openid4vp-client
```

For the example above, the Wallet fetches:

```text
https://clinic.example.com/.well-known/openid4vp-client
```

The metadata document SHALL be JSON, SHALL be served with the `application/json` Content-Type, and SHALL contain the information needed to verify signed requests. A typical example is:

```json
{
  "client_id": "well_known:https://clinic.example.com",
  "client_name": "General Hospital Cardiology",
  "logo_uri": "https://clinic.example.com/assets/logo.png",
  "policy_uri": "https://clinic.example.com/privacy",
  "tos_uri": "https://clinic.example.com/terms",
  "jwks_uri": "https://clinic.example.com/.well-known/jwks.json",
  "request_object_signing_alg_values_supported": ["ES256"],
  "vp_formats_supported": {
    "dc+sd-jwt": {
      "sd-jwt_alg_values": ["ES256"],
      "kb-jwt_alg_values": ["ES256"]
    }
  }
}
```

The Wallet SHALL treat the discovered `jwks_uri` as authoritative for verifying signed Request Objects for this `client_id`.
Because the `well_known:` identifier is restricted to a bare origin, successful retrieval of the metadata document plus successful signature verification on the Request Object establishes that the request is controlled by the party that controls that origin and its `.well-known` metadata.

### 1.3 Display and Trust Requirements

Successful resolution of the `well_known:` metadata document and verification of the Request Object signature proves that the request is controlled by the domain owning the Verifier origin. Accordingly:

*   Wallets MAY display the bare origin from the `well_known:` identifier (for example, `https://clinic.example.com`) to users, even when the client is not part of a richer trust program.
*   Wallets, pickers, source apps, and any other relying components SHALL NOT blindly trust metadata-supplied presentation details such as `client_name`, `logo_uri`, badges, or other branding solely because the metadata document fetched successfully and the request signature verified.
*   Any component that wants to use metadata-supplied names, logos, badges, or other semantics for upgraded user-facing trust or policy decisions SHALL maintain a whitelist or trust-framework-backed list of trusted `well_known:` client identifiers or base origins. That list SHALL be configured out of band and SHALL NOT be learned from client-supplied metadata.
*   Trust decisions SHOULD be keyed by the exact `well_known:` client identifier and/or its configured bare origin, not by metadata-supplied display strings.
*   If a `well_known:` client is not in such a whitelist or trust framework, the Wallet MAY still proceed, but SHOULD fall back to displaying only the bare origin from the identifier and/or the origin of the `response_uri`, rather than presenting metadata-supplied names/logos as trusted institutional identity.
*   Verifiers and wallets SHALL NOT assume that merely publishing metadata causes other parties to trust or privilege that metadata. Participation in a whitelist or trust framework is required for those stronger UX outcomes.

### 1.4 Authorization Request

The Authorization Request SHALL follow the requirements of OpenID for Verifiable Presentations, with the following profile requirements.

The bootstrap request shown in a browser popup or QR code SHOULD be minimal and SHOULD contain only:

*   `client_id`
*   `request_uri`

**Bootstrap Example:**
```text
https://wallet.example.com/authorize?
  client_id=well_known:https://clinic.example.com&
  request_uri=https://clinic.example.com/oid4vp/requests/123&
```

The actual request parameters SHALL be conveyed in a signed Request Object fetched from `request_uri`.

**Parameters inside the signed Request Object:**

*   `client_id`: Required. SHALL exactly match the bootstrap `client_id`.
*   `response_type`: SHALL be `vp_token`.
*   `response_mode`: SHALL be `direct_post.jwt`.
*   `response_uri`: Required. SHALL be a request-specific write endpoint. Because the Request Object is signed by the Verifier's key (verified via `jwks_uri`), the `response_uri` is authenticated by the signature itself and does not require separate metadata validation.
*   `client_metadata`: Required. SHALL contain the Ephemeral public key used by the Wallet to encrypt the response for this specific transaction.
    *   `jwks`: A JSON Web Key Set containing the Ephemeral public encryption key.
    *   `encrypted_response_enc_values_supported`: Array of supported encryption algorithms (e.g., `["A256GCM"]`).
*   `aud`: Required. SHALL be `https://self-issued.me/v2` to comply with the OpenID4VP static-discovery Request Object requirements.
*   `nonce`: Required. A cryptographically random string.
*   `state`: Required. SHALL be an unguessable value with at least 128 bits of entropy.
*   `dcql_query`: Required. A JSON-encoded DCQL query object (defined in Section 2).
*   `smart_health_checkin`: Required. Object containing profile-specific completion hints.
    *   `completion`: Required. SHALL be `"redirect"` or `"deferred"`.

**Example Signed Request Object Payload:**
```json
{
  "iss": "well_known:https://clinic.example.com",
  "aud": "https://self-issued.me/v2",
  "client_id": "well_known:https://clinic.example.com",
  "response_type": "vp_token",
  "response_mode": "direct_post.jwt",
  "response_uri": "https://clinic.example.com/oid4vp/responses/req_abc123xyz",
  "nonce": "def456uvw",
  "state": "req_abc123xyz",
  "smart_health_checkin": {
    "completion": "redirect"
  },
  "dcql_query": {...},
  "client_metadata": {
    "jwks": {
      "keys": [
        {
          "kty": "EC",
          "crv": "P-256",
          "use": "enc",
          "alg": "ECDH-ES",
          "kid": "ephemeral-1",
          "x": "...",
          "y": "..."
        }
      ]
    },
    "encrypted_response_enc_values_supported": ["A256GCM"]
  }
}
```

Wallet processing rules for this profile:
1. Fetch the metadata document derived from the `well_known:` identifier.
2. Fetch the Request Object from `request_uri`.
3. Verify the Request Object signature using keys from the discovered `jwks_uri`.
4. Use only the parameters from the signed Request Object for security-sensitive processing.
5. Reject the request if `client_id` does not match the metadata, or other required values are missing.

### 1.5 Authorization Response

The Wallet processes the request, gathers the user's data, and builds a standard JSON response object containing `vp_token` and `state`.

Because `direct_post.jwt` is requested, the Wallet SHALL encrypt this JSON payload into a JSON Web Encryption (JWE) string using the Ephemeral public key provided in the signed Request Object's `client_metadata.jwks`.

The Wallet makes an HTTP POST to the Verifier's `response_uri` with `Content-Type: application/x-www-form-urlencoded`, placing the opaque JWE string in the body:

```http
POST /oid4vp/responses/req_abc123xyz HTTP/1.1
Host: clinic.example.com
Content-Type: application/x-www-form-urlencoded

response=eyJhbGciOiJFQ0RILUVTIi... (Opaque JWE String)
```

The response endpoint SHALL identify the target transaction from the request-specific `response_uri` path or other outer request handle that is visible before decryption. The Verifier MAY store the ciphertext for later retrieval, or MAY process it immediately in a Verifier component that can decrypt it.

The endpoint SHALL NOT rely on reading `state` from the incoming POST because, in `direct_post.jwt`, `state` is carried inside the encrypted JWT payload. The Verifier frontend or backend component that later decrypts the response SHALL validate that the decrypted `state` matches the expected request `state` value.

When `smart_health_checkin.completion` is `"redirect"`, the response endpoint SHALL return a JSON body containing a `redirect_uri` with a fresh `response_code` fragment or parameter. That `redirect_uri` is not Verifier identity evidence and is not required to be validated by the Wallet against Verifier metadata. It is a continuation URI selected by the Verifier.

For example, the response endpoint could reply:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "redirect_uri": "https://app.example.com/oid4vp/return#response_code=091535f699ea575c7937fa5f0f454aee"
}
```

The `response_code` is a fresh, high-entropy, one-time value generated by the Verifier for that completion step. It is a signal to the Verifier frontend that a response has been posted; it is not Verifier identity evidence. The Verifier SHALL validate that the `response_code` is bound to the initiating transaction and application session before revealing decrypted data downstream.

When `smart_health_checkin.completion` is `"deferred"`, the response endpoint SHALL return a success acknowledgement and SHALL NOT require the Wallet to follow a `redirect_uri`. The Verifier retrieves or processes the response through its own application path. Before revealing decrypted data downstream, that path SHALL require an authenticated Verifier session authorized for the transaction.

After retrieval, the frontend decrypts the JWE, validates `state`, resolves internal references, and continues application processing.

---

## 2. DCQL Profile for SMART Health Check-in

This section defines the **Data Profile**, specifying the structure of the DCQL query and the `vp_token` response.

### 2.1 Credential Format: `smart_artifact`

This profile defines a single Credential Format Identifier: **`smart_artifact`**. Because health data without Cryptographic Holder Binding does not utilize standard cryptographic proofs, `require_cryptographic_holder_binding` SHALL be `false`.

This profile authenticates the request and provides encrypted response transport, but it does not by itself prove the provenance or authenticity of returned artifacts. Unless a returned artifact carries its own verifiable proof and the Verifier validates it, the decrypted payload should be treated as a submission correlated to the request via `state`, not as a cryptographically authenticated credential.

The credential query object uses a standard DCQL structure. Properties specific to this profile are specified within the `meta` object:

| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | String | **Required by DCQL.** Unique ID for this request item. |
| `format` | String | **Required by DCQL.** SHALL be `"smart_artifact"` for this profile. |
| `require_cryptographic_holder_binding` | Boolean | **Required by this profile.** SHALL be `false`. |
| `meta.profile` | String | **Optional.** Canonical URL of a FHIR StructureDefinition (e.g., for Patient, Coverage, InsurancePlan). |
| `meta.questionnaire` | Object | **Optional.** Full FHIR Questionnaire JSON to be rendered/completed by the user. |
| `meta.questionnaireUrl` | String | **Optional.** Alternative to `questionnaire`: URL reference to a Questionnaire resource. |
| `meta.signingStrategy` | Array | **Optional.** Array of acceptable signing strategies. Defined values: `"none"` (unsigned FHIR resource), `"shc_v1"`, `"shc_v2"`. If omitted, the Wallet MAY return any format. If present, the Wallet SHALL use one of the listed strategies. Example: `["shc_v1", "none"]` accepts either signed or unsigned. |

#### Handling Optionality
To mark a credential as optional while remaining strictly compliant with generic DCQL parsers, requests SHALL wrap the targeted credential ID in a non-required `credential_sets` object.

**Example: Requesting Optional Insurance Card, Plan Summary, and Patient:**
```json
{
  "credentials": [
    {
      "id": "req_insurance",
      "format": "smart_artifact",
      "require_cryptographic_holder_binding": false,
      "meta": { "profile": "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage" }
    },
    {
      "id": "req_plan",
      "format": "smart_artifact",
      "require_cryptographic_holder_binding": false,
      "meta": { "profile": "http://hl7.org/fhir/us/insurance-card/StructureDefinition/sbc-insurance-plan" }
    },
    {
      "id": "req_history",
      "format": "smart_artifact",
      "require_cryptographic_holder_binding": false,
      "meta": { "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient" }
    }
  ],
  "credential_sets": [
    { "options": [["req_insurance"]], "required": false },
    { "options": [["req_plan"]], "required": false },
    { "options": [["req_history"]], "required": false }
  ]
}
```

### 2.2 Response Structure (Inline References)

To comply with OID4VP structure requirements while minimizing payload size and eliminating data duplication (e.g., when one FHIR Bundle satisfies multiple queries), this profile uses an **Inline Reference** pattern entirely contained within the `vp_token`.

A Presentation object inside the `vp_token` array SHALL take one of two shapes:

1.  **Full Artifact:** Contains `type` (e.g., `"fhir_resource"`, `"shc"`, `"shl"`), `data` (the payload), and an optional `artifact_id` (used if referenced elsewhere).
2.  **Reference Artifact:** Contains only `artifact_ref`, pointing to an `artifact_id` defined elsewhere in the `vp_token`.

The `artifact_id` is a transient string generated by the Wallet at presentation time. Its scope is strictly limited to the current `vp_token` payload and exists only to facilitate inline reference resolution.

**Example Decrypted `vp_token` Payload:**
Scenario: A single `Coverage` FHIR resource satisfies `req_insurance`, and is also referenced by `req_history` alongside a SMART Health Link.

```json
{
  "vp_token": {
    "req_insurance": [
      {
        "artifact_id": "cov_1",
        "type": "fhir_resource",
        "data": {
          "resourceType": "Coverage",
          "id": "cov-123",
          "status": "active"
        }
      }
    ],
    "req_history": [
      {
        "artifact_ref": "cov_1"
      },
      {
        "type": "shl",
        "data": "shlink:/eyJhbGci..."
      }
    ]
  },
  "state": "abc123xyz"
}
```

### 2.3 Error Response

When the Wallet cannot or will not fulfill the request, it generates a standard OID4VP error response (`error`, `error_description`, `state`). Under `direct_post.jwt`, this error payload SHALL also be encrypted as a JWE and POSTed to the Verifier-controlled response endpoint.

When decrypted, the JWE payload will be a JSON object containing standard OAuth 2.0 / OpenID4VP error parameters, for example:

```json
{
  "error": "access_denied",
  "state": "abc123xyz"
}
```

---

## 3. Browser-Based Implementation (The "Shim")

To enable this protocol in browser environments that do not yet support the W3C Digital Credentials API natively, the reference implementation provides a shim library (`smart-health-checkin`) that orchestrates the OID4VP flow using popup or same-tab handoffs, BroadcastChannel where needed, and a Verifier-controlled response endpoint.

### 3.1 Transport Mechanism

1.  **Initialization**: The shim generates an Ephemeral Key Pair via the Web Crypto API and initiates a transaction with the Verifier backend, choosing `same-device` or `cross-device`.
2.  **Metadata Discovery**: The shim constructs a minimal bootstrap request using the custom `well_known:` client identifier and a `request_uri`, suitable for a same-tab launch, popup, or QR code.
3.  **Request Verification**: The Wallet resolves `/.well-known/openid4vp-client`, fetches the signed Request Object, verifies it using the Verifier's `jwks_uri`, and extracts the authoritative OID4VP parameters.
4.  **Response Delivery**: The Wallet encrypts the payload and POSTs the `{JWE}` to the Verifier-controlled `response_uri`.
5.  **Completion Signal**: If the Request Object says `completion: "redirect"`, the response endpoint returns a `redirect_uri` containing a `response_code`. If it says `completion: "deferred"`, the response endpoint returns an acknowledgement and the Verifier app obtains the encrypted response through its own application path.
6.  **Decryption**: The Verifier frontend or backend component decrypts the `{JWE}`, validates `state`, resolves internal references, and returns the unwrapped data to the application.

### 3.2 The Shim API

The target shim API for this protocol profile is:

```javascript
// ES Module
import { request, completeSameDeviceRedirect, maybeHandleReturn } from 'smart-health-checkin';

// If this page was reached by a same-tab redirect return, resume it first;
// popup returns can still use maybeHandleReturn().
const completion = await completeSameDeviceRedirect();
if (completion) {
  renderResult(completion.response);
} else {
  await maybeHandleReturn();
}

function startCheckin() {
  // In replace mode, this navigates away; the redirect return above receives the result.
  void request(dcqlQuery, {
    walletUrl: 'https://picker.example.com',
    wellKnownClientUrl: 'https://clinic.example.com',
    flow: 'same-device',
    sameDeviceLaunch: 'replace' // or omit for popup compatibility
  });
}
```

---

## 4. Reference Implementation (Demo)

This repository contains a fully functional reference implementation of the protocol, demonstrating the E2EE flow and the Verifier-controlled response endpoint pattern.

### 4.1 Components

*   **Demo Landing Page (`demo/index.html`)**: Entry page linking to both demo scenarios.
*   **Patient Portal (`demo/portal`)**: Same-device demo where the patient starts from a portal page, the page navigates into the picker, and the redirect return resumes the portal session with `response_code`. The reference portal does not offer a cross-device QR mode.
*   **Front Desk Kiosk (`demo/kiosk`)**: Staff-session-bound cross-device demo where staff starts the request, the page shows a QR code and copyable link, and the patient completes the flow on another device.
*   **Picker (`demo/checkin`)**: A simple UI that helps users select their health app.
*   **Health App (`demo/source-app`)**: A mock health app implementation that acts as an OID4VP Provider.
*   **Verifier Backend / Response Endpoint (`demo/relay`)**: A backend that serves metadata and signed Request Objects, stores opaque encrypted responses, enforces same-device `response_code` redemption, and simulates authenticated staff sessions for cross-device use.
*   **Shared Demo Logic (`demo/shared`)**: Shared UI helpers used by the portal and kiosk experiences.

### 4.2 Running the Demo

For the standard local demo, build and serve in one step:

```bash
bun run demo
```

This builds with `deployments/local.json` and starts the demo at **http://localhost:3000**. For phone testing on the same network:

```bash
LOCAL_DEMO_ORIGIN=http://10.0.0.13:3000 bun run demo
```

If you already ran `bun run build`, serve the existing build directly:

```bash
bun run serve
```

Then choose:

*   **Patient Portal** for the same-device flow
*   **Front Desk Kiosk** for the cross-device flow

For the cross-device demo, the local demo server includes a simple staff login simulation:

*   username: any non-empty value
*   password: `demo`

## 5. License

MIT License

---

## Repository Layout

- `src/`: browser shim library
- `demo/portal`: same-device demo
- `demo/kiosk`: cross-device demo
- `demo/checkin`: shared picker / routing page
- `demo/source-app`: mock source app / wallet-side provider
- `demo/relay`: demo verifier backend / response endpoint
- `demo/shared`: shared demo UI helpers

## request() Entry Point

```javascript
import { request } from 'smart-health-checkin';

const result = await request(dcqlQuery, options);
```

**Parameters:**
- `dcqlQuery` (Object, required): A standard DCQL query object. See the DCQL profile below for structure.
- `options` (Object, required):
  - `walletUrl` (String, required): URL of the health app picker (e.g., `'https://picker.example.com'`).
  - `wellKnownClientUrl` (String, required): Bare HTTPS origin for the Verifier named by `well_known:` (e.g., `'https://clinic.example.com'`). The shim derives `client_id`, metadata resolution, request, response, and result endpoints from this base URL by convention.
  - `onRequestStart` (Function, optional): Callback invoked when the OID4VP request is constructed.
  - `rehydrate` (Boolean, optional, default: `true`): If `true`, the response resolves all internal references to output flat, easy-to-consume data arrays.

**Response (Promise resolution)**
```javascript
{
  state: '...',           // Echoed from request (decrypted)
  vp_token: {...},        // Map from credential IDs to Presentation objects (decrypted)
  credentials: {...}      // Rehydrated: map from credential IDs to unwrapped data (if rehydrate=true)
}
```

When `rehydrate` is `true` (default), the `credentials` object maps credential IDs to arrays of unwrapped credential data, making it easy to consume:
```javascript
const { credentials } = result;
const coverageData = credentials['req_insurance'][0]; // Direct access to the decrypted FHIR resource
```
