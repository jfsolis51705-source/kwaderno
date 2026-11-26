# KWADERNO Scan — QR & barcode scanner (PWA)

One web app that scans **QR codes and product barcodes** with the phone or computer camera. Works on Android (Chrome), iPhone/iPad (Safari) and desktop browsers, and can be installed to the home screen.

## What it does

- **Live and automatic.** The camera opens with the page, using the back lens (1920×1080, continuous autofocus). About 10 times a second it looks for a QR code or barcode, and captures the moment it recognizes one. There's no button to press and no QR/barcode mode switch.
- **The green box.** Every capture draws a green box around the code, plays a beep and vibrates (`navigator.vibrate(100)`), then shows the product page. In **Batch** mode it keeps scanning and adds to a list, skipping the same code within 2 s.
- **Formats.** QR, Data Matrix, PDF417 and Aztec, plus EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Code 93, ITF and Codabar. EAN/UPC codes must pass the check digit.
- **Viewfinder.** A wide 16:10 scan window, so a retail barcode fits with its quiet zones; a dark mask around it; corner brackets; a scan line; and rotating tips (tap to focus, pinch to zoom, tilt against glare).
- **Camera controls.** Tap to focus, pinch or slider to zoom, and a flashlight, each shown only when `track.getCapabilities()` says the camera has it. A lens switch appears when there's more than one camera.
- **Bluetooth / USB scanners.** These "keyboard wedge" scanners type a code in a burst (under 50 ms per key) and press Enter. They're caught anywhere on the page, so no text box needs focus (on iPhone/iPad a paired scanner hides the keyboard). Normal typing is ignored. Each scan is tagged with its source.
- **Product page.** Shows the code, format, check digit result, the GS1 prefix country (480–489 = Philippines) and the barcode drawn again. Name and photo come from Open Food Facts; only the barcode number is sent. Also Copy, Web search, and Open link for QR links (with a warning to check the address).
- **Type the number.** A fallback with a check: 9–11 digits or a wrong check digit is flagged before use.
- **History.** Kept on the device (`localStorage`: id, value, format, source, timestamp), with search, delete, Clear all and **Export CSV** (formula-safe).
- **Error messages** for: not HTTPS, permission refused (steps for iPhone, Android and desktop), no camera, camera busy, in-app browsers (Facebook, Messenger…). The camera is released when the app goes to the background (`track.stop()`).

## Used from KWADERNO

KWADERNO runs inside claude.ai, which doesn't allow the live camera there. Its **Scan** button therefore opens this scanner in a new tab:

```
https://<pages-host>/kwaderno/?kw=1&return=https://claude.ai/artifact/<id>#scan-sell-
```

The code is sent back in one of two ways:

1. **Message.** `postMessage({ type: "kw-scan", code, mode })` to the KWADERNO tab that opened the scanner. KWADERNO only accepts messages from the scanner's origin.
2. **Link.** If there's no opener, the scanner opens `…#scan-sell-<code>`. KWADERNO reads it and adds the item.

`return` must be a `https://claude.ai/artifact/…#scan-(sell|stock)-` link, so the scanner can't be used to redirect to other sites.

## Decoding

| | |
|---|---|
| Android Chrome (and other browsers that have it) | The phone's built-in `BarcodeDetector`: fast, and gives the code's corners for the green box |
| iPhone / iPad / Mac Safari, Firefox, older phones | [`@zxing/library`](https://github.com/zxing-js/library) 0.21.3 (MIT), with `TRY_HARDER`, on the scan window (plus 12% margin) at full camera resolution. It also tries the window turned 90°, the whole picture, and a "find the stripes and zoom in" pass for small or far barcodes |

`html5-qrcode` was removed. Its bundled ZXing copy turns "try harder" off and missed even clean EAN-13s in testing.

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
styles.css            full-screen camera, wide scan window, result and history sheets
app.js                camera, auto-capture, Bluetooth/USB scanner, KWADERNO return, history, CSV, errors
sw.js                 offline cache
manifest.webmanifest  PWA manifest (192, 512, maskable icons)
icons/                app icons
vendor/               @zxing/library 0.21.3 (+ licence)
```

## Privacy

Scans are stored only in the browser on this device. Nothing is uploaded.
