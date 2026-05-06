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

This profile supports same-device and cross-device ceremonies using standard OID4VP/OAuth envelope semantics. The protocol does not prescribe the Verifier's internal storage or retrieval architecture; it requires these shared behaviors:

*   The Wallet encrypts and POSTs the response to `response_uri`.
*   The Verifier obtains the encrypted response, decrypts it, and validates `state`.
*   The Verifier performs the binding checks needed for the selected OID4VP/OAuth completion path before using decrypted data.
*   In same-device flows, the response endpoint can return a continuation `redirect_uri` containing a fresh `response_code`.
*   In cross-device flows, the response endpoint returns an acknowledgement and the Verifier retrieves the ciphertext through its own authenticated application path.

How the Verifier validates return URIs, authenticates result retrieval, and binds transactions to application sessions is an implementation concern, not a protocol requirement. The [reference relay implementation](demo/relay/README.md) provides one approach.

Before decrypted response data is revealed downstream, including display to a user, persistence as clinical data, or onward sharing to another system, the Verifier SHALL confirm that the response is being completed in the expected application context. For same-device redirects, the Verifier SHALL bind the `response_code` to the initiating transaction and application session. For deferred cross-device retrieval, the Verifier SHALL bind response access to an authenticated Verifier session authorized for that transaction, such as a valid staff session in a kiosk workflow.

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
*   `dcql_query`: Required. A DCQL query object containing exactly one Credential Query:
    *   `id`: SHALL be `smart-checkin`.
    *   `format`: SHALL be `smart_health_checkin`.
    *   `meta.request`: SHALL be the SMART clinical request object defined in Section 2.

The signed Request Object SHALL NOT include `redirect_uri` for this `direct_post.jwt` profile. Same-device continuation is represented by the response endpoint returning a continuation `redirect_uri` after the Wallet POSTs the encrypted response.

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
  "dcql_query": {
    "credentials": [
      {
        "id": "smart-checkin",
        "format": "smart_health_checkin",
        "require_cryptographic_holder_binding": false,
        "meta": {
          "request": {
            "type": "smart-health-checkin-request",
            "version": "1",
            "id": "checkin-request-123",
            "purpose": "Clinic check-in",
            "fhirVersions": ["4.0.1"],
            "items": [
              {
                "id": "coverage",
                "title": "Insurance card",
                "summary": "Member coverage and payer details.",
                "required": false,
                "content": {
                  "kind": "selection.fhir",
                  "profiles": [
                    "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"
                  ]
                },
                "accept": ["application/fhir+json"]
              },
              {
                "id": "intake",
                "title": "Migraine follow-up",
                "summary": "Migraine follow-up form.",
                "required": false,
                "content": {
                  "kind": "form.fhir",
                  "questionnaireCanonical": "https://smart-health-checkin.example.org/fhir/Questionnaire/chronic-migraine-followup"
                },
                "accept": ["application/fhir+json"]
              }
            ]
          }
        }
      }
    ]
  },
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
6. Treat `dcql_query.credentials[0].meta.request` as the authoritative SMART clinical request for this transaction.

For clarity, these fields are not part of the SMART clinical request and are not nested under `meta.request`: `client_id`, `response_uri`, `state`, `nonce`, `client_metadata`, relay transaction ids, response codes, redirect/completion hints, and requester display metadata.

### 1.5 Authorization Response

The Wallet processes the request, gathers the user's data, and builds a standard JSON response object containing `vp_token` and `state`. Because this profile uses DCQL, `vp_token` SHALL be a JSON object keyed by DCQL Credential Query `id`. This profile always uses the single Credential Query id `smart-checkin`, so the response has one key: `vp_token["smart-checkin"]`.

The value of `vp_token["smart-checkin"]` SHALL be an array of Presentations, as required by OID4VP/DCQL. Because the SMART Health Check-in response is a single domain-level Presentation, this array SHALL contain exactly one object: the SMART clinical response.

The response SHALL NOT include `presentation_submission`; that field belongs to Presentation Exchange flows. DCQL responses are correlated by the `vp_token` object keys.

**Plaintext Authorization Response before JWE encryption:**
```json
{
  "state": "req_abc123xyz",
  "vp_token": {
    "smart-checkin": [
      {
        "type": "smart-health-checkin-response",
        "version": "1",
        "requestId": "checkin-request-123",
        "artifacts": [
          {
            "id": "artifact-coverage",
            "mediaType": "application/fhir+json",
            "fhirVersion": "4.0.1",
            "fulfills": ["coverage"],
            "value": {
              "resourceType": "Coverage",
              "id": "cov-123",
              "status": "active"
            }
          }
        ],
        "requestStatus": [
          {
            "item": "coverage",
            "status": "fulfilled"
          },
          {
            "item": "intake",
            "status": "declined"
          }
        ]
      }
    ]
  }
}
```

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

For same-device completion, the response endpoint MAY return a JSON body containing a `redirect_uri` with a fresh `response_code` fragment or parameter. That returned URI is not Verifier identity evidence and is not required to be validated by the Wallet against Verifier metadata. It is a continuation URI selected by the Verifier.

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

For cross-device completion, the response endpoint SHALL return a success acknowledgement and SHALL NOT require the Wallet to follow a continuation URI. The Verifier retrieves or processes the response through its own application path. Before revealing decrypted data downstream, that path SHALL require an authenticated Verifier session authorized for the transaction.

After retrieval, the frontend decrypts the JWE, validates `state`, validates the SMART clinical response against the original SMART clinical request, and continues application processing.

---

## 2. SMART Clinical Payload in OID4VP

This section defines the data profile carried by OID4VP. The OID4VP shell carries exactly one custom DCQL Credential Query with `id: "smart-checkin"` and `format: "smart_health_checkin"`. The clinical request itself is the transport-neutral SMART Health Check-in request object under `meta.request`.

The SMART request body SHALL NOT carry requester identity, verifier metadata, redirect/completion behavior, nonces, encryption details, handoff handles, or relay URLs. Those are OID4VP/OAuth envelope concerns.

Clinical granularity belongs inside the SMART payload, not the DCQL shell. Implementations SHALL NOT create one DCQL Credential Query per clinical item. Instead:

- Requested clinical units are `meta.request.items[]`.
- Returned clinical artifacts identify fulfilled items through `artifacts[].fulfills[]`.
- Item-level accounting is reported through `requestStatus[]`.

**Wire contract summary:**

- Request Object: exactly one DCQL Credential Query, `credentials[0].id === "smart-checkin"`.
- Request Object: `credentials[0].format === "smart_health_checkin"`.
- Request Object: SMART clinical request at `credentials[0].meta.request`.
- Response: `vp_token` is keyed by the DCQL Credential Query id, so it contains `vp_token["smart-checkin"]`.
- Response: `vp_token["smart-checkin"]` is a one-element array of Presentations.
- Response: the sole Presentation is the SMART clinical response object.
- Completion: `direct_post.jwt` uses `response_uri` in the Request Object; any continuation `redirect_uri` is returned by the response endpoint after the Wallet POST.

Changing any of those protocol choices requires coordinated updates in the relay Request Object builder, source apps, requester response validation, demo transaction viewer, tests, and this documentation.

### 2.1 Request Shape

```json
{
  "credentials": [
    {
      "id": "smart-checkin",
      "format": "smart_health_checkin",
      "require_cryptographic_holder_binding": false,
      "meta": {
        "request": {
          "type": "smart-health-checkin-request",
          "version": "1",
          "id": "checkin-request-123",
          "purpose": "Clinic check-in",
          "fhirVersions": ["4.0.1"],
          "items": [
            {
              "id": "coverage",
              "title": "Insurance card",
              "summary": "Member coverage and payer details.",
              "required": false,
              "content": {
                "kind": "selection.fhir",
                "profiles": [
                  "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"
                ]
              },
              "accept": ["application/fhir+json"]
            }
          ]
        }
      }
    }
  ]
}
```

Each clinical request item is the Holder-review and response-accounting unit. It contains `id`, `title`, optional `summary`, advisory `required`, selector `content`, and non-empty ordered `accept[]`.

FHIR profile selectors use `content.kind: "selection.fhir"` with `profiles[]`, `profilesFrom[]`, and/or `resourceTypes[]`. Questionnaire completion uses `content.kind: "form.fhir"` with `questionnaireCanonical`, `questionnaire`, or both.

The DCQL Credential Query id is stable (`smart-checkin`) across requests. The SMART request `id` is the transaction-specific clinical request identifier and is echoed by the response as `requestId`.

### 2.2 Response Shape

The encrypted OID4VP response carries one SMART clinical response object as the single Presentation in the `vp_token["smart-checkin"]` array:

```json
{
  "state": "abc123xyz",
  "vp_token": {
    "smart-checkin": [
      {
        "type": "smart-health-checkin-response",
        "version": "1",
        "requestId": "checkin-request-123",
        "artifacts": [
          {
            "id": "artifact-coverage",
            "mediaType": "application/fhir+json",
            "fhirVersion": "4.0.1",
            "fulfills": ["coverage"],
            "value": {
              "resourceType": "Coverage",
              "id": "cov-123",
              "status": "active"
            }
          }
        ],
        "requestStatus": [
          {
            "item": "coverage",
            "status": "fulfilled"
          }
        ]
      }
    ]
  }
}
```

The Verifier validates `requestId`, every `artifacts[].fulfills[]` reference, every artifact `mediaType` against the fulfilled item's `accept[]`, FHIR versions, and exactly one `requestStatus[]` entry per original request item.

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
5.  **Completion Signal**: The `direct_post.jwt` response endpoint returns either a continuation `redirect_uri` containing a `response_code` or a success acknowledgement. The SMART clinical request body does not carry this choice.
6.  **Decryption**: The Verifier frontend or backend component decrypts the `{JWE}`, validates `state`, validates the SMART clinical response against the original SMART clinical request, and returns the unwrapped data to the application.

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

function startCheckin(smartRequest) {
  // In replace mode, this navigates away; the redirect return above receives the result.
  void request(smartRequest, {
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

const result = await request(smartRequest, options);
```

**Parameters:**
- `smartRequest` (Object, required): A SMART Health Check-in clinical request with `type`, `version`, `id`, `items[]`, selectors, and `accept[]`.
- `options` (Object, required):
  - `walletUrl` (String, required): URL of the health app picker (e.g., `'https://picker.example.com'`).
  - `wellKnownClientUrl` (String, required): Bare HTTPS origin for the Verifier named by `well_known:` (e.g., `'https://clinic.example.com'`). The shim derives `client_id`, metadata resolution, request, response, and result endpoints from this base URL by convention.
  - `onRequestStart` (Function, optional): Callback invoked when the OID4VP request is constructed.
  - `rehydrate` (Boolean, optional, default: `true`): If `true`, the response groups returned Artifacts by fulfilled request item and exposes their values as convenience arrays.

**Response (Promise resolution)**
```javascript
{
  state: '...',           // Echoed from request (decrypted)
  vp_token: {...},        // OID4VP map with the SMART response array under "smart-checkin"
  smartResponse: {...},   // SMART Health Check-in response
  artifactsByItem: {...}, // Rehydrated: map from request item IDs to Artifact objects
  credentials: {...}      // Rehydrated: map from request item IDs to Artifact values
}
```

When `rehydrate` is `true` (default), the `credentials` object maps request item IDs to arrays of unwrapped Artifact values, making it easy to consume:
```javascript
const { credentials } = result;
const coverageData = credentials.coverage[0]; // Direct access to the decrypted FHIR resource
```
