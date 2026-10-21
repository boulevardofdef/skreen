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
- **Privacy policy URL:** `https://<your-domain>/privacy.html` (the file is `dashboard/privacy.html`; replace the contact email placeholder first).
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

## 4. Freemium and weather

The free weather service (Open-Meteo) is for non-commercial use. An app with a paid tier is commercial, so before launch move to their paid plan (a key plus an endpoint change in `refreshWeather()` and the geocoding search in `app.js`) or another provider. Check their current terms.
