# KWADERNO Scan — QR & barcode scanner (PWA)

One web app that scans **QR codes and product barcodes** with the phone or computer camera. Works on Android (Chrome), iPhone/iPad (Safari) and desktop browsers, and can be installed to the home screen.

## What it does

- **Live scan, no button to press.** It uses the back camera by default (`facingMode: "environment"`) and reads a code anywhere in the picture. A beep and vibration confirm each scan.
- **Formats:**
  - 2D: QR, Data Matrix, PDF417 and Aztec.
  - 1D: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Code 93, ITF and Codabar.
- **Camera / lens picker** (wide, ultra-wide, front …), plus a **flashlight** button and **zoom** slider on cameras that support them.
- **Scan from a photo** for when the camera can't be used.
  - For photos, it first finds where the barcode is, then zooms and straightens it. Small, far or tilted barcodes still read.
- **"Keep scanning" mode** for scanning many items in a row. Otherwise it pauses on each result and shows Copy / Open link / Scan again.
- **History** is kept on the device (`localStorage`, up to 1,000 scans), with a format badge, time, copy, delete and search.
  - **Export CSV**: quotes are escaped, and cells starting with `= + - @` get a leading `'` so spreadsheets don't run them as formulas.
- **Clear error messages** for each case:
  - page not on HTTPS
  - camera permission refused (with steps for iPhone, Android and desktop)
  - no camera
  - camera busy in another app
  - in-app browsers (Facebook, Messenger, Instagram …), which can't use the camera
  - pages embedded without camera access
- **Offline:** a service worker keeps the app's files on the device, so it opens without internet after the first visit.

## Decoding

| Part | Library |
|---|---|
| Camera, lens, flashlight, zoom, QR and 2D codes | [`html5-qrcode`](https://github.com/mebjas/html5-qrcode) 2.3.8 (Apache-2.0). Uses the phone's built-in `BarcodeDetector` when it has one. |
| 1D product barcodes | [`@zxing/library`](https://github.com/zxing-js/library) 0.21.3 (MIT) in "try harder" mode, on the middle band of each frame (every third frame turned 90°) and on photos |

Why two libraries: the ZXing copy inside `html5-qrcode` 2.3.8 turns "try harder" off and missed even clean, computer-generated EAN-13 codes in testing. Both libraries are bundled in `vendor/` unchanged, so nothing loads from a CDN.

**Why the camera box is drawn 2.5× bigger:** `html5-qrcode` decodes each frame at the on-screen size of its container. On a phone that is only about 360 px wide, which loses detail. Here the container is laid out 2.5× bigger and shown scaled down, so the decoder sees more pixels.

## Hosting (HTTPS is required for the camera)

Any static HTTPS host works. The files are plain HTML, CSS and JS, with no build step.

**GitHub Pages:** the `gh-pages` branch holds these files at its root. Turn it on once:

1. Open the repository's **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Pick **`gh-pages`** and **`/ (root)`**, then save.

The app is then at `https://<owner>.github.io/<repo>/`.

**Local testing:** run `python3 -m http.server 8766` in this folder and open `http://localhost:8766/`. Browsers treat `localhost` as secure, so the camera works.

## Install on a phone

- **Android (Chrome):** menu ⋮ → *Install app* (or *Add to Home screen*).
- **iPhone (Safari):** Share → *Add to Home Screen*. The camera works in the installed app on iOS 14.3 and newer.

## Files

```
index.html            page
styles.css            dark scan screen with red corners and scan line
app.js                camera, decoding, history, CSV, errors
sw.js                 offline cache
manifest.webmanifest  PWA manifest (192, 512, maskable icons)
icons/                app icons
vendor/               html5-qrcode 2.3.8, @zxing/library 0.21.3 (+ licences)
```

## Privacy

Scans are stored only in the browser on this device. Nothing is uploaded.
