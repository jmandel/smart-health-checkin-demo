# SMART Health Check-in Android App Spec

## Current Reference Context

The existing repository contains a protocol spec, a browser shim, and a web reference demo:

- `README.md` defines the SMART Health Check-in profile of OID4VP.
- `src/smart-health-checkin.ts` is the browser requester shim. It starts same-device and cross-device transactions, creates an ephemeral encryption key pair, launches the picker, fetches the encrypted result, decrypts it, validates `state`, and rehydrates inline references.
- `demo/relay` is the verifier backend. It serves `well_known:` metadata, JWKS, signed Request Objects, request-specific response endpoints, and result retrieval endpoints.
- `demo/portal` is the same-device requester demo.
- `demo/kiosk` is the staff-session-bound cross-device requester demo.
- `demo/checkin` is the picker/routing page.
- `demo/source-app` is the mock wallet/source app. It resolves and verifies the signed Request Object, renders requested records and questionnaires, builds `vp_token`, encrypts the response, and posts it to `response_uri`.

The Android app should be additive. It should interoperate with the existing verifier backend, picker, portal, and kiosk instead of replacing them.

## Recommendation

Build the first Android app as a native **"Sample Health Android Demo"** source app, equivalent to `demo/source-app`.

This is the highest-value MVP because:

- It demonstrates the realistic patient-phone side of the protocol.
- It can work with the existing web portal and web kiosk without relay changes.
- It exercises the hardest native pieces: deep links, Request Object verification, FHIR consent UI, JWE encryption, and returning control to the browser.
- It avoids prematurely reimplementing the requester shim before the source-app flow is proven.

A later phase can add native requester modes: "Patient Portal" and "Front Desk Kiosk" inside the same APK or as separate apps.

## Product Goal

Create an Android demo app that can receive a SMART Health Check-in launch request, let the user review requested health artifacts, share selected data, and complete both current web demo flows:

1. Same-device: patient uses an Android browser to start portal check-in, chooses "Sample Health Android Demo", shares data, and returns to the browser portal with the registration complete.
2. Cross-device: staff starts kiosk check-in, patient scans a QR code on Android, chooses "Sample Health Android Demo", shares data, and the kiosk receives the encrypted result through the existing long-poll path.

## Non-Goals for MVP

- Production patient authentication.
- Live EHR, payer, or FHIR server integration.
- General-purpose wallet credential storage.
- Full FHIR Questionnaire feature parity.
- Cryptographic proof of clinical data provenance beyond the profile's current `smart_artifact` semantics.
- Native replacement for the verifier relay.
- WebView wrapper around the existing web source app.
- Throwaway Android UI. The demo should use Kotlin and modern Android UI conventions, with system-bar safe layout and a polished native consent surface.

## Android Roles

### MVP Role: Native Source App

The Android app acts as an OID4VP Provider / wallet-side health source:

- Accepts launch URLs from the picker.
- Verifies the verifier's signed Request Object.
- Displays the verifier origin and requested artifacts.
- Lets the user consent to selected records and forms.
- Builds and encrypts the OID4VP Authorization Response.
- POSTs the encrypted JWE to the verifier-controlled `response_uri`.
- Handles `redirect` and `deferred` completion modes.

### Future Role: Native Requester

Later, the app can also host verifier/requester experiences:

- Patient portal requester mode, equivalent to `demo/portal`.
- Staff kiosk requester mode, equivalent to `demo/kiosk`.
- A native version of the browser shim from `src/smart-health-checkin.ts`.

Do not combine this into the MVP unless the goal changes. The source-app implementation gives the cleanest first integration point.

## User Flows

### Same-Device Android Browser Flow

1. Patient opens the existing web portal on Android.
2. Patient taps "Share with SMART Health Check-in".
3. Portal initializes a same-device transaction with `demo/relay`.
4. Portal launches the web picker with:
   - `client_id=well_known:<verifier-origin>`
   - `request_uri=<verifier-origin>/oid4vp/requests/<request_id>`
5. Picker offers "Sample Health Android Demo".
6. Picker launches the native app through an Android App Link or demo custom scheme.
7. Android app verifies the request and shows the requested data.
8. Patient shares or declines.
9. Android app encrypts the response and posts it to `response_uri`.
10. If relay returns `redirect_uri`, Android opens it with `ACTION_VIEW`.
11. The browser return page broadcasts `response_code`; the existing web shim fetches, decrypts, and completes.

### Cross-Device Kiosk Flow

1. Staff opens the existing web kiosk and signs in.
2. Kiosk initializes a cross-device transaction and displays a QR code.
3. Patient scans the QR code on Android.
4. Picker opens on Android and launches the native app.
5. Android app verifies the request and shows the requested data.
6. Patient shares or declines.
7. Android app encrypts and posts to `response_uri`.
8. Relay returns `{ "status": "ok" }`.
9. Android app shows "Submission complete".
10. Existing kiosk long-poll receives the JWE, decrypts it in the browser shim, and completes.

### Decline Flow

If the user declines, Android sends an encrypted OID4VP error response:

```json
{
  "error": "access_denied",
  "error_description": "User declined to share",
  "state": "<request_id>"
}
```

The completion behavior is the same as a successful response: follow `redirect_uri` for `redirect`, show done for `deferred`.

## Picker / Share Sheet Behavior

The web picker/share sheet should eventually include both source app options:

- "Sample Health App" for the existing web-based sample source app.
- "Sample Health Android Demo" for the native Android source app.

The Android entry should:

- Use a primary HTTPS Android App Link, equivalent to a universal link, so installed Android devices open the native app directly.
- Include an install link for users who do not have the app installed.
- Point the install link to the latest GitHub Release APK for this repository.
- Offer the web-based "Sample Health App" as a fallback path when native app installation is not appropriate.
- Clearly label the Android option so screenshots and demos distinguish it from the web sample app.

## Launch and Deep Link Design

Support two launch mechanisms:

1. Android App Links, using HTTPS universal-link-style URLs, for the primary demo and future production-like behavior.
2. A custom scheme only as a local/demo fallback if App Link verification is impractical in a local environment.

Recommended production-like URL:

```text
https://android-sample-app.smart-health-checkin.joshuamandel.com/authorize?client_id=...&request_uri=...
```

Recommended demo fallback:

```text
smart-health-checkin-sample://authorize?client_id=...&request_uri=...
```

The existing picker currently treats every app as a web `launchBase` and opens a popup. To support the Android app cleanly, extend `demo/config.ts` and `demo/checkin/src/App.tsx` with an app type:

```ts
type LaunchKind = 'web' | 'android-app-link' | 'custom-scheme';

interface AppConfig {
  id: string;
  name: string;
  launchBase: string;
  launchKind?: LaunchKind;
  installUrl?: string;
  fallbackUrl?: string;
}
```

For native launches, the picker should navigate the current top-level window to the App Link URL instead of opening a popup. If the app is not installed, show a fallback page with an install link to the GitHub Release APK and a link to the web source app.

### Android App Link Verification

Declaring an Android App Link intent filter is not enough to make the native app the default handler. The production/demo-default path requires:

- `android:autoVerify="true"` on the HTTPS intent filter.
- A reachable `https://<app-link-host>/.well-known/assetlinks.json`.
- An `assetlinks.json` statement that lists the Android package name.
- The SHA-256 fingerprint of the signing certificate used for the APK being installed.

The signing certificate fingerprint is the domain-binding anchor. If the JSON file is missing, the fingerprint is wrong, or the domain is not reachable, Android verification fails and the app should not be expected to open as the default handler.

For this repo, keep the verifier/requester host and the Android App Link host separate:

- Verifier/requester: `https://smart-health-checkin.exe.xyz`
- Android App Link identity: `https://android-sample-app.smart-health-checkin.joshuamandel.com/authorize`

The Android App Link host only needs to serve `/.well-known/assetlinks.json` and a browser fallback at `/authorize/`. The app still validates the signed Request Object from the verifier's `well_known:` origin before sharing data.

The static web demo keeps these deployment choices in JSON profiles under `deployments/`. `build.ts` bakes the selected profile into the browser bundles, and `demo/serve-demo.ts` uses the same profile as defaults for `VERIFIER_BASE`, port, canonical origin, and same-device origin policy. A profile can add deployment-specific share-sheet entries with top-level `extraApps`; the Android demo app is configured this way so local and public deployments can use different launch URLs.

For development and QA, document the escape hatches separately:

- Manual approval: Settings -> Apps -> Sample Health Android Demo -> Open by default -> add/approve the domain.
- ADB force approval: `adb shell pm set-app-links --package <pkg> 1 <domain>` can force approval on a specific test device/user.
- Verification inspection: use `adb shell pm get-app-links <pkg>` and Android's App Links verification commands to inspect state.

These shortcuts are test-device state only. They do not prove domain ownership, do not travel with the APK, and should not be used as release acceptance criteria. Debug builds still need an `assetlinks.json` entry with the debug keystore fingerprint if we want real verification; the same file may list both debug and release fingerprints for demo domains.

## Protocol Requirements

### Bootstrap Parsing

The Android app must parse:

- `client_id`
- `request_uri`
- optional `request_uri_method`

It must reject:

- Missing `client_id`.
- `client_id` without `well_known:` prefix.
- `well_known:` values that are not bare origins.
- Non-HTTPS verifier origins, except explicit local demo mode.
- Missing `request_uri`.

### Metadata and Request Verification

The app must follow the same rules as `demo/source-app`:

1. Derive metadata URL from `well_known:`:
   - `<origin>/.well-known/openid4vp-client`
2. Fetch metadata.
3. Confirm `metadata.client_id === bootstrap.client_id`.
4. Fetch `metadata.jwks_uri`.
5. Fetch the signed Request Object from `request_uri`.
6. Verify the JWT signature with JWKS.
7. Verify JWT `aud === "https://self-issued.me/v2"`.
8. Verify `client_id` inside the Request Object matches the bootstrap `client_id`.
9. Use only signed Request Object values for:
   - `response_uri`
   - `state`
   - `nonce`
   - `dcql_query`
   - `client_metadata`
   - `smart_health_checkin.completion`

The app should display the bare verifier origin by default. It must not trust metadata-supplied names, logos, or badges unless the verifier origin appears in an app-bundled trust allowlist.

### Supported Request Object Fields

Required:

- `response_type = "vp_token"`
- `response_mode = "direct_post.jwt"`
- `response_uri`
- `state`
- `nonce`
- `dcql_query`
- `client_metadata.jwks.keys[0]`
- `smart_health_checkin.completion = "redirect" | "deferred"`

Unsupported or malformed values should produce a visible error and no POST.

### Supported DCQL MVP

Support the repo's current `smart_artifact` subset:

- `format = "smart_artifact"`
- `require_cryptographic_holder_binding = false`
- `meta.profile`
- `meta.profiles`
- `meta.questionnaire`
- Optionality through `credential_sets`

MVP profile matching:

- CARIN digital insurance card `Coverage`.
- SBC `InsurancePlan`.
- Clinical history bundle containing Patient, AllergyIntolerance, and Condition data.
- Inline migraine questionnaire to `QuestionnaireResponse`.

### Response Construction

For success:

```json
{
  "vp_token": {
    "<credential-id>": [
      {
        "artifact_id": "art_0",
        "type": "fhir_resource",
        "data": {}
      }
    ]
  },
  "state": "<request_id>"
}
```

For repeated data, use the same inline reference pattern as the web source app:

```json
{ "artifact_ref": "art_0" }
```

### Encryption and POST

The Android app must:

1. Import the verifier-provided ephemeral public JWK from `client_metadata.jwks`.
2. Encrypt the JSON response as compact JWE.
3. Use:
   - `alg = "ECDH-ES"`
   - `enc = "A256GCM"` unless the Request Object negotiates otherwise.
4. POST to `response_uri`:

```http
Content-Type: application/x-www-form-urlencoded

response=<compact-jwe>
```

### Completion Handling

If `smart_health_checkin.completion === "redirect"`:

- Expect response JSON with `redirect_uri`.
- Open `redirect_uri` using `Intent.ACTION_VIEW`.
- Treat missing `redirect_uri` as protocol error.
- Test that Android opens the same browser profile that initiated the portal flow. The existing web shim relies on the browser return page and `BroadcastChannel` to deliver `response_code` back to the waiting portal tab. If Android opens a different browser, same-device completion may not reach the original tab.

If `completion === "deferred"`:

- Expect `{ "status": "ok" }`.
- Do not expect or follow a redirect.
- Show completion and allow the user to close the app.

## Android Architecture

Use Kotlin, Jetpack Compose, coroutines, and a small protocol core that can be unit-tested without UI.

Suggested package layout:

```text
android/
  settings.gradle.kts
  build.gradle.kts
  app/
    build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/java/org/smarthealth/checkin/
      MainActivity.kt
      navigation/
      protocol/
        BootstrapRequest.kt
        MetadataClient.kt
        RequestObjectVerifier.kt
        DcqlParser.kt
        ResponseBuilder.kt
        JweEncryptor.kt
        ResponsePoster.kt
      data/
        DemoArtifactRepository.kt
        FhirModels.kt
      ui/
        VerifyRequestScreen.kt
        ConsentScreen.kt
        QuestionnaireScreen.kt
        TechnicalDetailsSheet.kt
        ResultScreen.kt
      trust/
        TrustRegistry.kt
    src/main/assets/
      demo-data/
        carin-coverage.json
        sbc-insurance-plan.json
        clinical-history-bundle.json
```

Recommended dependencies:

- OkHttp for HTTP.
- kotlinx.serialization for JSON.
- Nimbus JOSE + JWT or jose4j for JWT/JWE.
- Jetpack Compose Material 3 for UI.
- AndroidX Browser only if Custom Tabs are used for fallback web flows.

Before choosing the JOSE library, verify Android support for:

- ES256 JWT verification.
- JWK Set parsing.
- ECDH-ES compact JWE encryption with P-256.
- A256GCM content encryption.

## UI Scope

### Screen 1: Request Verification

States:

- Loading request.
- Verification failed.
- Request verified.

Display:

- Requesting verifier origin.
- Trusted display name/logo only if allowlisted.
- Number of requested items.
- "Technical details" expandable sheet with `client_id`, `request_uri`, `response_uri`, `state`, `nonce`, completion mode, and signature status.

### Screen 2: Consent Review

Cards:

- Digital insurance card.
- Plan benefits summary.
- Clinical history.
- Requested questionnaire.

Each artifact has an on/off control. Required credentials, if added later, cannot be disabled without declining the whole request.

### Screen 3: Questionnaire

Render the current migraine questionnaire subset:

- group
- display
- text
- boolean
- integer
- decimal
- date
- choice
- open-choice
- repeats
- readOnly
- enableWhen with basic comparison operators

Initial values should mirror `demo/source-app` so the demo visibly auto-fills the migraine check-in.

### Screen 4: Submit Result

States:

- Encrypting.
- Posting.
- Redirecting.
- Complete.
- Error with retry where safe.

The app should prevent double submission after a successful POST. The relay is first-write-wins, but the UI should still avoid confusing retries.

## Demo Data

Reuse the repo's existing examples:

- `demo/shared/carinInsuranceExamples.ts`
- `examples/carin-digital-insurance-card/Coverage-Example-Coverage-FSH.json`
- `examples/carin-digital-insurance-card/InsurancePlan-SBCExampleHMO.json`
- `demo/shared/clinicalHistoryExamples.ts`
- `demo/shared/migraineQuestionnaire.ts`

The Android app and the web-based `demo/source-app` should share the same sample/demo data. During implementation, lift the current TypeScript-only examples into a canonical shared data directory, for example:

```text
demo/shared-data/
  carin-coverage.json
  sbc-insurance-plan.json
  clinical-history-bundle.json
  migraine-questionnaire.json
  migraine-autofill-values.json
```

Then wire each build to consume that canonical data in the way that fits its toolchain:

- Web demo: import JSON directly, or generate TypeScript constants from the shared JSON.
- Android demo: copy the same JSON into `android/app/src/main/assets/demo-data/` through Gradle, or load it directly if the build structure allows.

Do not fork the sample data by hand. Keep it deterministic so both apps show the same member, plan, clinical history, and migraine questionnaire values, and tests can assert known values such as member ID `W123456789`.

## Local Development Constraints

Android devices and emulators will not automatically resolve `requester.localhost`, `checkin.localhost`, or other host-machine localhost names the same way a desktop browser does.

Recommended demo modes:

1. Use the deployed HTTPS demo for phone testing.
2. Use a tunnel such as ngrok or Cloudflare Tunnel for local development.
3. For emulator-only development, provide a separate Android config profile using reachable host URLs such as `10.0.2.2`, but expect App Link verification and origin semantics to differ from production.
4. For QA devices, allow a documented ADB force-approval path to exercise native-link behavior before the demo domain and `assetlinks.json` are finalized.

The cleanest MVP test is:

- Deploy or tunnel the web demo under reachable HTTPS origins.
- Add an Android app card to the picker.
- Launch the native app through the Android App Link; use a custom scheme only for local fallback if needed.

## Security Requirements

- Never display or persist decrypted PHI beyond the current demo session unless explicitly added later.
- Do not log JWE plaintext, decrypted responses, or selected FHIR resources.
- Do not trust verifier metadata branding unless allowlisted.
- Validate all Request Object fields before showing consent UI.
- Use TLS for verifier metadata, request object fetch, and response POST outside explicit local demo mode.
- Store no long-term private keys in the app for MVP.
- Keep all response encryption client-side in the Android app.
- Clear current transaction state after completion, decline, or fatal error.

## Integration Changes in This Repo

MVP repo changes when implementation starts:

1. Add an `android/` Gradle project in this repository for the native app.
2. Add an Android entry to `demo/config.ts`, for example:

```ts
{
  id: 'sample-health-android-demo',
  name: 'Sample Health Android Demo',
  description: 'Native Android health data app',
  category: 'phr',
  color: '#0d9488',
  logo: 'A',
  launchBase: 'https://android-sample-app.smart-health-checkin.joshuamandel.com/authorize',
  launchKind: 'android-app-link',
  installUrl: 'https://github.com/jmandel/smart-health-checkin-demo/releases/latest',
  fallbackUrl: `${location.origin}/source-app`
}
```

3. Update `demo/checkin/src/App.tsx` so native launch targets are opened with top-level navigation and a fallback install page.
4. Add a GitHub Release workflow or documented manual release process that publishes an installable demo APK.
5. Publish `/.well-known/assetlinks.json` for the App Link host, including package name and the SHA-256 fingerprints for the APK signing certs used in demos.
6. Move current sample data into a shared directory and update both web and Android builds to consume or copy it.
7. Add Android-specific docs to `README.md`, including the ADB force-approval path as testing-only setup.
8. Add CI or a local script for Android unit tests.

No relay API changes are required for the MVP native source app.

## Acceptance Criteria

### Functional

- "Sample Health Android Demo" appears in the picker/share sheet with a GitHub Release APK install link.
- Android app launches from the picker with `client_id` and `request_uri`.
- On the real demo host, Android App Link verification succeeds through `assetlinks.json`; ADB force approval is allowed only for local QA.
- Invalid or unsigned requests are rejected before consent UI.
- Valid Request Objects show verifier origin and requested artifacts.
- Sharing selected data posts an encrypted `direct_post.jwt` response.
- Declining posts an encrypted OID4VP error response.
- Same-device Android browser flow returns to the portal and completes.
- Cross-device kiosk QR flow completes through the existing kiosk long-poll.
- Technical details show signature verified and completion mode.
- Android and web sample apps render the same canonical demo data.

### Security

- Metadata `client_name` and `logo_uri` are ignored unless allowlisted.
- `state` in the response equals the Request Object `state`.
- The app uses only signed Request Object values for response processing.
- App rejects non-bare `well_known:` client identifiers.
- App rejects missing encryption key material.
- App does not log decrypted artifacts.

### Test Coverage

Unit tests:

- Bootstrap parsing.
- `well_known:` bare-origin validation.
- Metadata client ID mismatch.
- JWKS signature verification success/failure.
- Request Object required field validation.
- DCQL item extraction.
- QuestionnaireResponse generation.
- VP token inline reference de-duplication.
- OID4VP error response generation.

Integration tests:

- Mock relay request verification and response POST.
- Redirect completion returns `ACTION_VIEW` intent.
- Deferred completion shows done state.

Manual end-to-end tests:

- Same-device from Android browser.
- Cross-device from web kiosk QR scan.
- Decline path for both completion modes.

## Implementation Phases

### Phase 1: Scaffold and Launch

- Create Android project.
- Register Android App Link intent filters for the universal HTTPS launch URL.
- Add release/debug signing fingerprint collection instructions for `assetlinks.json`.
- Keep a custom scheme only if needed for local fallback.
- Parse bootstrap request.
- Add demo environment settings.
- Add basic request verification loading/error UI.

### Phase 2: Protocol Core

- Fetch metadata and JWKS.
- Fetch and verify signed Request Object.
- Validate required fields.
- Parse DCQL into displayable request items.
- Add protocol unit tests.

### Phase 3: Consent UI and Demo Data

- Lift sample/demo data into a shared repo directory used by both `demo/source-app` and Android.
- Load or copy the shared demo FHIR and questionnaire JSON into Android assets.
- Render insurance, plan, clinical history, and questionnaire sections.
- Generate QuestionnaireResponse.
- Build `vp_token` with inline references.

### Phase 4: Encrypt and Submit

- Implement JWE encryption.
- POST form-encoded `response`.
- Implement redirect and deferred completion.
- Implement decline path.

### Phase 5: Web Demo Integration

- Add "Sample Health Android Demo" option to the picker/share sheet.
- Add Android App Link launch behavior and GitHub Release APK install fallback in the picker.
- Publish and verify `assetlinks.json` for the selected App Link host.
- Document manual and ADB force-approval paths as test-only alternatives.
- Document local development setup.
- Run same-device and cross-device manual demos.

### Phase 6: Native Requester, Optional

- Reimplement requester shim logic in Kotlin:
  - generate ephemeral key pair
  - call `/oid4vp/{flow}/init`
  - launch picker
  - receive redirect/deferred completion
  - fetch result
  - decrypt JWE
  - validate `state`
  - rehydrate inline references
- Add native patient portal and staff kiosk modes if needed.

## Open Questions

- What exact DNS/CDN deployment should serve `android-sample-app.smart-health-checkin.joshuamandel.com`?
- Is a custom scheme still needed for local-only fallback?
- What package name should be used for the demo app?
- What minimum Android SDK should be supported? A practical default is minSdk 26.
- Should the APK include only the source-app role, or expose future requester modes behind a demo switch?
- Should GitHub Releases publish a signed release APK, a debug-signed demo APK, or both?
- Which signing fingerprints should the demo `assetlinks.json` list: release only, debug only, or both?
- Should trusted verifier allowlist be hardcoded for demo or loaded from a signed config?
- Should local testing use the public hosted demo, a tunnel, or an emulator-specific config?
