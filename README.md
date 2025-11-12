# Zero-Trust Web Rails (ZTWR) Demo

A demonstration of secure credential sharing using the Zero-Trust Web Rails pattern, compatible with the Navigator Credentials API.

## 🌐 Live Demo

Visit [joshuamandel.com/shl-share-picker](https://joshuamandel.com/shl-share-picker) to try it out!

## 🔐 What is Zero-Trust Web Rails?

Zero-Trust Web Rails (ZTWR) is a security pattern for credential sharing where:
- A **gateway** helps users select their data source
- The **gateway never sees the actual data** being shared
- All sensitive information travels directly from source to requester
- Works across different origins using BroadcastChannel API
- Compatible with Navigator Credentials API format

## ✨ Features

- **Zero-Trust Architecture**: Gateway provides zero-knowledge mediation
- **Cross-Origin Support**: Works across different domains
- **Navigator Credentials Compatible**: Follows `navigator.credentials.get()` pattern
- **Static Hosting Only**: No server-side state required
- **Hash-Only Transport**: Sensitive data never in query params
- **Health Data Standards**: Supports FHIR, SMART Health Cards, US Core profiles

## 🚀 Quick Start

### GitHub Pages (Single-Origin)

The demo is live at: https://joshuamandel.com/shl-share-picker

All components run under the same origin at different subpaths:
- Requester: `/requester/`
- Gateway: `/gateway/`
- Data sources: `/source-flexpa/`, `/source-bwell/`, `/source-premera/`

### Local Testing (Multi-Origin)

For local development with true cross-origin testing:

```bash
# Start all servers
./start-local.sh
```

This starts 5 servers on different localhost ports:
- Requester: http://requester.localhost:3000
- Gateway: http://gateway.localhost:3001
- Flexpa: http://flexpa.localhost:3002
- b.well: http://bwell.localhost:3003
- Premera: http://premera.localhost:3004

Visit http://requester.localhost:3000 to start.

## 📋 How It Works

1. **Requester** initiates a credential request using Navigator Credentials API format
2. **Gateway** opens showing available health data sources
3. **User** selects their preferred source (Flexpa, b.well, or Premera)
4. **Source** opens, user reviews the request and authorizes
5. **Data** returns directly to requester via BroadcastChannel
6. **Gateway** never sees the response - zero-trust achieved!

**📖 For detailed protocol documentation, see [PROTOCOL.md](PROTOCOL.md)**

## 🏗️ Architecture

```
┌─────────────┐
│  Requester  │ Initiates request with Navigator Credentials format
└──────┬──────┘
       │
       v
┌─────────────┐
│   Gateway   │ User selects data source (never sees response)
└──────┬──────┘
       │
       v
┌─────────────┐
│Data Source  │ User authorizes, returns data directly to requester
└──────┬──────┘
       │
       v (BroadcastChannel)
┌─────────────┐
│  Requester  │ Receives credential data
└─────────────┘
```

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
├── shl.js              # Core ZTWR library
├── requester/          # Healthcare portal demo
│   └── index.html
├── gateway/            # App selection gateway
│   └── gateway.html
├── source-flexpa/      # Flexpa data source
│   └── index.html
├── source-bwell/       # b.well data source
│   └── index.html
└── source-premera/     # Premera data source
    └── index.html
```

## 🧪 Request Format

The demo uses Navigator Credentials API format:

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
  gatewayBase: 'https://joshuamandel.com/shl-share-picker/gateway'
});
```

## 🔒 Security

- All sensitive data transported in hash fragments (never logged or sent to servers)
- BroadcastChannel for same-origin communication
- Gateway uses zero-knowledge architecture
- No server-side state or storage required
- Compatible with Content Security Policy

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please open an issue or pull request.

## 📚 Learn More

- **[PROTOCOL.md](PROTOCOL.md)** - Complete protocol specification and developer guide
- [Navigator Credentials API](https://developer.mozilla.org/en-US/docs/Web/API/Credential_Management_API)
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [SMART Health Cards](https://smarthealth.cards/)
- [FHIR](https://www.hl7.org/fhir/)
- [US Core Implementation Guide](http://hl7.org/fhir/us/core/)
