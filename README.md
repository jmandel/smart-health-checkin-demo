# SMART Health Check-in Protocol

**Public Demo**: https://joshuamandel.com/smart-health-checkin-demo

This repository defines a layered, browser-ready way to request and receive health data:
- **Browser API:** A polyfill (`shl.js`) that exposes a W3C Digital Credentials–style API so web apps can initiate requests and receive responses.
- **Wire protocol:** SMART Health Check-in v1 over OpenID for Verifiable Presentations (OID4VP) using the fragment response mode and `redirect_uri:` client identifiers
    - **Data model:** A simple DCQL profile that asks for FHIR resources (by canonical profile URL) or Questionnaires, with optional signing strategies (e.g., SHC) and support for SHL links.

## SHL.request Entry Point

**Request**
```javascript
const result = await SHL.request(dcqlQuery, options);
```

**Parameters:**
- `dcqlQuery` (Object, required): A DCQL query object with a `credentials` array. See the DCQL profile below for structure.
- `options` (Object, required):
  - `checkinBase` (String, required): URL of the health app picker (e.g., `'https://picker.example.com'` or `'http://localhost:3001'`)
  - `onRequestStart` (Function, optional): Callback invoked when the OID4VP request is constructed, receives the request parameters
  - `rehydrate` (Boolean, optional, default: `true`): If `true`, the response includes a `credentials` object with unwrapped data for easy consumption

**Response (Promise resolution)**
```javascript
{
  state: '...',           // Echoed from request
  vp_token: {...},        // Map from credential IDs to artifact indices
  smart_artifacts: [...], // Array of typed wrappers { type, data }
  credentials: {...}      // Rehydrated: map from credential IDs to unwrapped data arrays (if rehydrate=true)
}
```

When `rehydrate` is `true` (default), the `credentials` object maps credential IDs to arrays of unwrapped credential data, making it easy to consume:
```javascript
const { credentials } = result;
const coverageData = credentials['coverage-1'][0]; // Direct access to FHIR Coverage resource
```

**Return handling**
- On page load, call `SHL.maybeHandleReturn()` to detect a returned popup, broadcast the response to the opener via `BroadcastChannel`, and close the popup.

## 1. SMART Health Check-in Profile of OID4VP

This section defines the **Protocol Profile**, specifying how OID4VP is used to transport the request and response.

### 1.1 Authorization Request

The Authorization Request MUST follow the requirements of OpenID for Verifiable Presentations 1.0.

**Parameters:**

*   `response_type`: MUST be `vp_token`.
*   `response_mode`: MUST be `fragment` (for browser-based flows).
*   `client_id`: MUST use the `redirect_uri` Client Identifier Prefix.
    *   Format: `redirect_uri:<Redirect_URI>`
    *   Example: `redirect_uri:https://clinic.example.com/return`
    *   **Security Note**: With this prefix, the Wallet has no verified client identity—only the redirect URI. Wallets MUST display only the origin (e.g., `https://clinic.example.com`) to users, not any unverified client name or branding. This mirrors how browsers display origins for permission prompts.
*   `nonce`: REQUIRED. A cryptographically random string used by the Wallet for internal request-response binding. Note: Since this profile uses `require_cryptographic_holder_binding: false`, the `nonce` is NOT returned in the Authorization Response. Instead, `state` provides the verifier-to-response binding.
*   `state`: REQUIRED. MUST be a cryptographically strong pseudo-random value with at least 128 bits of entropy, chosen fresh for each request. The Verifier MUST validate that the response `state` matches the request `state`.
*   `dcql_query`: REQUIRED. A JSON-encoded DCQL query object (defined in Section 2).

**Example Request:**
```
https://wallet.example.com/authorize?
  client_id=redirect_uri:https://clinic.example.com/return&
  response_type=vp_token&
  response_mode=fragment&
  state=...&
  nonce=...&
  dcql_query={
    "credentials": [
      {
        "id": "req_1",
        "format": "smart_artifact",
        "meta": { "profile": "..." }
      }
    ]
  }
```

### 1.2 Authorization Response

The response is returned to the `redirect_uri` in the URL fragment.

**Parameters:**

*   `vp_token`: REQUIRED. The Verifiable Presentation Token (defined in Section 2).
*   `smart_artifacts`: REQUIRED. The credential data array (defined in Section 2).
*   `state`: REQUIRED. Must match the request state.

**Note on `nonce`:** Following OID4VP requirements for Presentations without Holder Binding, the `nonce` parameter is included in the Authorization Request but is NOT returned in the Authorization Response. The `state` parameter alone provides request-response binding for the Verifier.

---

## 2. DCQL Profile for SMART Health Check-in

This section defines the **Data Profile**, specifying the structure of the DCQL query and the response.

### 2.1 Credential Format: `smart_artifact`

This profile defines a single Credential Format Identifier: **`smart_artifact`**.

The credential query object uses a **standard DCQL structure**. Properties specific to this profile are specified within the `meta` object:

| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | String | **Required by DCQL.** Unique ID for this request item. |
| `format` | String | **Required by DCQL.** Must be `"smart_artifact"` for this profile. |
| `optional` | Boolean | **Profile extension.** Must be `true` for this profile. This is an extension field (not part of standard DCQL) that indicates users may decline to share this credential and partial responses are valid. Standard DCQL uses `credential_sets` with `required: false` for optional credentials; this profile uses `optional` for simplicity. Conformant OID4VP implementations will ignore this unknown property per spec. |
| `meta` | Object | **Required by this profile.** Container for profile-specific constraints. Must contain at least one of the profile-specific fields below. (Note: In DCQL, `meta` is optional and can be an empty object `{}` if no constraints are needed.) |
| `meta.profile` | String | **Optional.** Canonical URL of a FHIR StructureDefinition (e.g., for Patient, Coverage). |
| `meta.questionnaire` | Object | **Optional.** Full FHIR Questionnaire JSON to be rendered/completed by the user. |
| `meta.questionnaireUrl` | String | **Optional.** Alternative to `questionnaire`: URL reference to a Questionnaire resource. |
| `meta.signing_strategy` | Array | **Optional.** Array of acceptable signing strategies: `["none"]` (default), `["shc_v1"]`, `["shc_v2"]`, or multiple like `["shc_v1", "shc_v2"]`. |
| `require_cryptographic_holder_binding` | Boolean | **Required by this profile.** Must be `false` for this profile. |

#### Examples

**Requesting Insurance (Raw Data):**
```json
{
  "credentials": [
    {
      "id": "req_insurance",
      "format": "smart_artifact",
      "optional": true,
      "require_cryptographic_holder_binding": false,
      "meta": {
        "profile": "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"
      }
    }
  ]
}
```

**Requesting a Form (User Input):**
```json
{
  "credentials": [
    {
      "id": "req_intake",
      "format": "smart_artifact",
      "optional": true,
      "require_cryptographic_holder_binding": false,
      "meta": {
        "questionnaire": {
          "resourceType": "Questionnaire",
          "status": "active",
          "item": [{ "linkId": "1", "text": "Allergies?", "type": "string" }]
        }
      }
    }
  ]
}
```

**Requesting a Signed Immunization Record (SHC):**
```json
{
  "credentials": [
    {
      "id": "req_immunization",
      "format": "smart_artifact",
      "optional": true,
      "require_cryptographic_holder_binding": false,
      "meta": {
        "profile": "http://hl7.org/fhir/StructureDefinition/Immunization",
        "signing_strategy": ["shc_v1", "shc_v2"]
      }
    }
  ]
}
```

### 2.2 Response Structure

To comply with OID4VP structure requirements (Section 6.1) while minimizing payload size, this profile uses a split-payload pattern with **typed wrappers**.

The Authorization Response MUST include two parameters in the URL fragment:

#### `vp_token` (The Mapping)

REQUIRED. A JSON Object where keys correspond to the `id`s defined in the `dcql_query` of the request.

*   **Keys:** The DCQL Request ID string.
*   **Values:** An Array of **Presentation Objects**. Each object has an `artifact` property containing a zero-based index referencing an item in the `smart_artifacts` array. This structure ensures each presentation is an object per OID4VP requirements.

#### `smart_artifacts` (The Data)

REQUIRED. A JSON Array containing **typed credential wrappers**.

Each wrapper is a JSON Object with:

| Property | Description |
|----------|-------------|
| `type`   | REQUIRED. String. The artifact type identifier. Defined values: `"fhir_resource"` (FHIR resource object), `"shc"` (SMART Health Card), `"shl"` (SMART Health Link). |
| `data`   | REQUIRED. The actual credential payload. Format depends on `type`. (Object for resources, String for links/cards). |

**Example Response:**

Scenario: Insurance request (Index 0) returned as JSON, History request (Index 1) returned as SHL.

```json
{
  "vp_token": {
    "req_insurance": [{"artifact": 0}],
    "req_history": [{"artifact": 1}]
  },
  "smart_artifacts": [
    {
      "type": "fhir_resource",
      "data": {
        "resourceType": "Coverage",
        "id": "cov-123",
        "status": "active",
        "payor": [{ "display": "Aetna" }]
      }
    },
    {
      "type": "shl",
      "data": "shlink:/eyJhbGci..."
    }
  ]
}
```

#### Format-Specific Presentation Definition

For the `smart_artifact` Credential Format, a **Presentation** is defined as an object with an `artifact` property that references a typed wrapper in the `smart_artifacts` array.

This indirection pattern:
- Ensures each presentation is an object per OID4VP §6.1 ("Each Presentation is represented as a string or object, depending on the format")
- Allows many-to-many mapping between request IDs and response data without duplication
- Enables efficient payload encoding when the same credential satisfies multiple requests, avoiding duplication through the shared reference mechanism

**Note:** Client libraries (such as `shl.js`) can rehydrate the response before exposing it to applications by replacing indices with actual data from `smart_artifacts`, unwrapping the typed wrappers in the process.

#### Implementation Considerations

**Fragment Size Limits**: Browser URL fragments have size limits (varying by browser, typically ~2MB). For large payloads such as comprehensive clinical histories, Wallets SHOULD return a SMART Health Link (`type: "shl"`) instead of inline FHIR resources. This allows the Verifier to fetch the data separately while keeping the fragment response small.

### 2.3 Error Response

When the Wallet cannot or will not fulfill the request, it MUST redirect to the `redirect_uri` with error parameters in the fragment, following OID4VP error response format:

**Parameters:**
*   `error`: REQUIRED. Error code string.
*   `error_description`: OPTIONAL. Human-readable error description.
*   `state`: REQUIRED. The `state` value from the original request.

**Error Codes** (subset of OID4VP):
| Code | Description |
|------|-------------|
| `access_denied` | User declined to share credentials, or Wallet lacks matching credentials. |
| `invalid_request` | Malformed request (missing parameters, invalid DCQL, etc.). |

**Example Error Response:**
```
https://clinic.example.com/return#
  error=access_denied&
  error_description=User%20declined%20to%20share&
  state=abc123
```

---

## 3. Browser-Based Implementation (The "Shim")

To enable this protocol in pure browser environments (without backend OID4VP handlers), this repository provides a reference implementation using a **W3C Digital Credentials API Shim**.

### 3.1 Installation

**Via npm/bun (from GitHub):**
```bash
# npm
npm install github:jmandel/smart-health-checkin-demo

# bun
bun add github:jmandel/smart-health-checkin-demo
```

**ES Module import:**
```javascript
import { request, maybeHandleReturn } from 'smart-health-checkin';
```

**Script tag (IIFE bundle):**
```html
<script src="https://cdn.jsdelivr.net/gh/jmandel/smart-health-checkin-demo@main/dist/smart-health-checkin.iife.min.js"></script>
<script>
  // Use window.SHL.request(), window.SHL.maybeHandleReturn()
</script>
```

### 3.2 The Shim API

The library exposes a `request()` function that orchestrates the OID4VP flow over standard browser navigation.

```javascript
// ES Module
import { request, maybeHandleReturn } from 'smart-health-checkin';

// Or via script tag
const { request, maybeHandleReturn } = window.SHL;

// Make a request
const result = await request(dcqlQuery, {
  checkinBase: 'https://picker.example.com'
});

// On page load, handle potential return from popup
await maybeHandleReturn();
```

### 3.3 Transport Mechanism

1.  **Request**: The shim opens the Health App URL (via a Picker) in a popup window with the OID4VP query parameters.
2.  **Response**: The Health App redirects the popup back to the original requesting page (`redirect_uri`) with the response in the URL fragment.
3.  **Handoff**: The returned popup (now at the requester URL) detects the response via `SHL.maybeHandleReturn()`, relays `vp_token` and `smart_artifacts` to the original tab over `BroadcastChannel`, and closes itself.
4.  **Completion**: The shim receives the data, closes the popup, rehydrates the response, and resolves the Promise.

## 4. Reference Implementation (Demo)

This repository contains a fully functional reference implementation of the protocol.

### 4.1 Components

*   **Requester (`demo/requester`)**: A demo "Doctor's Clinic" app that initiates the flow.
*   **Picker (`demo/checkin`)**: A simple UI that helps users select their health app.
*   **Health App (`demo/source-flexpa`)**: A mock health app implementation that acts as an OID4VP Provider.

### 4.2 Running the Demo

To simulate the cross-origin security model locally:

```bash
./start-local.sh
```

This starts 3 servers on different ports (Requester, Check-in, and the Flexpa health app).
Visit **http://requester.localhost:3000** to try the flow.

## 5. License

MIT License
