# Sample Health Android Demo

Native Android source-app demo for SMART Health Check-in. The app receives the picker launch URL, verifies the signed Request Object, renders requested demo artifacts and inline FHIR Questionnaires, encrypts the OID4VP response, and posts to the verifier `response_uri`.

The app is implemented in Kotlin with Jetpack Compose and Material 3 components. It is intended to look and behave like a small native demo product, with system-bar safe layout, consent cards, readable form controls, and no Java activity code.

## Build

```bash
cd android
./gradlew :app:assembleDebug
```

Debug APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The Gradle build copies canonical demo JSON from `../demo/shared-data` into generated Android assets. Do not maintain a separate copy under `app/src/main/assets`.

## Install

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Launch Links

The manifest supports:

- Verified HTTPS App Link: `https://android-sample-app.smart-health-checkin.joshuamandel.com/authorize?...`
- Legacy HTTPS App Link: `https://smart-health-checkin.exe.xyz/android/authorize?...`
- Local testing scheme: `smart-health-checkin-sample://authorize?...`

Default HTTPS handling requires a valid `/.well-known/assetlinks.json` on the App Link host. For device-only QA before that is deployed:

```bash
adb shell pm set-app-links --package org.smarthealth.checkin.androiddemo 1 android-sample-app.smart-health-checkin.joshuamandel.com
adb shell pm get-app-links org.smarthealth.checkin.androiddemo
```

That force approval is local to the device/user. It is not a substitute for domain verification.

The public verifier origin and Android App Link host are defined in `../deployments/public-demo.json`. The local defaults are in `../deployments/local.json`.
