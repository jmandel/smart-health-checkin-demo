# SHL Share Picker Demo

SHLink credential sharing protocol inspired by the [W3C Digital Credentials API](https://www.w3.org/TR/digital-credentials/#the-digitalcredentialgetrequest-dictionary), with a tiny little app picker to facilitate the flow (just until platform-level support is widely available on iOS + Android).

## 🌐 Live Demo

Visit [joshuamandel.com/shl-share-picker](https://joshuamandel.com/shl-share-picker) to try it out!

## 🔐 What is the SHL Share Picker?

The SHL Share Picker is a pattern for secure credential sharing where:
- A **requesting party** (requester) indicates what type of data they need from a patient app
- An **app picker** helps users select their data source (requester can self-host or pull in an external picker)
- The **app picker never sees the actual data** being shared
- A **patient app** (data source) receives the request and helps the patient prepare a response
- All sensitive information travels directly from source app to requester
- Compatible with Navigator Credentials API format

## ✨ Features

- **Secure Architecture**: App picker never sees the data being shared
- **Cross-Origin Support**: Works across different domains
- **Navigator Credentials Compatible**: Follows `navigator.credentials.get()` pattern
- **Static Hosting Only**: No server-side state required
- **Flexible Hosting**: Requester chooses the app picker - self-hosted or public
- **Health Data Standards**: Supports FHIR, SMART Health Cards and Links, US Core profiles

## 🚀 Quick Start

### GitHub Pages (Single-Origin)

The demo is live at: https://joshuamandel.com/shl-share-picker

All components run under the same origin at different subpaths:
- Requester: `/requester/`
- App Picker: `/gateway/`
- Data sources: `/source-flexpa/`, `/source-bwell/`, `/source-premera/`

### Local Testing (Multi-Origin)

For local development with true cross-origin testing:

```bash
# Start all servers
./start-local.sh
```

This starts 5 servers on different localhost ports:
- Requester: http://requester.localhost:3000
- App Picker: http://gateway.localhost:3001
- Flexpa: http://flexpa.localhost:3002
- b.well: http://bwell.localhost:3003
- Premera: http://premera.localhost:3004

Visit http://requester.localhost:3000 to start.

## 📋 Protocol Overview

The SHL Share Picker uses the same data model as the [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/), enabling future compatibility with native browser APIs.

### Protocol Actors

- **Requester**: Healthcare portal or app requesting health credentials
- **App Picker**: Intermediary that presents data source options to users
- **Data Source**: Patient app or health data provider (insurer, EHR, PHR) that authorizes and returns data

### Protocol Flow

1. **Requester** initiates request by opening app picker in popup with request envelope in hash:
   ```
   {appPickerBase}/#req={base64url(request_envelope)}
   ```

2. **App Picker** displays available data sources, user selects one

3. **Data Source** receives forwarded request, user reviews and authorizes

4. **Response** returns directly to requester (bypassing app picker):
   ```
   {returnUrl}/#res={base64url(response_envelope)}
   ```

5. **BroadcastChannel** delivers response to original requester tab (and the response tab self-closes)

### Request Envelope

Uses W3C Digital Credentials format with structured request items:

```json
{
  "v": 1,
  "state": "random-128-bit-string",
  "returnUrl": "https://requester.example.com/app",
  "digital": {
    "requests": [{
      "protocol": "smart-health-data",
      "data": {
        "items": [
          {
            "id": "coverage-1",
            "type": "fhir-profile",
            "resourceType": "Coverage",
            "profile": "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"
          },
          {
            "id": "patient-1",
            "type": "fhir-profile",
            "resourceType": "Patient",
            "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"
          }
        ]
      }
    }]
  }
}
```

### Response Envelope

```json
{
  "v": 1,
  "state": "same-as-request",
  "payload": {
    "v": 1,
    "items": [
      {
        "requestIds": ["coverage-1"],
        "type": "fhir-resource",
        "contentType": "application/smart-health-card",
        "label": "Insurance Card",
        "body": { /* SMART Health Card */ }
      },
      {
        "requestIds": ["patient-1"],
        "type": "fhir-resource",
        "contentType": "application/fhir+json",
        "label": "Health Summary",
        "body": { /* FHIR Bundle */ }
      },
      {
        "requestIds": ["coverage-1", "patient-1"],
        "type": "fhir-resource",
        "contentType": "application/smart-health-link",
        "label": "Shareable Health Records",
        "body": { /* SMART Health Link */ }
      }
    ]
  }
}
```

**Response items** include `requestIds` to indicate which request(s) they satisfy:
- One request → one response (typical)
- Multiple requests → one response (e.g., a Bundle satisfying multiple profiles)
- One request → multiple responses (e.g., different formats of same data)

**Response formats:**
- **FHIR Bundles** (`application/fhir+json`) - clinical records embedded directly
- **SMART Health Cards** (`application/smart-health-card`) - verifiable credentials
- **SMART Health Links** (`application/smart-health-link`) - shareable links for ongoing access
- Any other health data format

### Data Model (TypeScript)

```typescript
interface RequestEnvelope {
  v: 1;
  state: string;              // Random 128-bit identifier
  returnUrl: string;          // Where to send response
  digital: {
    requests: Array<{
      protocol: string;       // e.g., 'smart-health-data'
      data: {
        items: RequestItem[];
      };
    }>;
  };
}

type RequestItem = ProfileRequestItem | QuestionnaireRequestItem;

interface ProfileRequestItem {
  id: string;                 // Unique identifier for this request
  type: 'fhir-profile';
  profile: string;            // FHIR profile URL
  resourceType?: string;      // Optional: 'Patient', 'Coverage', etc.
}

interface QuestionnaireRequestItem {
  id: string;                 // Unique identifier for this request
  type: 'fhir-questionnaire';
  questionnaire?: object;     // Inline FHIR Questionnaire resource
  questionnaireUrl?: string;  // Or URL reference
  prePopulation?: object;     // Optional pre-filled QuestionnaireResponse
}

interface ResponseEnvelope {
  v: 1;
  state: string;             // Must match request
  payload: {
    v: 1;
    items: ResponseItem[];
  };
}

type ResponseItem = ResourceResponseItem | QuestionnaireResponseItem;

interface ResourceResponseItem {
  requestIds: string[];      // Which request item(s) this satisfies
  type: 'fhir-resource';
  contentType: string;       // MIME type
  label?: string;            // Display name
  body: object;              // Credential data
  profile?: string;          // Which profile this satisfies
}

interface QuestionnaireResponseItem {
  requestIds: string[];      // Which request item(s) this satisfies
  type: 'fhir-questionnaire-response';
  contentType: string;       // Typically 'application/fhir+json'
  label?: string;            // Display name
  body: object;              // FHIR QuestionnaireResponse
  questionnaire?: string;    // Reference back to questionnaire
}
```

## 🏗️ Protocol Diagram

```
┌──────────┐                                     ┌────────────┐
│Requester │                                     │ App Picker │
└────┬─────┘                                     └─────┬──────┘
     │                                                 │
     │  1. Open popup: #req={...}                      │
     ├────────────────────────────────────────────────>│
     │                                                 │
     │                           2. User selects       │
     │                              data source        │
     │                                                 │
     │                                     ┌───────────▼───────┐
     │                                     │   Data Source     │
     │                                     └───────────┬───────┘
     │                                                 │
     │                           3. Open: #req={...}   │
     │                           (app picker closed)   │
     │                                                 │
     │                         4. User authorizes      │
     │                                                 │
     │  5. Navigate: #res={...}                        │
     │<────────────────────────────────────────────────┤
     │                                                 │
     │  6. BroadcastChannel                            │
     │     (internal, same-origin)                     │
     └───────────────────┐                             │
                         │                             │
     ┌───────────────────┘                             │
     │                                                 │
     │  7. Response received!                          │
     ▼                                                 ▼
```

The app picker never sees the response - it closes after forwarding the request.

## 🔧 Configuration

The demo automatically detects its environment:

- **Multi-origin mode**: When running on `*.localhost` domains
- **Single-origin mode**: When running on GitHub Pages or other single-origin deployments

Configuration is handled in `config.js` which sets up the appropriate URLs for each mode.

## 📦 Project Structure

```
shl-share-picker/
├── index.html           # Landing page
├── config.js            # Environment-aware configuration
├── shl.js              # Core SHL Share Picker library
├── requester/          # Healthcare portal demo
│   └── index.html
├── gateway/            # App picker
│   └── gateway.html
├── source-flexpa/      # Flexpa data source
│   └── index.html
├── source-bwell/       # b.well data source
│   └── index.html
└── source-premera/     # Premera data source
    └── index.html
```

## 🧪 Using the API

Request credentials using W3C Digital Credentials format:

```javascript
const result = await SHL.request({
  digital: {
    requests: [{
      protocol: 'smart-health-card',
      data: {
        items: [
          {
            id: 'coverage-1',
            type: 'fhir-profile',
            resourceType: 'Coverage',
            profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage'
          },
          {
            id: 'patient-1',
            type: 'fhir-profile',
            resourceType: 'Patient',
            profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
          }
        ]
      }
    }]
  }
}, {
  appPickerBase: 'https://joshuamandel.com/shl-share-picker/gateway'  // or your own
});
```

**The requester controls which app picker to use:**
- Use a public app picker like `https://joshuamandel.com/shl-share-picker/gateway`
- Host your own app picker at your domain
- Package the app picker with your application

Since the app picker never sees response data, you can choose based on convenience and which party you want managing the list of available data sources.

**Future browser-native API** will use identical format:
```javascript
const result = await navigator.credentials.get({
  digital: { requests: [...] }
});
```

## 🛠️ Implementation Guide

### For Requesters (Healthcare Portals)

1. Include the SHL Share Picker library (`shl.js`)
2. Call `SHL.request()` with W3C Digital Credentials format
3. Choose an app picker URL (self-hosted or public)
4. Handle the return flow with `SHL.maybeHandleReturn()`

### For Data Sources (Patient Apps)

1. Parse the `#req=` hash parameter from the URL
2. Decode the request envelope (base64url-encoded JSON)
3. Display authorization UI showing what's requested and who's requesting
4. Build response with appropriate content types:
   - FHIR Bundles for clinical data
   - SMART Health Cards for verifiable credentials
   - SMART Health Links for shareable ongoing access
5. Navigate to `{returnUrl}/#res={base64url(response_envelope)}`

### For App Picker Operators

1. Parse the `#req=` hash parameter from the URL
2. Display list of available data sources
3. When user selects a source, forward the request envelope to it
4. Close immediately (never store or log the request)

## 📚 Example Scenarios

### Scenario 1: Insurance Card Request

**Requester asks for:**
```json
{
  "digital": {
    "requests": [{
      "protocol": "smart-health-data",
      "data": {
        "items": [{
          "id": "coverage-1",
          "type": "fhir-profile",
          "resourceType": "Coverage",
          "profile": "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"
        }]
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
      "requestIds": ["coverage-1"],
      "type": "fhir-resource",
      "contentType": "application/smart-health-card",
      "label": "Digital Insurance Card",
      "body": {
        "verifiableCredential": ["eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6..."]
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
      "protocol": "smart-health-data",
      "data": {
        "items": [{
          "id": "patient-1",
          "type": "fhir-profile",
          "resourceType": "Patient",
          "profile": "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"
        }]
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
      "requestIds": ["patient-1"],
      "type": "fhir-resource",
      "contentType": "application/fhir+json;fhirVersion=4.0.1",
      "label": "Health Summary",
      "body": {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
          { "resource": { "resourceType": "Patient", "id": "123", ... }},
          { "resource": { "resourceType": "Condition", "id": "456", ... }},
          { "resource": { "resourceType": "MedicationStatement", "id": "789", ... }}
        ]
      }
    }]
  }
}
```

### Scenario 3: Questionnaire Request

**Requester asks for:**
```json
{
  "digital": {
    "requests": [{
      "protocol": "smart-health-data",
      "data": {
        "items": [{
          "id": "intake-1",
          "type": "fhir-questionnaire",
          "questionnaireUrl": "http://example.org/Questionnaire/patient-intake"
        }]
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
      "requestIds": ["intake-1"],
      "type": "fhir-questionnaire-response",
      "contentType": "application/fhir+json",
      "label": "Patient Intake Form",
      "questionnaire": "http://example.org/Questionnaire/patient-intake",
      "body": {
        "resourceType": "QuestionnaireResponse",
        "status": "completed",
        "authored": "2025-01-12T10:30:00Z",
        "item": [
          { "linkId": "1", "text": "Name", "answer": [{ "valueString": "John Doe" }] }
        ]
      }
    }]
  }
}
```

## 🔒 Security Model

### Hash-Based Transport
All sensitive data travels in URL hash fragments (`#req=...`, `#res=...`):
- **Never sent to servers** - not in HTTP requests
- **Never logged** - not visible in server logs or proxies
- **Never leaked** - not in referrer headers

### Privacy Architecture
The requester chooses which app picker to use (self-hosted or public). The app picker:
- ✅ Sees what's being requested (non-sensitive metadata)
- ❌ **Never sees response data**
- ❌ **Cannot intercept** the response flow

Response flows directly: **Data Source → Requester** (bypassing app picker entirely).

This means you can:
- **Self-host** the app picker alongside your application
- **Use a public app picker** that maintains data source listings
- **Switch between different app pickers** as needed

### State Validation
Random `state` parameter:
- Links request and response
- Must match on both sides
- Prevents CSRF attacks
- Ensures message integrity

### BroadcastChannel Security
- Messages only reach **same-origin pages**
- State parameter provides additional validation
- Works across multiple tabs securely
- No server-side state required

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please open an issue or pull request.

## 📚 Learn More

- [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/)
- [Navigator Credentials API](https://developer.mozilla.org/en-US/docs/Web/API/Credential_Management_API)
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [SMART Health Cards](https://smarthealth.cards/)
- [FHIR](https://www.hl7.org/fhir/)
- [US Core Implementation Guide](http://hl7.org/fhir/us/core/)
