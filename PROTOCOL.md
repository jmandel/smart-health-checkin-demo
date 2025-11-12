# SHL Share Picker Protocol

## Overview

The SHL Share Picker protocol enables secure credential sharing where an **app picker** helps users select their data source, but **never sees the actual data** being shared. All sensitive information travels directly from source to requester.

The protocol uses the same data model as the [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/) (`navigator.credentials.get()`), specifically the `digital` credential type with a `requests` array.

## Protocol Actors

- **Requester**: Healthcare portal or app requesting health credentials
- **App Picker**: Trusted intermediary that presents data source options (zero-knowledge)
- **Data Source**: Health data provider (insurer, EHR, PHR) that authorizes and returns data

## Protocol Flow

### Step 1: Request Initiation

Requester opens app picker in a popup with request in hash fragment:

```
{appPickerBase}/#req={base64url(request_envelope)}
```

**Request Envelope** (W3C Digital Credentials format):
```json
{
  "v": 1,
  "state": "random-128-bit-string",
  "returnUrl": "https://requester.example.com/app",
  "digital": {
    "requests": [{
      "protocol": "smart-health-card",
      "data": {
        "Coverage": {
          "_profile": "http://hl7.org/fhir/us/insurance-card/..."
        }
      }
    }]
  }
}
```

### Step 2: App Selection

App picker displays available data sources. When user selects one, app picker forwards the request envelope to the data source:

```
{sourceBase}/#req={base64url(request_envelope)}
```

App picker then closes. It never stores or logs the request.

### Step 3: Data Source Authorization

Data source displays what's being requested and who's requesting it. User authorizes and data source navigates to:

```
{returnUrl}/#res={base64url(response_envelope)}
```

**Response Envelope**:
```json
{
  "v": 1,
  "state": "same-as-request",
  "payload": {
    "v": 1,
    "items": [
      {
        "contentType": "application/fhir+json;fhirVersion=4.0.1",
        "label": "Health Summary",
        "body": { /* FHIR Bundle */ }
      },
      {
        "contentType": "application/smart-health-card",
        "label": "Insurance Card",
        "body": { /* SMART Health Card */ }
      }
    ]
  }
}
```

### Step 4: Return to Requester

When data source navigates to `{returnUrl}/#res=...`, the requester:

1. Detects `#res=` in URL hash
2. Extracts the state
3. Broadcasts response on `BroadcastChannel('shl-{state}')`
4. Closes the return tab

### Step 5: Response Processing

Original requester tab receives the broadcast, validates state matches, and returns the credential data.

## Data Model

The protocol uses W3C Digital Credentials API data structures:

### Request Structure

```typescript
interface RequestEnvelope {
  v: 1;
  state: string;              // Random 128-bit identifier
  returnUrl: string;          // Where to send response
  digital: {
    requests: Array<{
      protocol: string;       // e.g., 'smart-health-card'
      data?: any;            // Protocol-specific requirements
    }>;
  };
}
```

The `digital.requests` array follows W3C standards, enabling future compatibility with `navigator.credentials.get()`.

### Response Structure

```typescript
interface ResponseEnvelope {
  v: 1;
  state: string;             // Must match request
  payload: {
    v: 1;
    items: Array<{
      contentType: string;   // MIME type
      label?: string;        // Display name
      body: any;            // Credential data
    }>;
  };
}
```

**Response items** can include:
- **FHIR Bundles**: `application/fhir+json` with health records
- **SMART Health Cards**: `application/smart-health-card` with verifiable credentials  
- **SMART Health Links**: `application/smart-health-link` with shareable links
- Any other health data format

## Security Model

### Hash-Based Transport

All sensitive data is in URL hash fragments (`#req=...`, `#res=...`):
- Never sent to servers (not in HTTP requests)
- Not logged by servers or proxies
- Not visible in referrer headers

### Zero-Trust App Picker

The app picker:
- Sees what's being requested (non-sensitive)
- Never sees response data (zero-knowledge)
- Cannot intercept the response flow

Response goes directly: **Data Source → Requester** (bypassing app picker).

### State Validation

The random `state` parameter:
- Links request and response
- Must match on both sides
- Prevents CSRF attacks

### BroadcastChannel

Used for same-origin communication between tabs:
- Messages only reach same-origin pages
- State parameter adds validation layer
- Works across multiple browser tabs

## Implementation Notes

### For Patient Portal Developers (Requesters)

1. Include SHL Share Picker library
2. Call `SHL.request()` with W3C Digital Credentials format
3. Specify trusted app picker URL
4. Handle return flow with `SHL.maybeHandleReturn()`

### For Health Data Providers (Data Sources)

1. Parse `#req=` hash parameter
2. Decode request envelope (base64url JSON)
3. Display authorization UI
4. Build response with appropriate content types:
   - FHIR Bundles for clinical data
   - SMART Health Cards for verifiable credentials
   - SMART Health Links for shareable access
5. Navigate to `{returnUrl}/#res={response}`

### For App Picker Operators

1. Parse `#req=` hash parameter
2. Display available data sources
3. Forward request envelope to selected source
4. Close immediately (never store data)

## W3C Compatibility

The SHL Share Picker uses the same data model as W3C Digital Credentials API:

**Current (SHL Share Picker):**
```javascript
await SHL.request({
  digital: { requests: [...] }
}, { appPickerBase: '...' })
```

**Future (Native):**
```javascript
await navigator.credentials.get({
  digital: { requests: [...] }
})
```

The `digital.requests` structure is identical, enabling smooth migration to native browser APIs when available.

## Example Scenarios

### Scenario 1: Insurance Card Request

**Requester asks for:**
```json
{
  "digital": {
    "requests": [{
      "protocol": "smart-health-card",
      "data": {
        "Coverage": {
          "_profile": "http://hl7.org/fhir/us/insurance-card/..."
        }
      }
    }]
  }
}
```

**Data source returns:**
```json
{
  "payload": {
    "items": [{
      "contentType": "application/smart-health-card",
      "label": "Digital Insurance Card",
      "body": {
        "verifiableCredential": ["eyJ0eXAi..."]
      }
    }]
  }
}
```

### Scenario 2: Clinical Records Request

**Requester asks for:**
```json
{
  "digital": {
    "requests": [{
      "protocol": "smart-health-card",
      "data": {
        "USCorePatientBundle": {
          "_profile": "http://hl7.org/fhir/us/core/..."
        }
      }
    }]
  }
}
```

**Data source returns:**
```json
{
  "payload": {
    "items": [{
      "contentType": "application/fhir+json;fhirVersion=4.0.1",
      "label": "Health Summary",
      "body": {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
          { "resource": { "resourceType": "Patient", ... }},
          { "resource": { "resourceType": "Condition", ... }},
          { "resource": { "resourceType": "MedicationStatement", ... }}
        ]
      }
    }]
  }
}
```

## Protocol Diagram

```
┌──────────┐                                     ┌────────────┐
│Requester │                                     │ App Picker │
└────┬─────┘                                     └─────┬──────┘
     │                                                 │
     │  1. Open popup: #req={...}                     │
     ├────────────────────────────────────────────────>│
     │                                                 │
     │                           2. User selects      │
     │                              data source       │
     │                                                 │
     │                                     ┌───────────▼───────┐
     │                                     │   Data Source     │
     │                                     └───────────┬───────┘
     │                                                 │
     │                           3. Open: #req={...}  │
     │                           (app picker closed)  │
     │                                                 │
     │                         4. User authorizes     │
     │                                                 │
     │  5. Navigate: #res={...}                       │
     │<────────────────────────────────────────────────┤
     │                                                 │
     │  6. BroadcastChannel                           │
     │     (internal, same-origin)                    │
     └───────────────────┐                            │
                         │                            │
     ┌───────────────────┘
     │
     │  7. Response received!
     ▼
```

App picker never sees the response - true zero-trust architecture.

## References

- [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/)
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [SMART Health Cards](https://smarthealth.cards/)
- [FHIR](https://www.hl7.org/fhir/)
- [US Core Implementation Guide](http://hl7.org/fhir/us/core/)

## License

MIT License - see LICENSE file for details.
