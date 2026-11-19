# GemReady on iOS

Two ways to ship. **Use path A for launch.** Path B is the native version for later.

## A. Capacitor wrapper (recommended for v1)

Wraps the tested web app (`../web`) in a real iOS app. Same code, same tests,
camera works inside the app.

On a Mac with Xcode 15+:

```bash
cd gemready
npm install                  # installs Capacitor
npm run cap:ios              # adds ios/App, syncs web/, opens Xcode
```

Then in Xcode:

1. **Signing & Capabilities** → pick your team, bundle id `app.gemready.ios`
   (or yours; match `capacitor.config.json`).
2. **Info.plist** → add
   - `NSCameraUsageDescription` = "GemReady uses the camera to photograph your card. Photos stay on your phone."
   - `NSPhotoLibraryUsageDescription` = "Pick photos of a card to check its condition."
3. Drag `ios/PrivacyInfo.xcprivacy` into the App target.
4. App icon: drag `ios/AppIcon-1024.png` into Assets → AppIcon (single size).
5. Set the API host: in `web/index.html` the Capacitor build uses
   `https://api.gemready.app` — change it to your deployed backend.
6. Product → Archive → Distribute → App Store Connect.

**Push notifications in the wrapped app:** iOS doesn't deliver Web Push inside
a WKWebView. Price alerts need `@capacitor/push-notifications` + an APNs key
and a small backend change (send via APNs instead of web-push). Until then,
hide the alerts switch in the native build or ship without alerts.

## B. Native SwiftUI (starter in `GemReady/`)

`GemReady/` has a SwiftUI app with onboarding (age + privacy), scan
front/back, on-device centering (Vision squares up the card first) and photo
checks, the beta estimate screen, outcomes from the API, collection and
settings with Delete My Data.

It was written without a compiler, so expect a few small fixes on first build.
To use it: File → New → Project → iOS App "GemReady" (SwiftUI, Swift), delete
the generated `ContentView.swift`/`App.swift`, drag in the `GemReady/` folder,
add the Info.plist keys and privacy manifest above, and add a `GemReadyAPI`
string key to Info.plist with your backend URL. Add the DM Serif Display font
if you want the serif titles (or switch to `.serif` design).

What the native starter doesn't have yet (the web app does): close-ups and
tilt shots, retake flow per slot, costs and compare screens, submissions and
slab results, accuracy, grade key, feedback, odds mode.
