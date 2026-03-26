Here is the fully updated specification. It retains your original structure and core concepts but cleanly integrates the four major architectural upgrades we discussed: standardizing DCQL optionality, using inline references for deduplication inside the `vp_token`, **exclusively** using `direct_post.jwt` with ephemeral keys to a zero-trust relay for bulletproof, infinite-size E2E encryption, and authenticating web Verifiers with a custom `well_known:` client identifier prefix plus signed Request Objects.

***

# Architectural Upgrades & Implementation Changelist

This document has been upgraded from its initial draft to align with core **OpenID4VP** requirements, maximize compatibility with off-the-shelf Wallet SDKs, and provide strong security for Protected Health Information (PHI).

### 1. Universal E2E Encryption via Zero-Trust Relay (`direct_post.jwt`)
*   **What changed:** Removed plaintext browser fragment responses entirely. The protocol now exclusively mandates the `direct_post.jwt` response mode. Before every request, the browser generates an ephemeral key pair, passes the public key in the request, and asks the wallet to encrypt the response and POST it to a dumb backend relay.
*   **Why:** 
    1. **Security:** PHI is encrypted at the application layer. It is never exposed to browser extensions, browser history, or intermediate servers.
    2. **Payload Size:** Bypasses the ~2MB browser URL fragment limit, allowing massive clinical histories (like full FHIR bundles) to be transferred flawlessly.
    3. **Cross-Device Native:** This architecture natively supports Cross-Device flows (e.g., scanning a QR code on a desktop screen with a mobile wallet), as the desktop browser simply polls the relay for the encrypted payload.
*   **Implementation Impact:** The `shl.js` shim must now use the Web Crypto API to generate Ephemeral Elliptic Curve keys, construct a `client_metadata` parameter, and poll/listen to a Relay URL. A simple, stateless Relay Server is required to temporarily cache the opaque JWE strings.

### 2. DCQL Optionality: Standardized
*   **What changed:** Removed the custom `optional: true` flag from the credential query `meta` object. The profile now uses standard DCQL `credential_sets` with `required: false`.
*   **Why:** Strict, generic OpenID4VP DCQL engines ignore unknown parameters. Without `credential_sets`, standard wallets evaluate all items as strictly required, throwing errors if a user attempts to share a partial response.
*   **Implementation Impact:** Update the `shl.js` request builder to map optional credentials into individual, non-required `credential_sets`.

### 3. Payload Structure: Inline References
*   **What changed:** Removed the top-level `smart_artifacts` side-car array. Data is now placed directly inside the `vp_token`. To maintain payload deduplication (e.g., when one FHIR resource satisfies multiple queries), Presentations use an inline reference pattern (`artifact_id` and `artifact_ref`).
*   **Why:** Generic Wallet/Verifier SDKs expect presentation data to live exclusively inside `vp_token` and will strip unrecognized top-level parameters. 
*   **Implementation Impact:** Update the `rehydrate` function in `shl.js` to do a two-pass resolution over the `vp_token` (cataloging `artifact_id`s, then resolving `artifact_ref`s).

### 4. Authenticated Verifier Discovery via `well_known:`
*   **What changed:** Replaced unauthenticated `redirect_uri:`-style client identifiers with a profile-specific `well_known:` Client Identifier Prefix. The identifier carries only a bare Verifier origin; the Wallet resolves the Verifier's metadata from a fixed `.well-known` document under that origin, fetches a signed Request Object from `request_uri`, and verifies the request signature using keys advertised by the Verifier's domain.
*   **Why:**
    1. **Verifier Authentication:** The Wallet can distinguish "this request is controlled by the domain that owns this origin" from a self-asserted unsigned URL parameter.
    2. **Compact QR Codes:** The bootstrap request contains only `client_id`, `request_uri`, and `request_uri_method`, leaving the large request body and ephemeral encryption key in the signed Request Object.
    3. **Better UX:** A Wallet can safely display the Verifier origin for any valid `well_known:` request, and can optionally upgrade to metadata-supplied names and logos when the client identifier is present in a whitelist or trust framework.
*   **Implementation Impact:** The Verifier backend must host `/.well-known/openid4vp-client`, publish signing keys at `jwks_uri`, generate signed Request Objects, and maintain a transaction model with separate write and read secrets. Wallets and source apps that want to trust metadata-supplied names, logos, or policy semantics must maintain an allowlist or trust-framework-backed list of trusted `well_known:` client identifiers or base origins; metadata alone is not enough.

***

# SMART Health Check-in Protocol

**Public Demo**: https://joshuamandel.com/smart-health-checkin-demo

This repository defines a layered, browser-ready way to request and receive health data:
- **Browser API:** A polyfill (`shl.js`) that exposes a W3C Digital Credentials–style API so web apps can initiate requests and receive responses.
- **Wire protocol:** SMART Health Check-in v1 over OpenID for Verifiable Presentations (OID4VP) utilizing End-to-End Encrypted (E2EE) `direct_post.jwt` responses to a Verifier-controlled response endpoint, authenticated with the custom `well_known:` client identifier prefix and signed Request Objects.
- **Data model:** A strict DCQL profile that asks for FHIR resources (by canonical profile URL) or Questionnaires, with optional signing strategies (e.g., SHC) and support for inline payload deduplication.

## SHL.request Entry Point

**Request**
```javascript
const result = await SHL.request(dcqlQuery, options);
```

**Parameters:**
- `dcqlQuery` (Object, required): A standard DCQL query object. See the DCQL profile below for structure.
- `options` (Object, required):
  - `checkinBase` (String, required): URL of the health app picker (e.g., `'https://picker.example.com'`).
  - `verifierBase` (String, required): Bare HTTPS origin for the Verifier named by `well_known:` (e.g., `'https://clinic.example.com'`). The shim derives `client_id`, metadata resolution, request, response, and result endpoints from this base URL by convention.
  - `onRequestStart` (Function, optional): Callback invoked when the OID4VP request is constructed.
  - `rehydrate` (Boolean, optional, default: `true`): If `true`, the response resolves all internal references to output flat, easy-to-consume data arrays.

The current demo implementation still uses a lower-level `relayUrl` option internally. That is an implementation gap to be closed; the intended public API for this protocol profile is `verifierBase`.

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

---

## 1. SMART Health Check-in Profile of OID4VP

This section defines the **Protocol Profile**, specifying how OID4VP is used to transport the request and response. To ensure Protected Health Information (PHI) is never exposed to browser extensions, history logs, or intermediary servers, **all responses MUST be encrypted at the application layer and transported via a Verifier-controlled response endpoint that stores only opaque ciphertext.**

### 1.1 Ephemeral Keys, Transactions, and the Response Endpoint

Before initiating a request, the requesting client (e.g., the browser shim) MUST:
1. Generate a fresh Ephemeral Key Pair (e.g., ECDH-ES using P-256 or X25519) via the Web Crypto API. The private key remains securely in the browser's memory.
2. Initiate a transaction with the Verifier backend / response endpoint and declare whether the transaction is `same-device` or `cross-device`.

The Verifier backend MUST create at least the following values:
*   `transaction_id`: A secret bound to the Verifier frontend session. It is never sent to the Wallet.
*   `request_id`: A public correlation handle used as the OID4VP `state` value.
*   `read_secret`: A secret the Verifier frontend uses to fetch the stored Authorization Response from the backend.
*   `flow`: Transaction mode selected by the Verifier frontend, either `same-device` or `cross-device`.

The `response_uri` MUST be a request-specific, write-only Verifier-controlled endpoint such as `https://clinic.example.com/oid4vp/post/req_abc123xyz` or another opaque write handle under a Verifier-controlled prefix. This is necessary because, with `direct_post.jwt`, the Authorization Response parameters such as `state` are carried inside the encrypted JWT and are therefore not visible to the non-decrypting response endpoint. The response endpoint MAY be implemented as a dumb relay behind the Verifier origin. It accepts opaque JWE strings from Wallets, stores them temporarily, and delivers them only to the legitimate Verifier frontend/backend path. Because the endpoint does not possess the Ephemeral private key, it cannot read the PHI.

The response endpoint MUST NOT expose an interface where knowledge of `request_id` alone is sufficient to retrieve a posted Authorization Response.
The Verifier backend MUST persist the selected `flow` in the transaction state and use it to determine whether the response endpoint returns a same-device `redirect_uri` carrying `response_code`, or whether the response is completed only through the authenticated read path for cross-device use.

### 1.2 Authenticated Verifier Discovery (`well_known:`)

This profile defines a custom Client Identifier Prefix:

*   `client_id`: MUST use the `well_known` Client Identifier Prefix.
    *   Format: `well_known:<Verifier_Base_URL>`
    *   Example: `well_known:https://clinic.example.com`
    *   The `Verifier_Base_URL` MUST be an `https` origin with no path, query, or fragment.
    *   The input to `well_known:` is the bare origin before `/.well-known/...`; the metadata document path is derived by convention and is not carried in the identifier.
    *   Bare `https:` client identifiers are not used by this profile.

For a `well_known:` client, the Wallet MUST resolve Verifier metadata by fetching:

```text
<Verifier_Base_URL>/.well-known/openid4vp-client
```

For the example above, the Wallet fetches:

```text
https://clinic.example.com/.well-known/openid4vp-client
```

The metadata document MUST be JSON, MUST be served with the `application/json` Content-Type, and MUST contain the information needed to verify signed requests and validate response destinations. A typical example is:

```json
{
  "client_id": "well_known:https://clinic.example.com",
  "client_name": "General Hospital Cardiology",
  "logo_uri": "https://clinic.example.com/assets/logo.png",
  "policy_uri": "https://clinic.example.com/privacy",
  "tos_uri": "https://clinic.example.com/terms",
  "jwks_uri": "https://clinic.example.com/.well-known/jwks.json",
  "request_object_signing_alg_values_supported": ["ES256"],
  "response_uri_prefixes": ["https://clinic.example.com/oid4vp/post/"],
  "redirect_uris": ["https://clinic.example.com/oid4vp/return"],
  "vp_formats_supported": {
    "dc+sd-jwt": {
      "sd-jwt_alg_values": ["ES256"],
      "kb-jwt_alg_values": ["ES256"]
    }
  }
}
```

The Wallet MUST treat the discovered `jwks_uri` as authoritative for verifying signed Request Objects for this `client_id`.
Because the `well_known:` identifier is restricted to a bare origin, successful retrieval of the metadata document plus successful signature verification on the Request Object establishes that the request is controlled by the party that controls that origin and its `.well-known` metadata.

### 1.3 Display and Trust Requirements

Successful resolution of the `well_known:` metadata document and verification of the Request Object signature proves that the request is controlled by the domain owning the Verifier origin. Accordingly:

*   Wallets MAY display the bare origin from the `well_known:` identifier (for example, `https://clinic.example.com`) to users, even when the client is not part of a richer trust program.
*   Wallets, pickers, source apps, and any other relying components MUST NOT blindly trust metadata-supplied presentation details such as `client_name`, `logo_uri`, badges, or other branding solely because the metadata document fetched successfully and the request signature verified.
*   Any component that wants to use metadata-supplied names, logos, badges, or other semantics for upgraded user-facing trust or policy decisions MUST maintain a whitelist or trust-framework-backed list of trusted `well_known:` client identifiers or base origins. That list MUST be configured out of band and MUST NOT be learned from client-supplied metadata.
*   Trust decisions SHOULD be keyed by the exact `well_known:` client identifier and/or its configured bare origin, not by metadata-supplied display strings.
*   If a `well_known:` client is not in such a whitelist or trust framework, the Wallet MAY still proceed, but SHOULD fall back to displaying only the bare origin from the identifier and/or the origin of the `response_uri`, rather than presenting metadata-supplied names/logos as trusted institutional identity.
*   Verifiers and wallets MUST NOT assume that merely publishing metadata causes other parties to trust or privilege that metadata. Participation in a whitelist or trust framework is REQUIRED for those stronger UX outcomes.

### 1.4 Authorization Request

The Authorization Request MUST follow the requirements of OpenID for Verifiable Presentations, with the following profile requirements.

The bootstrap request shown in a browser popup or QR code SHOULD be minimal and SHOULD contain only:

*   `client_id`
*   `request_uri`
*   `request_uri_method`

**Bootstrap Example:**
```text
https://wallet.example.com/authorize?
  client_id=well_known:https://clinic.example.com&
  request_uri=https://clinic.example.com/oid4vp/request/123&
  request_uri_method=post
```

The actual request parameters MUST be conveyed in a signed Request Object fetched from `request_uri`.

**Parameters inside the signed Request Object:**

*   `client_id`: REQUIRED. MUST exactly match the bootstrap `client_id`.
*   `response_type`: MUST be `vp_token`.
*   `response_mode`: MUST be `direct_post.jwt`.
*   `response_uri`: REQUIRED. MUST be a request-specific write endpoint and MUST begin with one of the `response_uri_prefixes` published in the metadata document.
*   `client_metadata`: REQUIRED. Must contain the Ephemeral public key used by the Wallet to encrypt the response for this specific transaction.
    *   `jwks`: A JSON Web Key Set containing the Ephemeral public encryption key.
    *   `encrypted_response_enc_values_supported`: Array of supported encryption algorithms (e.g., `["A256GCM"]`).
*   `aud`: REQUIRED. MUST be `https://self-issued.me/v2` to comply with the OpenID4VP static-discovery Request Object requirements.
*   `nonce`: REQUIRED. A cryptographically random string.
*   `state`: REQUIRED. MUST be a cryptographically strong pseudo-random value with at least 128 bits of entropy. This profile RECOMMENDS using `request_id` as the `state` value.
*   `dcql_query`: REQUIRED. A JSON-encoded DCQL query object (defined in Section 2).

**Example Signed Request Object Payload:**
```json
{
  "iss": "well_known:https://clinic.example.com",
  "aud": "https://self-issued.me/v2",
  "client_id": "well_known:https://clinic.example.com",
  "response_type": "vp_token",
  "response_mode": "direct_post.jwt",
  "response_uri": "https://clinic.example.com/oid4vp/post/req_abc123xyz",
  "nonce": "def456uvw",
  "state": "req_abc123xyz",
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
5. Reject the request if `client_id`, `response_uri`, or other required values do not match the metadata policy.

### 1.5 Authorization Response

The Wallet processes the request, gathers the user's data, and builds a standard JSON response object containing `vp_token` and `state`.

Because `direct_post.jwt` is requested, the Wallet MUST encrypt this JSON payload into a JSON Web Encryption (JWE) string using the Ephemeral public key provided in the signed Request Object's `client_metadata.jwks`.

The Wallet makes an HTTP POST to the Verifier's `response_uri` with `Content-Type: application/x-www-form-urlencoded`, placing the opaque JWE string in the body:

```http
POST /oid4vp/post/req_abc123xyz HTTP/1.1
Host: clinic.example.com
Content-Type: application/x-www-form-urlencoded

response=eyJhbGciOiJFQ0RILUVTIi... (Opaque JWE String)
```

The response endpoint MUST identify the target transaction from the request-specific `response_uri` path or other opaque write handle that is visible before decryption. It MUST store the ciphertext and make it retrievable only through the Verifier's authenticated read path.

The endpoint MUST NOT rely on reading `state` from the incoming POST because, in `direct_post.jwt`, `state` is carried inside the encrypted JWT payload. The Verifier frontend or backend component that later decrypts the response MUST validate that the decrypted `state` matches the expected `request_id`.

For same-device flows, the response endpoint SHOULD return a JSON body containing a `redirect_uri` with a fresh `response_code` fragment or parameter. The original browser tab MUST present both its local `transaction_id`/`read_secret` and the `response_code` in order to fetch the stored response.

For example, the response endpoint could reply:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "redirect_uri": "https://clinic.example.com/oid4vp/return#response_code=091535f699ea575c7937fa5f0f454aee"
}
```

The `response_code` is a fresh, high-entropy, one-time value generated by the Verifier backend for that same-device completion step. It is not sufficient on its own to fetch the stored ciphertext; the Verifier frontend must still present the correct `transaction_id` and `read_secret` on the authenticated read path.

For cross-device flows, the Verifier frontend on the initiating device cannot rely on a same-browser redirect. In that case:
*   The initiating Verifier frontend MUST retrieve the stored response using its `transaction_id` and `read_secret`.

After retrieval, the frontend decrypts the JWE, validates `state`, resolves internal references, and continues application processing.

---

## 2. DCQL Profile for SMART Health Check-in

This section defines the **Data Profile**, specifying the structure of the DCQL query and the `vp_token` response.

### 2.1 Credential Format: `smart_artifact`

This profile defines a single Credential Format Identifier: **`smart_artifact`**. Because health data without Cryptographic Holder Binding does not utilize standard cryptographic proofs, `require_cryptographic_holder_binding` MUST be `false`.

The credential query object uses a standard DCQL structure. Properties specific to this profile are specified within the `meta` object:

| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | String | **Required by DCQL.** Unique ID for this request item. |
| `format` | String | **Required by DCQL.** Must be `"smart_artifact"` for this profile. |
| `require_cryptographic_holder_binding` | Boolean | **Required by this profile.** Must be `false`. |
| `meta.profile` | String | **Optional.** Canonical URL of a FHIR StructureDefinition (e.g., for Patient, Coverage). |
| `meta.questionnaire` | Object | **Optional.** Full FHIR Questionnaire JSON to be rendered/completed by the user. |
| `meta.questionnaireUrl` | String | **Optional.** Alternative to `questionnaire`: URL reference to a Questionnaire resource. |
| `meta.signing_strategy` | Array | **Optional.** Array of acceptable signing strategies: `["none"]` (default), `["shc_v1"]`, `["shc_v2"]`. |

#### Handling Optionality
To mark a credential as optional while remaining strictly compliant with generic DCQL parsers, requests MUST wrap the targeted credential ID in a non-required `credential_sets` object.

**Example: Requesting Optional Insurance and Optional History:**
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
      "id": "req_history",
      "format": "smart_artifact",
      "require_cryptographic_holder_binding": false,
      "meta": { "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient" }
    }
  ],
  "credential_sets": [
    { "options": [["req_insurance"]], "required": false },
    { "options": [["req_history"]], "required": false }
  ]
}
```

### 2.2 Response Structure (Inline References)

To comply with OID4VP structure requirements while minimizing payload size and eliminating data duplication (e.g., when one FHIR Bundle satisfies multiple queries), this profile uses an **Inline Reference** pattern entirely contained within the `vp_token`.

A Presentation object inside the `vp_token` array MUST take one of two shapes:

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

When the Wallet cannot or will not fulfill the request, it generates a standard OID4VP error response (`error`, `error_description`, `state`). Under `direct_post.jwt`, this error payload MUST also be encrypted as a JWE and POSTed to the Verifier-controlled response endpoint.

When decrypted, the JWE payload will be a JSON object containing standard OAuth 2.0 / OpenID4VP error parameters, for example:

```json
{
  "error": "access_denied",
  "state": "abc123xyz"
}
```

---

## 3. Browser-Based Implementation (The "Shim")

To enable this protocol in pure browser environments, the reference implementation uses a **W3C Digital Credentials API Shim** (`shl.js`) combined with the response endpoint / relay service. The current demo still models this endpoint as a separate `relayUrl`, but the protocol profile above assumes that production deployments place that endpoint under the Verifier's control and associate it with the `well_known:` origin.

### 3.1 Transport Mechanism (Universal Relay)

1.  **Initialization**: `shl.js` generates an Ephemeral Key Pair via the Web Crypto API and starts a Verifier transaction, explicitly choosing `same-device` or `cross-device`, and receiving a `transaction_id`, `request_id`, and `read_secret`.
2.  **Metadata Discovery**: The shim constructs a minimal bootstrap request using the custom `well_known:` client identifier and a `request_uri`, suitable for either a popup or QR code.
3.  **Request Verification**: The Wallet resolves `/.well-known/openid4vp-client`, fetches the signed Request Object, verifies it using the Verifier's `jwks_uri`, and extracts the authoritative OID4VP parameters.
4.  **Response Delivery**: The Wallet encrypts the payload and POSTs the `{JWE}` to the Verifier-controlled `response_uri`.
5.  **Completion Signal**: In same-device flows, the response endpoint returns a `redirect_uri` containing a `response_code`; in cross-device flows, the initiating browser retrieves the stored ciphertext using its local `transaction_id` and `read_secret`.
6.  **Decryption**: The Verifier frontend fetches the stored `{JWE}`, decrypts it locally, validates `state`, resolves internal references, and returns the unwrapped data to the application.

### 3.2 The Shim API

The target shim API for this protocol profile is:

```javascript
// ES Module
import { request, maybeHandleReturn } from 'smart-health-checkin';

// Make a request
const result = await request(dcqlQuery, {
  checkinBase: 'https://picker.example.com',
  verifierBase: 'https://clinic.example.com',
  flow: 'same-device'
});

// The result.credentials object is decrypted and automatically rehydrated
const coverageData = result.credentials['req_insurance'][0];
```

The current demo code still uses `relayUrl` internally until the shim is migrated to this higher-level API.

---

## 4. Reference Implementation (Demo)

This repository contains a fully functional reference implementation of the protocol, demonstrating the E2EE flow and zero-trust relay.

### 4.1 Components

*   **Requester (`demo/requester`)**: A demo "Doctor's Clinic" app that initiates the flow.
*   **Picker (`demo/checkin`)**: A simple UI that helps users select their health app.
*   **Health App (`demo/source-flexpa`)**: A mock health app implementation that acts as an OID4VP Provider.
*   **Relay / Response Endpoint (`demo/relay`)**: A backend that temporarily caches encrypted JWE POSTs for delivery to the frontend. In production, this endpoint sits behind the Verifier origin and participates in transaction management.

### 4.2 Running the Demo

To simulate the cross-origin security model locally:

```bash
./start-local.sh
```

This starts all necessary servers on different ports (Requester, Check-in, Relay, and Flexpa).
Visit **http://requester.localhost:3000** to try the flow.

## 5. License

MIT License
