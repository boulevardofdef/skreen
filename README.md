# Skreen

A wall display for an always-on Android tablet: **Google Calendar**, a **household to-do list**, **weather**, a very large **clock**, and calm rotating **backgrounds**. It has its own look: ink-black, bone-white type, one signal-orange accent, square corners and big, confident numerals. Self-hosted fonts, no Google fonts.

![Skreen](docs/screenshot.jpg)

| Big-screen tour (anti burn-in) | Night mode |
|---|---|
| ![Tour](docs/screenshot-tour.jpg) | ![Night](docs/screenshot-night.jpg) |

## What it does

- **Schedule.** What's left today, then the next few days. The event in progress is a solid orange block with a progress bar; one starting within the hour gets a countdown. All-day events become tags, declined events are hidden.
- **To-do list.** Tap to check off. **Checked items stay on screen, struck through, for 24 hours**, then vanish; tap one to bring it back. Add items with the big button, by voice, or from your phone via Google Tasks.
- **Weather.** Now, the next 6 hours, 5 days, and a plain-English rain outlook. Open-Meteo, no key.
- **Backgrounds.** Nine built-in dark backgrounds, one per day, or pin your favorite. Optional photos from a Google Drive folder, dimmed and softly blurred so text always stays readable.
- **Big-screen tour.** Every 5 minutes (adjustable) it spends ~30 seconds on **BIG time → BIG weather → BIG calendar → BIG to-do**, alternating left/centre/right. Tap to end it early.
- **Burn-in care.** The tour, a slow few-pixel layout drift, a night mode (black screen, dim wandering clock, next event) and moving backgrounds keep any pixel from staying lit.
- **Setup guide built in.** Tap the gear → **Setup guide**. It has copy-paste for the Google script and covers photos, the tablet, burn-in, and troubleshooting, with no GitHub required.

![Backgrounds](docs/screenshot-backgrounds.jpg)

### About Google Keep and Google Photos

- **Keep has no API for personal accounts**, so the list lives in **Google Tasks** (a list named "Household"), which you can edit from your phone, Gmail, Calendar or Docs.
- **Google Photos no longer lets apps browse your library** (since 2025). Use a **Google Drive folder** for photos.

## How it fits together

```
 Tablet (Chrome / Fully Kiosk)                 Your Google account
┌──────────────────────────────┐   JSON    ┌───────────────────────────────┐
│ dashboard/  (static web app) │ ◄──────── │ dashboard/setup/Code.gs       │
│  index.html · styles.css ·   │ ────────► │ Calendar · Tasks · Drive      │
│  app.js · guide.js …         │  add/done │ (Apps Script, runs as you)    │
└──────────────┬───────────────┘           └───────────────────────────────┘
               ▼ weather
          Open-Meteo
```

The tablet never holds Google login tokens, only a secret phrase that your script checks on each request, so nothing expires overnight.

## Setup

Everything is explained **inside the app** (⚙ → Setup guide), including a one-tap "Copy the script" button. The short version:

1. **Backend.** At [script.google.com](https://script.google.com) create a project, paste [`dashboard/setup/Code.gs`](dashboard/setup/Code.gs), set `SECRET`, add the **Google Tasks API** service, run `testSetup`, then **Deploy → Web app** (Execute as *Me*, access *Anyone*).
2. **Host the page.** This repo publishes `dashboard/` with GitHub Pages: **Settings → Pages → Source: GitHub Actions** (the repo must be public on the free plan). Any static host works.
3. **Tablet.** Install the Android app (below), open it, tap the gear, paste the backend URL and secret, and pick your city. To skip typing on the tablet, build a one-time link in the guide (**On the tablet → Use another device**).

## The Android app

`android/` is a small native shell around the dashboard: full-screen, screen always on, and it can **dim the screen itself** (day and night levels in Settings), which is the best burn-in protection there is. It also uses the system speech recognizer for the microphone button, and can optionally be set as the tablet's Home app so it starts at boot.

**It loads your live GitHub Pages site**, so edits to `dashboard/` reach the tablet as soon as Pages deploys, with no reinstall (the site's service worker keeps it running through Wi-Fi drops, and a copy bundled in the APK is a last-resort fallback). You only reinstall when `android/` changes. GitHub builds the APK automatically (`.github/workflows/android.yml`) and keeps the newest build at:

**`https://github.com/<you>/<repo>/releases/latest/download/Skreen.apk`**

Open that on the tablet in Chrome, allow *install unknown apps* when asked, and install. Updates install over the old version and keep your settings (every build is signed with the same key in `android/skreen-sideload.jks`, which is deliberately public: it's for personal sideloading, not the Play Store). Fully Kiosk Browser or Chrome's *Add to Home screen* still work if you'd rather not sideload.

## Files

| Path | |
|---|---|
| `dashboard/index.html`, `styles.css`, `app.js` | The display |
| `dashboard/icons.js`, `backgrounds.js`, `guide.js` | Icons, built-in backgrounds, in-app guide |
| `dashboard/setup/Code.gs`, `appsscript.json` | The Google backend |
| `dashboard/fonts/` | Bricolage Grotesque and Geist Mono (SIL OFL) |
| `dashboard/sw.js`, `manifest.webmanifest`, `icon.svg` | Offline fallback and installability |
| `android/` | The Android app (bundles `dashboard/`) |
| `.github/workflows/pages.yml` | Publishes `dashboard/` to GitHub Pages |
| `.github/workflows/android.yml` | Builds `Skreen.apk` and publishes it to the latest release |
