# SMART Health Check-in Pattern

A web-standard approach to "Kill the Clipboard" – enabling patients to share health records and insurance data with providers digitally, before they arrive at the clinic.

## 🌐 Live Demo

Visit [joshuamandel.com/smart-health-checkin-demo](https://joshuamandel.com/smart-health-checkin-demo) to try the interactive simulation of **Dr. Mandel's Family Medicine** clinic.

## 🎯 The Problem

The CMS Interoperability Framework aims to "Kill the Clipboard" by 2026, but current remote workflows force patients into complex manual processes:

- **File System**: Providers ask patients to "Upload your Health Card," assuming patients know how to export files from their health apps
- **Copy-Paste**: Patients must switch contexts repeatedly to generate and paste sharing links
- **"Self-Scan"**: Patients on mobile phones cannot scan QR codes displayed on their own screens

These barriers prevent widespread adoption of existing standards like SMART Health Cards (SHC) and SMART Health Links (SHL), which work beautifully for in-person interactions.

## 💡 The Proposal

The **SMART Health Check-in Pattern** is a pragmatic bridge inspired by the [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/). It mimics the request/response structure of `navigator.credentials.get()` but implements the flow using standard web redirects and messaging, ensuring reliability on all current devices.

### Key Principles

1. **Pass-Through Security**: The picker component routes requests but never sees response data
2. **W3C Alignment**: Uses the same data structures as the emerging Digital Credentials API
3. **Rich Interactions**: Enables form pre-filling, granular consent, and annotations
4. **Zero Infrastructure**: Works on static hosting (CDN, GitHub Pages) with no server-side state

## 🏗️ Architecture

The pattern involves three components:

```
┌──────────────┐         ┌─────────────────┐         ┌──────────────┐
│   Provider   │────1───>│  Check-in       │────3───>│  Patient's   │
│   Portal     │         │  Component      │         │  Health App  │
│ (Requester)  │<───5────┤  (Router)       │         │  (Source)    │
└──────────────┘         └─────────────────┘         └──────┬───────┘
                                                             │
                         Response bypasses ──────────────────┘
                         the picker entirely
```

### Workflow

1. **Request**: Provider constructs JSON defining needed data (insurance card, clinical history, questionnaires)
2. **Picker**: User selects their health data source from a directory
3. **Authorization**: Patient app renders consent UI with:
   - Pre-filled forms using patient's existing data
   - Granular selection (e.g., "share immunizations but not mental health notes")
   - Ability to add annotations
4. **Return**: Data flows directly from patient app to provider via `BroadcastChannel`

The picker **never sees response data** – it closes immediately after routing the request.

## ✨ Features

### For Patients
- **Familiar UX**: "Sign in with..." style flow users already trust
- **Reduced Burden**: Forms pre-filled with known data (name, DOB, medications, allergies)
- **Control**: Granular consent over what to share

### For Providers
- **Automated Processing**: Request IDs map responses to specific needs
- **Multiple Formats**: Supports SMART Health Cards, FHIR Bundles, and Questionnaire Responses
- **Traceability**: Transparent transaction logs for verification

### For Developers
- **Static Hosting**: No backend required – works on GitHub Pages, Netlify, etc.
- **Future-Proof**: Data structures align with W3C Digital Credentials API
- **Flexible**: Picker can be self-hosted or use a public instance

## 🚀 Quick Start

### GitHub Pages (Single-Origin)

The demo is live at: https://joshuamandel.com/smart-health-checkin-demo

All components run under the same origin at different subpaths:
- Landing page: `/`
- Requester (Dr. Mandel's Clinic): `/requester/`
- Check-in picker: `/checkin/`
- Data sources: `/source-flexpa/`, `/source-bwell/`, `/source-premera/`

### Local Testing (Multi-Origin)

For local development with true cross-origin testing:

```bash
# Start all servers on different localhost ports
./start-local.sh
```

This starts 5 servers:
- Requester: http://requester.localhost:3000
- Check-in: http://checkin.localhost:3001
- Flexpa: http://flexpa.localhost:3002
- b.well: http://bwell.localhost:3003
- Premera: http://premera.localhost:3004

Visit http://requester.localhost:3000 to start.

## 📋 Protocol Overview

### Request Format

Uses W3C Digital Credentials structure:

```javascript
const result = await SHL.request({
  digital: {
    requests: [{
      protocol: 'smart-health-data',
      data: {
        items: [
          {
            id: 'coverage-1',
            type: 'fhir-profile',
            resourceType: 'Coverage',
            profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage'
          },
          {
            id: 'intake-1',
            type: 'fhir-questionnaire',
            questionnaire: { /* FHIR Questionnaire */ }
          }
        ]
      }
    }]
  }
}, {
  checkinBase: 'https://checkin.example.org'
});
```

### Response Format

The patient app returns a response envelope in the URL hash:

```javascript
// Response envelope (source app → requester)
{
  v: 1,
  state: "matches-request-state",  // Must match the request state
  payload: {
    items: [
      {
        requestIds: ["coverage-1"],      // Maps back to request item IDs
        type: "fhir-resource",
        contentType: "application/smart-health-card",
        label: "Digital Insurance Card",
        body: { /* Verifiable Credential */ }
      },
      {
        requestIds: ["intake-1"],
        type: "fhir-questionnaire-response",
        contentType: "application/fhir+json",
        label: "Patient Intake Form",
        body: { /* QuestionnaireResponse */ }
      }
    ]
  }
}
```

### Protocol Flow Details

1. **Source app** returns the response by navigating to:
   ```
   {returnUrl}#res={base64url(responseEnvelope)}
   ```

2. **Return tab** detects `#res=` in hash, decodes it, and broadcasts via `BroadcastChannel('shl-{state}')`

3. **Original requester tab** receives the broadcast, validates state, and extracts the payload

4. **SHL.request() resolves** with:
   ```javascript
   {
     type: 'digital_credential',
     protocol: 'smart-health-data',
     data: JSON.stringify(payload)  // The payload stringified
   }
   ```

## 🔒 Security Model

### Hash-Based Transport
All sensitive data travels in URL hash fragments (`#req=...`, `#res=...`):
- **Never sent to servers** - Not in HTTP requests
- **Never logged** - Not visible in logs or proxies
- **Never leaked** - Not in Referer headers

### Pass-Through Architecture
- Request flow: Requester → Check-in → Patient App
- Response flow: Patient App → Requester (**bypassing check-in**)
- Check-in component closes immediately after routing

### State Validation
- Random 128-bit state parameter
- Must match between request and response
- Prevents replay attacks

### BroadcastChannel Security
- Messages only reach same-origin pages
- State parameter provides additional validation
- No server-side state required

## 🧪 Using the Library

```javascript
// Include the library
<script src="./shl.js"></script>

// Make a request
const result = await SHL.request({
  digital: {
    requests: [{
      protocol: 'smart-health-data',
      data: {
        items: [
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
  checkinBase: 'https://joshuamandel.com/smart-health-checkin-demo/checkin',
  clientName: 'Your Clinic Name'
});

// Handle the return
await SHL.maybeHandleReturn();
```

## 📦 Project Structure

```
smart-health-checkin-demo/
├── index.html              # Landing page / explainer
├── config.js              # Environment-aware configuration
├── shl.js                 # Core library
├── requester/             # Dr. Mandel's Family Medicine demo
│   ├── index.html
│   ├── config.js
│   └── shl.js
├── checkin/               # Check-in picker component
│   ├── index.html
│   └── config.js
├── source-flexpa/         # Flexpa data source demo
│   └── index.html
├── source-bwell/          # b.well data source demo
│   └── index.html
└── source-premera/        # Premera data source demo
    └── index.html
```

## 🎓 Learn More

- [W3C Digital Credentials API](https://wicg.github.io/digital-credentials/)
- [SMART Health Cards](https://smarthealth.cards/)
- [SMART Health Links](https://docs.smarthealthit.org/smart-health-links/)
- [FHIR](https://www.hl7.org/fhir/)
- [US Core Implementation Guide](http://hl7.org/fhir/us/core/)
- [CMS Interoperability Framework](https://www.cms.gov/priorities/key-initiatives/burden-reduction/interoperability)

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

This is a demonstration of a proposed pattern. Feedback and contributions welcome!

Open an issue or pull request at: https://github.com/jmandel/smart-health-checkin-demo

---

**SMART Health Check-in Pattern** – A pragmatic bridge to W3C Digital Credentials for healthcare
