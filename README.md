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
3. **Tablet.** Open the page, tap the gear, paste the backend URL and secret, pick your city. For full-screen, always-on use, install **Fully Kiosk Browser**. To skip typing on the tablet, build a one-time link in the guide (**On the tablet → Use another device**).

## Files

| Path | |
|---|---|
| `dashboard/index.html`, `styles.css`, `app.js` | The display |
| `dashboard/icons.js`, `backgrounds.js`, `guide.js` | Icons, built-in backgrounds, in-app guide |
| `dashboard/setup/Code.gs`, `appsscript.json` | The Google backend |
| `dashboard/fonts/` | Bricolage Grotesque and Geist Mono (SIL OFL) |
| `dashboard/sw.js`, `manifest.webmanifest`, `icon.svg` | Offline fallback and installability |
| `.github/workflows/pages.yml` | Publishes `dashboard/` to GitHub Pages |
