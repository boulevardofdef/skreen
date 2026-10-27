# Skreen brand kit (B1 · Panels)

## Colors

| Name   | Hex       | Use                                   |
|--------|-----------|---------------------------------------|
| Ink    | `#16130F` | Wordmark, k stem, dark backgrounds    |
| Orange | `#FF5A2E` | k arms (the only orange in the logo)  |
| Cream  | `#F3EEE3` | Icon tiles, light backgrounds, reversed wordmark |

For orange **text** on cream (like "whole day."), use `#F04E23`. It's slightly darker, so it holds up at body sizes.

## Type

The wordmark is set in Bricolage Grotesque ExtraBold (800, optical size 72) with −0.03em tracking. The k is a custom glyph, not a letter from the font. The SVGs are fully outlined, so you don't need the font installed to use them.

## Rules

- **Clear space:** keep at least the height of the "e" (about 75% of the k's stem height) clear on every side of the wordmark.
- **Minimum size:** 16 px tall for the wordmark on screen. Below that, use the k on its own.
- Keep the stem one color and the arms orange. The only exceptions are the one-color `-black` and `-white` versions.
- Don't rebuild the wordmark from live text. The k isn't in the font.

## What's where

```
logo/                    master SVGs (use these anywhere you can)
  skreen-wordmark.svg            ink + orange, for light backgrounds
  skreen-wordmark-reverse.svg    cream + orange, for dark backgrounds
  skreen-wordmark-black/white.svg  one-color
  skreen-k*.svg                  the glyph on its own
  skreen-app-icon(-dark).svg     rounded-tile icon for decks, docs, press
  png/                           transparent PNGs at 48/96/192 px tall

play-store/
  icon-512.png                   512×512, opaque, full-bleed (Play applies its own mask)
  feature-graphic-1024x500.png   required store banner

android/app/src/main/res/        merge straight into your Kotlin project's res/
  mipmap-anydpi-v26/ic_launcher(_round).xml   adaptive icon (API 26+)
  drawable/ic_launcher_foreground.xml         vector foreground (glyph inside the 66dp safe zone)
  drawable/ic_launcher_monochrome.xml         Android 13+ themed icon
  values/ic_launcher_background.xml           cream background color
  mipmap-*dpi/ic_launcher(_round).png         legacy PNGs (API < 26)

web/
  favicon.svg, favicon.ico, favicon-16/32/48.png
  apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png
  og-image-1200x630.png, og.jpg  (og.jpg is a drop-in replacement for the current one)

ios/AppIcon-1024.png             for the future iPad build (opaque, no rounding; iOS rounds it)
```

## Android notes

- If your manifest already points to `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`, dropping these files in is all it takes. Delete any older `ic_launcher*.webp` files first, or the build will fail on duplicate resources.
- The `<monochrome>` layer needs compileSdk 33 or later. Older devices ignore it.

## Site `<head>` snippet

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:image" content="https://skreen.fyi/img/og.jpg">
```

Header logo: replace `img/logo-header.png` with `logo/skreen-wordmark.svg`:

```html
<img src="/img/skreen-wordmark.svg" alt="Skreen" height="32">
```

`site.webmanifest`:

```json
{
  "name": "Skreen",
  "short_name": "Skreen",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "theme_color": "#F3EEE3",
  "background_color": "#F3EEE3",
  "display": "standalone"
}
```
