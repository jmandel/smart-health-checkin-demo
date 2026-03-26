Here is the fully updated specification. It retains your original structure and core concepts but cleanly integrates the three major architectural upgrades we discussed: standardizing DCQL optionality, using inline references for deduplication inside the `vp_token`, and **exclusively** using `direct_post.jwt` with ephemeral keys to a zero-trust relay for bulletproof, infinite-size E2E encryption.

***

# Architectural Upgrades & Implementation Changelist

This document has been upgraded from its initial draft to ensure strict compliance with the **OpenID4VP 1.1** specification, maximize compatibility with off-the-shelf Wallet SDKs, and provide bulletproof security for Protected Health Information (PHI).

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

***

# SMART Health Check-in Protocol

**Public Demo**: https://joshuamandel.com/smart-health-checkin-demo

This repository defines a layered, browser-ready way to request and receive health data:
- **Browser API:** A polyfill (`shl.js`) that exposes a W3C Digital Credentials–style API so web apps can initiate requests and receive responses.
- **Wire protocol:** SMART Health Check-in v1 over OpenID for Verifiable Presentations (OID4VP) utilizing End-to-End Encrypted (E2EE) direct post responses (`direct_post.jwt`) to a zero-trust relay, using `redirect_uri:` client identifiers.
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
  - `relayUrl` (String, required): The base URL of the dumb backend relay (e.g., `'https://relay.smarthealth.org'`).
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

---

## 1. SMART Health Check-in Profile of OID4VP

This section defines the **Protocol Profile**, specifying how OID4VP is used to transport the request and response. To ensure Protected Health Information (PHI) is never exposed to browser extensions, history logs, or intermediary servers, **all responses MUST be encrypted at the application layer and transported via a backend relay.**

### 1.1 Ephemeral Keys & The Zero-Trust Relay

Before initiating a request, the requesting client (e.g., the browser shim) MUST:
1. Generate a fresh Ephemeral Key Pair (e.g., ECDH-ES using P-256 or X25519) via the Web Crypto API. The private key remains securely in the browser's memory.
2. Request a unique `session_id` from the designated Relay Server.

The Relay Server acts purely as a dumb pipe. It accepts opaque JSON Web Encryption (JWE) strings from Wallets, caches them temporarily, and delivers them to the polling browser. Because the Relay does not possess the private key, it cannot read or alter the PHI.

### 1.2 Authorization Request

The Authorization Request MUST follow the requirements of OpenID for Verifiable Presentations 1.1.

**Parameters:**

*   `response_type`: MUST be `vp_token`.
*   `response_mode`: MUST be `direct_post.jwt`. This forces the Wallet to encrypt the response payload and POST it to the `response_uri`.
*   `client_id`: MUST use the `redirect_uri` Client Identifier Prefix.
    *   Format: `redirect_uri:<Redirect_URI>`
    *   Example: `redirect_uri:https://clinic.example.com/return`
    *   **Security Note**: With this prefix, the Wallet has no verified client identity. Wallets MUST display only the origin (e.g., `https://clinic.example.com`) to users.
*   `response_uri`: REQUIRED. The endpoint on the Relay Server specific to this session (e.g., `https://relay.smarthealth.org/post/session-123`).
*   `client_metadata`: REQUIRED. Must contain the ephemeral public key to enable the Wallet to encrypt the payload.
    *   `jwks`: A JSON Web Key Set containing the ephemeral public encryption key.
    *   `encrypted_response_enc_values_supported`: Array of supported encryption algorithms (e.g., `["A128GCM", "A256GCM"]`).
*   `nonce`: REQUIRED. A cryptographically random string.
*   `state`: REQUIRED. MUST be a cryptographically strong pseudo-random value with at least 128 bits of entropy. The Verifier MUST validate that the decrypted response `state` matches this value.
*   `dcql_query`: REQUIRED. A JSON-encoded DCQL query object (defined in Section 2).

**Example Request:**
```text
https://wallet.example.com/authorize?
  client_id=redirect_uri:https://clinic.example.com/return&
  response_type=vp_token&
  response_mode=direct_post.jwt&
  response_uri=https://relay.smarthealth.org/post/session-123&
  state=abc123xyz&
  nonce=def456uvw&
  client_metadata={"jwks": {"keys": [{"kty": "EC", "crv": "P-256", "use": "enc", "alg": "ECDH-ES", "x": "...", "y": "..."}]}, "encrypted_response_enc_values_supported": ["A256GCM"]}&
  dcql_query={...}
```

### 1.3 Authorization Response

The Wallet processes the request, gathers the user's data, and builds a standard JSON response object containing `vp_token` and `state`. 

Because `direct_post.jwt` is requested, the Wallet MUST encrypt this JSON payload into a JSON Web Encryption (JWE) string using the ephemeral public key provided in `client_metadata.jwks`.

The Wallet makes an HTTP POST to the `response_uri` (the Relay Server) with `Content-Type: application/x-www-form-urlencoded`, placing the opaque JWE string in the body:
```http
POST /post/session-123 HTTP/1.1
Host: relay.smarthealth.org
Content-Type: application/x-www-form-urlencoded

response=eyJhbGciOiJFQ0RILUVTIi... (Opaque JWE String)
```

*(Note: After posting, the Wallet app may optionally redirect the user's browser back to the app's registered `redirect_uri` to smoothly return focus to the requesting web app. The data payload, however, flows securely through the Relay).*

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

When the Wallet cannot or will not fulfill the request, it generates a standard OID4VP error response (`error`, `error_description`, `state`). Under `direct_post.jwt`, this error payload MUST also be encrypted as a JWE and POSTed to the Relay Server.

---

## 3. Browser-Based Implementation (The "Shim")

To enable this protocol in pure browser environments, the reference implementation uses a **W3C Digital Credentials API Shim** (`shl.js`) combined with the Relay Server.

### 3.1 Transport Mechanism (Universal Relay)

1.  **Initialization**: `shl.js` generates an Ephemeral Key Pair via the Web Crypto API.
2.  **Session Creation**: `shl.js` requests a `session_id` from the Relay Server and begins polling (or opens a WebSocket).
3.  **Request**: The shim opens the Health App URL (via a Picker) in a popup window, or renders it as a QR code, passing the OID4VP query parameters including `direct_post.jwt`, `response_uri`, and `client_metadata.jwks`.
4.  **Response Delivery**: The Wallet processes the request, encrypts the payload, and POSTs the `{JWE}` to the Relay. (The Wallet may optionally redirect the popup to close it).
5.  **Decryption**: The Relay blindly forwards the `{JWE}` string to `shl.js`. `shl.js` decrypts the JWE, validates `state`, resolves internal references, and returns the unwrapped data to the application.

### 3.2 The Shim API

```javascript
// ES Module
import { request, maybeHandleReturn } from 'smart-health-checkin';

// Make a request
const result = await request(dcqlQuery, {
  checkinBase: 'https://picker.example.com',
  relayUrl: 'https://relay.smarthealth.org'
});

// The result.credentials object is decrypted and automatically rehydrated
const coverageData = result.credentials['req_insurance'][0];
```

---

## 4. Reference Implementation (Demo)

This repository contains a fully functional reference implementation of the protocol, demonstrating the E2EE flow and zero-trust relay.

### 4.1 Components

*   **Requester (`demo/requester`)**: A demo "Doctor's Clinic" app that initiates the flow.
*   **Picker (`demo/checkin`)**: A simple UI that helps users select their health app.
*   **Health App (`demo/source-flexpa`)**: A mock health app implementation that acts as an OID4VP Provider.
*   **Relay Server (`demo/relay`)**: A stateless NodeJS backend that temporarily caches encrypted JWE POSTs for delivery to the frontend.

### 4.2 Running the Demo

To simulate the cross-origin security model locally:

```bash
./start-local.sh
```

This starts all necessary servers on different ports (Requester, Check-in, Relay, and Flexpa).
Visit **http://requester.localhost:3000** to try the flow.

## 5. License

MIT License
