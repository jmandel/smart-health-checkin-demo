# Zero-Trust Web Rails (ZTWR) Protocol Specification

## Overview

Zero-Trust Web Rails (ZTWR) is a security pattern for credential sharing that enables users to securely share health data between a **requester** (e.g., a healthcare portal) and a **data source** (e.g., a health insurance company or EHR system) through a trusted **gateway** that never sees the actual data being shared.

The protocol is built on the same data models used by the [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/) (`navigator.credentials.get()`), enabling future compatibility with native browser credential management while working today with standard web technologies.

## Key Principles

1. **Zero-Trust Architecture**: The gateway helps users select their data source but never sees the response data
2. **Zero-Knowledge Mediation**: Sensitive information travels directly from source to requester
3. **Hash-Based Transport**: All sensitive data is transmitted in URL hash fragments (never in query parameters or server logs)
4. **Cross-Origin Compatible**: Works across different domains using BroadcastChannel API
5. **Static Hosting Only**: No server-side state or backend required

## Protocol Actors

### 1. Requester (Healthcare Portal)
- **Role**: Initiates credential requests for health data
- **Examples**: Patient portal, health app, research platform
- **Implementation**: Embeds the ZTWR client library (`shl.js`)

### 2. Gateway (App Selector)
- **Role**: Presents users with available data sources to choose from
- **Security**: Never sees or logs the response data (zero-trust)
- **Implementation**: Static HTML page that parses requests and launches data sources

### 3. Data Source (Health Data Provider)
- **Role**: Authorizes and provides health credentials to the requester
- **Examples**: Health insurance company, EHR provider, PHR system
- **Implementation**: Static HTML page that validates requests and returns data

## Protocol Flow

### Complete Request-Response Cycle

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. INITIATE REQUEST                                                  │
│                                                                       │
│    Requester Page                                                    │
│    ┌─────────────────────────────────────┐                          │
│    │ SHL.request({                        │                          │
│    │   digital: {                         │                          │
│    │     requests: [{                     │                          │
│    │       protocol: 'smart-health-card', │                          │
│    │       data: { ... }                  │                          │
│    │     }]                               │                          │
│    │   }                                  │                          │
│    │ }, { gatewayBase })                  │                          │
│    └─────────────────────────────────────┘                          │
│                      │                                                │
│                      │ Generate state, open popup                    │
│                      ▼                                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 2. GATEWAY SELECTION                                                 │
│                                                                       │
│    Gateway Popup (gateway.localhost:3001/#req=...)                  │
│    ┌─────────────────────────────────────┐                          │
│    │  Choose Your Health Data Source:    │                          │
│    │                                      │                          │
│    │  [ Flexpa        ]                  │                          │
│    │  [ b.well        ]  ◄── User clicks │                          │
│    │  [ Premera       ]                  │                          │
│    └─────────────────────────────────────┘                          │
│                      │                                                │
│                      │ User selects source                           │
│                      ▼                                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 3. DATA SOURCE AUTHORIZATION                                         │
│                                                                       │
│    Data Source Popup (flexpa.localhost:3002/#req=...)               │
│    ┌─────────────────────────────────────┐                          │
│    │  Flexpa - Share Request             │                          │
│    │                                      │                          │
│    │  Protocol: smart-health-card        │                          │
│    │  Requesting site: requester.local   │                          │
│    │                                      │                          │
│    │  ☑ Insurance Coverage               │                          │
│    │  ☑ Clinical Records                 │                          │
│    │                                      │                          │
│    │  [Cancel]  [Share Selected Data]    │                          │
│    └─────────────────────────────────────┘                          │
│                      │                                                │
│                      │ User authorizes                               │
│                      ▼                                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 4. DIRECT RETURN TO REQUESTER                                        │
│                                                                       │
│    Navigate to: requester.localhost:3000/#shl=eyJ2...               │
│    ┌─────────────────────────────────────┐                          │
│    │ SHL.maybeHandleReturn()             │                          │
│    │   - Detects #shl= in URL            │                          │
│    │   - Broadcasts to original tab      │                          │
│    │   - Shows success message           │                          │
│    │   - Closes self                     │                          │
│    └─────────────────────────────────────┘                          │
│                      │                                                │
│                      │ BroadcastChannel('shl-{state}')               │
│                      ▼                                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 5. CREDENTIAL RECEIVED                                               │
│                                                                       │
│    Original Requester Tab                                           │
│    ┌─────────────────────────────────────┐                          │
│    │ BroadcastChannel.onmessage          │                          │
│    │   - Validates state matches         │                          │
│    │   - Parses credential data          │                          │
│    │   - Returns to application          │                          │
│    │                                      │                          │
│    │ Result: {                            │                          │
│    │   type: 'digital_credential',       │                          │
│    │   protocol: 'smart-health-card',    │                          │
│    │   data: '...'                       │                          │
│    │ }                                    │                          │
│    └─────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Detailed Protocol Steps

### Step 1: Request Initiation

The requester calls the ZTWR library with a credential request:

```javascript
const result = await SHL.request({
  digital: {
    requests: [{
      protocol: 'smart-health-card',
      data: {
        Coverage: {
          _profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage'
        },
        USCorePatientBundle: {
          _profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
        }
      }
    }]
  }
}, {
  gatewayBase: 'https://gateway.example.com'
});
```

**What happens internally:**

1. Generate a random 128-bit state value for this request
2. Capture the current page URL as `returnUrl`
3. Create a BroadcastChannel named `shl-{state}` to receive the response
4. Encode the request envelope:
   ```json
   {
     "v": 1,
     "state": "abc123...",
     "returnUrl": "https://requester.example.com/app",
     "digital": {
       "requests": [{
         "protocol": "smart-health-card",
         "data": { ... }
       }]
     }
   }
   ```
5. Base64url-encode the envelope
6. Open gateway in popup: `{gatewayBase}/#req={encoded_envelope}`

### Step 2: Gateway Selection

The gateway popup loads and:

1. Parses the `#req=` hash parameter
2. Base64url-decodes and validates the request envelope
3. Displays available data sources from its configuration
4. Shows request details (protocol, return URL, requested profiles)

**When user selects a source:**

1. Creates a handoff envelope with the same structure:
   ```json
   {
     "v": 1,
     "state": "abc123...",
     "returnUrl": "https://requester.example.com/app",
     "digital": { "requests": [...] }
   }
   ```
2. Base64url-encodes it
3. Opens data source: `{sourceBase}/#req={encoded_envelope}`
4. Gateway closes itself (or shows "You can close this tab")

**Key Security Property**: The gateway **never stores or logs** the state or request details. Everything is passed through the hash fragment.

### Step 3: Data Source Authorization

The data source popup loads and:

1. Parses the `#req=` hash parameter
2. Base64url-decodes and validates the request envelope
3. Extracts:
   - `state`: Request identifier
   - `returnUrl`: Where to send the response
   - `digital.requests`: What data is being requested
4. Displays authorization UI showing:
   - What is being requested
   - Who is requesting it (returnUrl)
   - What data will be shared

**When user authorizes:**

1. Gathers the requested data (or mocked data in demo)
2. Creates response envelope:
   ```json
   {
     "v": 1,
     "state": "abc123...",
     "payload": {
       "v": 1,
       "items": [
         {
           "contentType": "application/fhir+json;fhirVersion=4.0.1",
           "label": "Health Summary",
           "body": { "resourceType": "Bundle", "entry": [...] }
         }
       ]
     }
   }
   ```
3. Base64url-encodes the envelope
4. Navigates to: `{returnUrl}#shl={encoded_envelope}`

### Step 4: Return Handler

When the data source navigates to the returnUrl with `#shl=`, the requester page:

1. Calls `SHL.maybeHandleReturn()` on page load
2. Detects the `#shl=` hash parameter
3. Base64url-decodes the envelope
4. Extracts the state
5. Broadcasts on `BroadcastChannel('shl-{state}')`:
   ```javascript
   bc.postMessage({ state: "abc123...", shl: "{encoded_envelope}" })
   ```
6. Shows success message: "✓ Success - Data shared successfully"
7. Attempts to close the tab

**Why this works**: The original requester tab has been listening on the BroadcastChannel and receives the message.

### Step 5: Response Processing

The original requester tab:

1. Receives message on BroadcastChannel
2. Validates the state matches the original request
3. Decodes the payload
4. Resolves the promise returned by `SHL.request()`
5. Returns in Navigator Credentials API format:
   ```javascript
   {
     type: 'digital_credential',
     protocol: 'smart-health-card',
     data: '{"v":1,"items":[...]}'
   }
   ```

## Data Model Structure

### Request Envelope

The request follows the W3C Digital Credentials API structure:

```typescript
interface RequestEnvelope {
  v: 1;                          // Version
  state: string;                 // Random 128-bit hex string
  returnUrl: string;             // URL to return to
  digital: {                     // W3C Digital Credentials structure
    requests: CredentialRequest[];
  };
  recip_pub?: JsonWebKey;        // Optional E2E encryption public key
}

interface CredentialRequest {
  protocol: string;              // e.g., 'smart-health-card'
  data?: Record<string, any>;    // Protocol-specific data requirements
}
```

**Example Request Envelope:**
```json
{
  "v": 1,
  "state": "a1b2c3d4e5f6...",
  "returnUrl": "https://portal.example.com/app",
  "digital": {
    "requests": [{
      "protocol": "smart-health-card",
      "data": {
        "Coverage": {
          "_profile": "http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"
        }
      }
    }]
  }
}
```

### Response Envelope

```typescript
interface ResponseEnvelope {
  v: 1;                          // Version
  state: string;                 // Must match request state
  payload?: Payload;             // Cleartext payload (if no E2E)
  jwe?: JWE;                     // Encrypted payload (if E2E enabled)
}

interface Payload {
  v: 1;
  items: CredentialItem[];
}

interface CredentialItem {
  contentType: string;           // MIME type
  label?: string;                // Human-readable label
  body: any;                     // Credential data
}
```

**Example Response Envelope:**
```json
{
  "v": 1,
  "state": "a1b2c3d4e5f6...",
  "payload": {
    "v": 1,
    "items": [
      {
        "contentType": "application/fhir+json;fhirVersion=4.0.1",
        "label": "Health Summary",
        "body": {
          "resourceType": "Bundle",
          "type": "collection",
          "entry": [...]
        }
      }
    ]
  }
}
```

## Developer Guide

### For Patient Portal Developers (Requesters)

To integrate ZTWR into your healthcare portal:

#### 1. Include the Library

```html
<script src="https://cdn.example.com/shl.js"></script>
```

Or self-host `shl.js` in your application.

#### 2. Make a Request

```javascript
try {
  const result = await SHL.request({
    digital: {
      requests: [{
        protocol: 'smart-health-card',
        data: {
          Coverage: {
            _profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage'
          }
        }
      }]
    }
  }, {
    gatewayBase: 'https://gateway.example.com'
  });

  // Process the result
  const payload = JSON.parse(result.data);
  payload.items.forEach(item => {
    console.log('Received:', item.label, item.contentType);
    console.log('Data:', item.body);
  });
} catch (error) {
  console.error('Credential request failed:', error);
}
```

#### 3. Handle Return Flow

On every page load, call the return handler:

```javascript
(async () => {
  const isReturn = await SHL.maybeHandleReturn();
  if (isReturn) {
    // This tab handled a return and will close
    return;
  }
  
  // Normal page initialization
  initApp();
})();
```

#### 4. Configure Your Gateway

Point to a trusted gateway URL:
- For testing: Use your own gateway instance
- For production: Use a well-known, trusted gateway service

### For Health Data Source Developers

To enable your system as a ZTWR data source:

#### 1. Create an Authorization Page

Create a static HTML page that:
1. Parses the request from `#req=` hash parameter
2. Shows users what data is being requested
3. Allows users to authorize or deny
4. Returns data to the `returnUrl` with `#shl=` hash parameter

#### 2. Parse the Request

```javascript
const td = new TextDecoder();

// Base64url decode utility
const ub64 = (s) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
};

const decJ = (s) => JSON.parse(td.decode(ub64(s)));

// Parse request
const params = new URLSearchParams(location.hash.slice(1));
const reqB64 = params.get('req');
const req = decJ(reqB64);

console.log('State:', req.state);
console.log('Return URL:', req.returnUrl);
console.log('Protocol:', req.digital.requests[0].protocol);
console.log('Requested data:', req.digital.requests[0].data);
```

#### 3. Build and Return Response

```javascript
const te = new TextEncoder();

// Base64url encode utility
const b64u = (buf) => {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Create response payload
const payload = {
  v: 1,
  items: [
    {
      contentType: 'application/fhir+json;fhirVersion=4.0.1',
      label: 'Health Record',
      body: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          // Your FHIR resources here
        ]
      }
    }
  ]
};

// Create response envelope
const response = {
  v: 1,
  state: req.state,  // MUST match request state
  payload: payload
};

// Encode and return
const shlB64 = b64u(te.encode(JSON.stringify(response)));
const returnURL = new URL(req.returnUrl);
returnURL.hash = 'shl=' + shlB64;

// Navigate back to requester
location.href = returnURL.toString();
```

#### 4. Register with Gateways

To appear in gateway selection screens:
1. Contact gateway operators
2. Provide your source metadata:
   - Name and description
   - Launch URL (your authorization page)
   - Brand colors and logo
   - Supported protocols

### For Gateway Operators

To operate a ZTWR gateway:

#### 1. Create Gateway Page

Create a static HTML page that:
1. Parses the request from `#req=`
2. Displays available data sources
3. Forwards the request to the selected source

#### 2. Configure Data Sources

```javascript
const config = {
  apps: [
    {
      id: 'flexpa',
      name: 'Flexpa',
      description: 'Connected health data platform',
      color: '#0d9488',
      logo: 'F',
      launchBase: 'https://flexpa.example.com'
    },
    // ... more sources
  ]
};
```

#### 3. Handle Source Selection

```javascript
// When user clicks a source
function launchSource(app) {
  const handoff = 'req=' + encodeURIComponent(reqB64);
  const launchUrl = app.launchBase + '#' + handoff;
  
  const w = window.open(launchUrl, '_blank');
  if (w) {
    window.close(); // Close gateway after launching
  } else {
    location.href = launchUrl; // Fallback if popup blocked
  }
}
```

## Security Considerations

### Hash-Based Transport

All sensitive data is transported in URL hash fragments, which:
- Are **never sent to servers** (not in HTTP requests)
- Are **not logged** by web servers or proxies
- Are **not visible** in browser history (in most browsers)
- Can be **read by JavaScript** on the page

### State Validation

The random `state` parameter:
- Links request and response
- Prevents CSRF attacks
- Must be validated on both requester and source sides
- Should be cryptographically random (128+ bits)

### BroadcastChannel Security

BroadcastChannel is same-origin only:
- Messages only reach pages from the same origin
- Prevents cross-origin credential leakage
- State parameter adds additional validation layer

### Optional End-to-End Encryption

For additional security, the protocol supports E2E encryption:

1. Requester generates ECDH keypair
2. Includes public key in request (`recip_pub`)
3. Source encrypts payload as JWE
4. Returns `jwe` instead of `payload` in response
5. Requester decrypts with private key

This protects against:
- Malicious return handler page
- Browser extensions reading hash
- Advanced browser history attacks

### Gateway Trust Model

The gateway is **untrusted**:
- It never sees response data (zero-knowledge)
- It can see what is being requested (not sensitive)
- It knows which sources are available
- Users should choose reputable gateways

### Popup Blocking

Modern browsers may block popups:
- Always call `SHL.request()` in response to user action
- Check for popup blocking and show user message
- Some implementations may need user to manually allow popups

## W3C Digital Credentials API Compatibility

The ZTWR protocol uses the same data model as the [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/), specifically the `digital` credentials type within `navigator.credentials.get()`.

### Current Implementation

ZTWR implements a polyfill-style approach that works today:

```javascript
// ZTWR current API
const result = await SHL.request({
  digital: {
    requests: [{ protocol: '...', data: {...} }]
  }
}, { gatewayBase: '...' });
```

### Future Native API

When browsers implement Digital Credentials API natively:

```javascript
// Future native API (proposed)
const result = await navigator.credentials.get({
  digital: {
    requests: [{ protocol: '...', data: {...} }]
  }
});
```

### Benefits of Compatibility

1. **Future-proof**: Code can transition to native API when available
2. **Consistent model**: Same request structure across implementations
3. **Progressive enhancement**: Start with ZTWR, upgrade to native when available
4. **Ecosystem alignment**: Follows W3C standards process

### Data Model Alignment

Both use identical request structure:

```typescript
interface DigitalCredentialsRequest {
  digital: {
    requests: Array<{
      protocol: string;
      data?: any;
    }>;
  };
}
```

The ZTWR response format is compatible with Digital Credentials API return values, following the `CredentialRequestOptions` pattern.

## Protocol Extensions

### Custom Protocols

Beyond `smart-health-card`, you can define custom protocols:

```javascript
await SHL.request({
  digital: {
    requests: [{
      protocol: 'my-custom-protocol',
      data: {
        // Protocol-specific requirements
      }
    }]
  }
}, { gatewayBase });
```

Data sources must recognize and handle your custom protocol.

### Multiple Requests

Request multiple credential types:

```javascript
await SHL.request({
  digital: {
    requests: [
      { protocol: 'smart-health-card', data: {...} },
      { protocol: 'verifiable-credential', data: {...} }
    ]
  }
}, { gatewayBase });
```

Sources should fulfill all requests or return an error.

### Protocol Negotiation

Sources can indicate unsupported protocols:

```javascript
// In response
{
  "v": 1,
  "state": "...",
  "error": "unsupported_protocol",
  "error_description": "Protocol 'xyz' is not supported"
}
```

## Testing and Development

### Local Testing Setup

1. Clone the demo repository
2. Run `./start-local.sh` to start multi-origin servers
3. Visit `http://requester.localhost:3000`
4. Test the full flow across different localhost subdomains

### Single-Origin Testing

For static hosting (GitHub Pages, Netlify, etc.):

1. Deploy to a web host
2. All components work under same origin
3. Uses BroadcastChannel for same-origin communication
4. No CORS issues

### Debugging

Enable console logging:

```javascript
// The library logs all operations with [SHL] prefix
// Check browser console for detailed flow information
```

Monitor hash fragments:

```javascript
// Watch hash changes
window.addEventListener('hashchange', () => {
  console.log('Hash changed:', location.hash);
});
```

## Comparison with Other Protocols

### vs OAuth 2.0

| Feature | ZTWR | OAuth 2.0 |
|---------|------|-----------|
| Server required | No | Yes |
| State management | Client-side only | Server-side |
| Redirect pattern | Hash-based | Query-param based |
| Gateway trust | Zero-trust | Trusted authorization server |
| Credential type | Digital credentials | Access tokens |

### vs SMART Health Links

| Feature | ZTWR | SMART Health Links |
|---------|------|-------------------|
| Use case | Interactive selection | Pre-shared links |
| User action | Required at request time | Optional at access time |
| Gateway | Required | Not used |
| Link format | Ephemeral (one-time) | Persistent |

### vs Direct API Integration

| Feature | ZTWR | Direct API |
|---------|------|------------|
| Integration | Static HTML only | Server-side code |
| User experience | UI-driven selection | Pre-configured |
| Security model | Zero-trust gateway | Direct trust |
| Development cost | Low | High |

## Frequently Asked Questions

### Q: Why use hash fragments instead of query parameters?

**A:** Hash fragments are never sent to servers, so sensitive data doesn't appear in server logs, proxy logs, or referrer headers.

### Q: Can the gateway steal user data?

**A:** No. The response flows directly from source to requester. The gateway never receives or sees the response.

### Q: What if popups are blocked?

**A:** The library will throw an error. Users need to allow popups for this flow, or the implementation can fall back to redirect-based flow.

### Q: Does this work on mobile?

**A:** Yes, but popups may behave as tabs on mobile browsers. The protocol works the same way.

### Q: Can I use this without BroadcastChannel?

**A:** BroadcastChannel is required for the current implementation. Future versions might support alternatives like Service Workers.

### Q: How do I handle errors?

**A:** The `SHL.request()` promise rejects with an error. Catch and handle appropriately:

```javascript
try {
  const result = await SHL.request(...);
} catch (error) {
  if (error.message === 'Popup blocked') {
    alert('Please allow popups for this site');
  } else {
    console.error('Credential request failed:', error);
  }
}
```

### Q: Is this production-ready?

**A:** The protocol is functional and secure. For production use:
- Host your own gateway or use a trusted one
- Implement proper error handling
- Consider adding E2E encryption
- Test across browsers and devices
- Add user education about popups

## References

- [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/)
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [SMART Health Cards](https://smarthealth.cards/)
- [FHIR](https://www.hl7.org/fhir/)
- [US Core Implementation Guide](http://hl7.org/fhir/us/core/)
- [RFC 6749: OAuth 2.0](https://tools.ietf.org/html/rfc6749)

## Version History

- **v1.0** (Current): Initial protocol specification
  - Basic request/response flow
  - Hash-based transport
  - Navigator Credentials API compatibility
  - Optional E2E encryption support

## License

This protocol specification is released under the MIT License.

## Contributing

Feedback and contributions welcome! Please open an issue or pull request on the [GitHub repository](https://github.com/jmandel/shl-share-picker).
