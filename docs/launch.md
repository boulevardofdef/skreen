# Launching Skreen with Google sign-in

This is the checklist for going from "works for me" to "other people can use it".

## 1. Google Cloud setup (needed even for your own use)

Google needs to know the app exists before it will hand out Calendar and Tasks access.

1. Go to <https://console.cloud.google.com> and create a project named **Skreen**.
2. **APIs & Services → Library**: enable **Google Calendar API** and **Google Tasks API**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**. App name **Skreen**. Support email: yours.
   - **Data access (scopes)**: add `.../auth/calendar.readonly` and `.../auth/tasks`.
   - While you are the only user, leave it in **Testing** and add your Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Android**
   - Package name: `app.skreen.wall`
   - SHA-1 certificate fingerprint of the sideload key in this repo:
     `3B:06:75:D7:E6:0D:DE:7D:45:BD:8E:02:4F:31:60:53:8C:BF:69:E3`
   - There is no client ID to paste anywhere: Google matches the app by package name + fingerprint.
5. Install the APK, open Skreen, tap **Sign in with Google**.

If sign-in lapses after about a week while the app is in *Testing*, switch **Publishing status** to **In production**. An unverified app is allowed up to 100 users and shows an "unverified app" warning screen, which is fine for you and early testers.

## 2. Google verification (needed before the public)

Calendar and Tasks are "sensitive" scopes, so Google reviews the app before removing the warning screen and the 100-user cap. It's free, but takes days to weeks. You'll need:

- **A domain you own.** Google requires an "authorized domain" and a homepage/privacy-policy URL on it. `github.io` addresses don't qualify. Buy a domain (for example `skreen.app`), point it at GitHub Pages (repo **Settings → Pages → Custom domain**), and verify it in Google Search Console.
- **Privacy policy URL:** `https://<your-domain>/privacy.html` (the file is `dashboard/privacy.html`; contact email is support@skreen.fyi).
- **Scope justifications** (paste into the form):
  - *calendar.readonly*: "Skreen is a wall display. It reads the user's calendar events to show the day's schedule on screen. It never modifies calendars."
  - *tasks*: "Skreen shows the user's chosen Google Tasks list and lets them add items and check items off from the display."
- **A demo video** (unlisted YouTube) showing: the sign-in and consent screen with the OAuth client visible, the calendars being used, a task being added and checked off, and the privacy policy.
- Skreen has no backend, so there's no server-side storage to describe; say so.

## 3. Google Play

- Create a Play Console account ($25 one-time). New personal accounts must run a closed test with a minimum number of testers for a minimum period before production; check Play's current requirement.
- Ship an **Android App Bundle**, not the sideload APK. Use **Play App Signing**, then add the *Play signing key's* SHA-1 (Play Console → App integrity) as a second Android OAuth client in Google Cloud, with the same package name. The sideload key's SHA-1 above only covers the sideloaded APK.
- Fill in the **Data safety** form: location (approximate, optional), calendar and tasks data accessed but not collected or shared off-device, no ads, no analytics.
- Play prefers apps that are more than a website in a frame. Skreen's native sign-in, brightness control and kiosk behavior help; the store listing should lead with those.
- Decide whether the app loads the live site (instant updates) or bundles it (changes go through store review). Remote-loaded content is allowed for a WebView app, but it must not change what the app does in ways your listing doesn't describe.
- **Remove self-update from the Play build.** The in-app updater (`REQUEST_INSTALL_PACKAGES`, `downloadAndInstall` in `MainActivity.java`, and the update UI in `app.js`) is for sideloaded APKs only. Play policy doesn't allow apps to install updates outside Play, and the store updates the app for you. Strip the permission and the updater before building the bundle (or gate it behind a build flavor).
- **Amazon Fire tablets** have no Google Play Services, so native Google sign-in won't work there.

## 4. Weather

Forecasts come from MET Norway through the Cloudflare Worker in `worker/` (free for commercial use; keep the attribution, and re-read their terms before launch). City search and place names go through the same Worker to OpenStreetMap Nominatim (`/geocode`, `/reverse`): keep the "© OpenStreetMap contributors" credit, keep request volume low (Nominatim's policy is about 1 request a second; the Worker caches), and redeploy the Worker whenever `worker/index.js` changes (paste it into the Cloudflare editor again).

## Skreen Plus (paid features)

- **Play Console:** create one **one-time (non-consumable) in-app product** with product ID `skreen_plus` and set its price ($14.99 launch price; you can raise it later and existing buyers keep it). The app reads the price from Play and shows "Unlock Skreen+ · price". `PlusBilling.java` handles purchase, acknowledgement and restore on launch; the answer is cached so Plus works offline. Billing only works for builds installed from Play (internal testing track is fine).
- **What is gated:** `Plus.active()` in `dashboard/plus.js`. Today that covers the Layout editor; add new paid features by checking it.
- **Unlock code:** a personal code (its hash lives in `plus.js`; the code itself is not in the repo) unlocks Plus on sideloaded builds, the owner's devices and testers. To make a new one: pick a random `SKR-XXXX-XXXX-XXXX-XXXX`, put `sha256("skreen-plus:" + code)` in `CODE_HASH`. Treat it like a password: anyone with the code has Plus.
- **Limits of the lock:** it runs on the device, so a determined person can bypass it. Fine for layout options; the cloud calendar and to-do list will be enforced on the server.
- **iOS:** needs StoreKit (Apple in-app purchase, a non-consumable) in the iOS shell, since Apple requires it for digital features.
- **Pricing:** $14.99 one-time, promoted as a launch price. Careful with "everything": say what Plus includes today, and decide before launch whether future server-hosted features (cloud calendar and to-do) fit a one-time price.

## Custom domain (skreen.fyi)

The app lives at `https://app.skreen.fyi/`; the bare `skreen.fyi` is reserved for a marketing site (host it separately, for example on Cloudflare Pages). The Android app trusts only `app.skreen.fyi` with its native bridge.

1. Cloudflare DNS for `skreen.fyi`, set to **DNS only** (grey cloud): a `CNAME` named `app` pointing to `boulevardofdef.github.io`.
2. GitHub repo Settings → Pages → Custom domain: `app.skreen.fyi`, save, wait for the DNS check, then tick **Enforce HTTPS**.
3. Old four `A` records and the `www` CNAME (pointing at GitHub) are no longer needed once the marketing site has a host; point the bare domain there instead.
4. `SKREEN_START_URL` in `android.yml` points the APK at `https://app.skreen.fyi/`. Settings saved in the page (location, layout, Plus code) are per web address, so they reset when the address changes.
5. Marketing site should carry the privacy policy at `https://skreen.fyi/privacy` (or keep `https://app.skreen.fyi/privacy.html`) for Google verification and the store listings; verify the domain in Google Search Console.

## Play Store build (Android App Bundle)

- Two builds share one codebase: `sideload` (the APK on GitHub Releases, with the self-updater) and `play` (the bundle for Google Play: no updater, no install permission, targets Android 16 / API 36 as Play requires for new apps). CI compiles both on every Android change.
- **Upload key:** make a private upload keystore (never commit it) and add four repository secrets under Settings → Secrets and variables → Actions: `UPLOAD_KEYSTORE_B64` (the keystore, base64), `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEY_ALIAS`, `UPLOAD_KEY_PASSWORD`. Keep a copy of the keystore and passwords in a password manager.
- **Build:** Actions → "Build Play Store bundle" → Run workflow, then download `Skreen-play-aab` from the run page and upload the `.aab` to the Play Console. Enrol in Play App Signing; add Play's signing-key SHA-1 to the Android OAuth client in Google Cloud (see section 3).
- The build counter for the bundle is that workflow's run number; Play needs every upload to have a higher version code than the last, which it does.

## Photos widget (Skreen+)

- **My photos:** Settings → Photos → Choose photos opens Android's own picker (the system photo picker on Android 13+, which includes Google Photos; the file chooser on older versions). Skreen copies each picture, shrunk to 2048 px, into its private storage (`files/photos`, up to 300) and serves them to the page through `WebViewAssetLoader` at `/skreen-photos/`. No Google permissions or API keys are involved. Native code: `pickPhotos`, `listPhotos`, `clearPhotos`, `copyPhotos`/`saveShrunk` in `MainActivity.java`.
- **Art gallery:** the relay's `/art` route returns public-domain paintings from Wikimedia Commons (featured pictures of paintings), falling back to the Art Institute of Chicago API (CC0) whose image server is behind a bot check. Keep the credit in Settings. If the API's query format changes, the fix is in `worker/index.js`.

## The relay (Cloudflare Worker)

`worker/index.js` serves forecasts, city search and place names, public-domain art (`/art`), fetches published calendar links (`/ics`), and the Wikipedia "In the news" list (`/news`, CC BY-SA: keep the credit under the widget). **Redeploy it** (paste the file into the Cloudflare editor, Deploy) whenever it changes. It keeps nothing except short-lived cache entries (calendar links are cached under a hash, not the link).
