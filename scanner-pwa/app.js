/* KWADERNO Scan — QR + barcode scanner PWA (Android, iPhone, desktop).
 * Decoding: html5-qrcode 2.3.8 (ZXing; uses the phone's built-in BarcodeDetector when it has one).
 * Everything stays on this device: history is in localStorage. */
(() => {
  "use strict";
  const L = window.__Html5QrcodeLibrary__ || {};
  const Qr = L.Html5Qrcode, F = L.Html5QrcodeSupportedFormats;
  const $ = (id) => document.getElementById(id);
  const HIST_KEY = "kwscan-history", CAM_KEY = "kwscan-camera", KEEP_KEY = "kwscan-keep";

  const FORMATS = F ? [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC] : [];
  const NAMES = { QR_CODE: "QR", EAN_13: "EAN-13", EAN_8: "EAN-8", UPC_A: "UPC-A", UPC_E: "UPC-E", CODE_128: "Code 128", CODE_39: "Code 39", CODE_93: "Code 93",
    ITF: "ITF", CODABAR: "Codabar", DATA_MATRIX: "Data Matrix", PDF_417: "PDF417", AZTEC: "Aztec", MAXICODE: "MaxiCode", RSS_14: "GS1", RSS_EXPANDED: "GS1", UPC_EAN_EXTENSION: "EAN ext" };
  const TWO_D = new Set(["QR", "Data Matrix", "PDF417", "Aztec", "MaxiCode"]);
  const fmtName = (raw) => NAMES[raw] || String(raw || "Code").replace(/_/g, " ");

  // ---------- small helpers ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / full */ } },
  };
  let toastT = 0;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200); }
  function status(msg, busy = true) { $("statusText").textContent = msg; $("status").classList.toggle("idle", !busy); }
  let actx = null;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.value = 1760; g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.12);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.13);
    } catch { /* no audio */ }
    try { navigator.vibrate?.(60); } catch { /* no vibration */ }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { /* ignore */ } ta.remove(); return ok;
    }
  }
  const isUrl = (t) => { try { const u = new URL(t); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };
  const when = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

  // ---------- 1D barcode reader ----------
  // html5-qrcode's built-in ZXing copy misses many product barcodes (EAN/UPC/Code 128), so camera frames and
  // photos also go through ZXing 0.21.3 in "try harder" mode. QR codes stay with html5-qrcode.
  const ZX = window.ZXing;
  let reader1D = null;
  if (ZX) {
    const B = ZX.BarcodeFormat, h = new Map();
    h.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [B.EAN_13, B.EAN_8, B.UPC_A, B.UPC_E, B.CODE_128, B.CODE_39, B.CODE_93, B.ITF, B.CODABAR]);
    h.set(ZX.DecodeHintType.TRY_HARDER, true);
    reader1D = new ZX.MultiFormatReader(); reader1D.setHints(h);
  }
  /** Read a 1D barcode from a canvas; null if none. */
  function decode1D(c) {
    if (!reader1D) return null;
    for (const Bin of [ZX.HybridBinarizer, ZX.GlobalHistogramBinarizer]) {
      try { const r = reader1D.decode(new ZX.BinaryBitmap(new Bin(new ZX.HTMLCanvasElementLuminanceSource(c)))); return { text: r.getText(), format: ZX.BarcodeFormat[r.getBarcodeFormat()] }; }
      catch { /* not found with this binarizer */ } finally { try { reader1D.reset(); } catch { /* ignore */ } }
    }
    return null;
  }
  /** Draw part of an image/video onto a canvas: crop (in source pixels), scale to width w, optional 90° turn. */
  function draw(src, sw, sh, crop, w, turn) {
    const [x, y, cw, ch] = crop || [0, 0, sw, sh], k = w / cw, c = document.createElement("canvas");
    const W = Math.max(1, Math.round(cw * k)), H = Math.max(1, Math.round(ch * k));
    c.width = turn ? H : W; c.height = turn ? W : H;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (turn) { g.translate(H, 0); g.rotate(Math.PI / 2); }
    g.drawImage(src, x, y, cw, ch, 0, 0, W, H);
    return c;
  }
  /** Where in a photo are barcode-like stripes? (strong side-to-side contrast, vertical "v" or turned "h"), best first. */
  function locateBarcodes(bmp) {
    const W = 400, k = W / bmp.width, H = Math.max(8, Math.round(bmp.height * k)), c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data, Lm = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) Lm[i] = px[i * 4] * .3 + px[i * 4 + 1] * .59 + px[i * 4 + 2] * .11;
    const B = 8, bw = Math.floor(W / B), bh = Math.floor(H / B), sv = new Float32Array(bw * bh), sh = new Float32Array(bw * bh);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const gx = Math.abs(Lm[y * W + x + 1] - Lm[y * W + x - 1]), gy = Math.abs(Lm[(y + 1) * W + x] - Lm[(y - 1) * W + x]);
      const bi = Math.min(bh - 1, (y / B) | 0) * bw + Math.min(bw - 1, (x / B) | 0); sv[bi] += gx - gy; sh[bi] += gy - gx;
    }
    const out = [];
    for (const [s0, dir] of [[sv, "v"], [sh, "h"]]) {
      const sm = new Float32Array(s0.length);
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let t = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = bx + dx, ny = by + dy; if (nx >= 0 && ny >= 0 && nx < bw && ny < bh) t += Math.max(0, s0[ny * bw + nx]); } sm[by * bw + bx] = t / 9; }
      let m = 0; for (const v of sm) m = Math.max(m, v); if (!m) continue;
      const th = m * .3, seen = new Uint8Array(sm.length);
      for (let st = 0; st < sm.length; st++) {
        if (seen[st] || sm[st] <= th) continue;
        const q = [st]; seen[st] = 1; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, tot = 0;
        while (q.length) { const i = q.pop(), bx = i % bw, by = (i / bw) | 0; tot += sm[i]; x0 = Math.min(x0, bx); x1 = Math.max(x1, bx); y0 = Math.min(y0, by); y1 = Math.max(y1, by);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = bx + dx, ny = by + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const j = ny * bw + nx; if (!seen[j] && sm[j] > th) { seen[j] = 1; q.push(j); } } }
        out.push({ dir, tot, box: [x0 * B / k, y0 * B / k, (x1 + 1) * B / k, (y1 + 1) * B / k] });
      }
    }
    return out.sort((a, b) => b.tot - a.tot).slice(0, 5);
  }
  /** Cut out a found spot with a margin, zoom so the bars are `target` px long, straighten by `tilt`°, read it. */
  function readSpot(bmp, cand, target, tilt) {
    const [x0, y0, x1, y1] = cand.box, w = x1 - x0, hh = y1 - y0, pxm = w * .15, pym = hh * .35;
    const sx = Math.max(0, x0 - pxm), sy = Math.max(0, y0 - pym), sw = Math.min(bmp.width - sx, w + 2 * pxm), sh = Math.min(bmp.height - sy, hh + 2 * pym);
    if (sw < 16 || sh < 8) return null;
    const along = cand.dir === "v" ? sw : sh, k = target / along, cw = Math.round(sw * k), ch = Math.round(sh * k);
    if (cw * ch > 6e6) return null;
    const turn = cand.dir === "h" ? 90 : 0, c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true });
    c.width = turn ? ch : cw; c.height = turn ? cw : ch;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2); g.rotate((turn + tilt) * Math.PI / 180); g.translate(-cw / 2, -ch / 2);
    g.imageSmoothingQuality = "high"; g.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch);
    return decode1D(c);
  }
  /** Many tries on a still photo: find the barcode and zoom in (small, far or tilted), then whole picture and pieces. */
  function decodePhoto1D(img, w, h) {
    const t0 = performance.now(), cands = locateBarcodes(img);
    const passes = [[[1000, 0], [1300, 0]], [[900, -6], [900, 6], [1300, -6], [1300, 6], [600, 0]], [[1300, -12], [1300, 12], [900, -12], [900, 12], [600, -6], [600, 6]]];
    for (const pass of passes) for (const cand of cands) for (const [target, tilt] of pass) {
      if (performance.now() - t0 > 9000) break;
      const r = readSpot(img, cand, target, tilt); if (r) return r;
    }
    const tries = [[null, Math.min(w, 1600), false], [null, Math.min(h, 1600), true]];
    for (const z of [2, 3]) { // overlapping pieces, each zoomed to 1200 px wide
      const cw = w / z * 1.5, ch = h / z * 1.5;
      for (let iy = 0; iy < z; iy++) for (let ix = 0; ix < z; ix++) {
        const x = Math.max(0, Math.min(w - cw, (w - cw) * ix / Math.max(1, z - 1))), y = Math.max(0, Math.min(h - ch, (h - ch) * iy / Math.max(1, z - 1)));
        tries.push([[x, y, Math.min(cw, w), Math.min(ch, h)], 1200, false], [[x, y, Math.min(cw, w), Math.min(ch, h)], 1200, true]);
      }
    }
    for (const [crop, width, turn] of tries) { const r = decode1D(draw(img, w, h, crop, width, turn)); if (r) return r; }
    return null;
  }

  // ---------- environment checks (HTTPS, in-app browsers, iframes) ----------
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|TikTok|Snapchat|Twitter|MicroMessenger/i.test(ua);
  function blockedReason() {
    if (!window.isSecureContext) return { title: "Camera needs a secure link", text: "Open this page with https:// (not http://). Browsers only allow the camera on secure pages." };
    if (!navigator.mediaDevices?.getUserMedia) return inApp ? inAppMsg() : { title: "This browser can't use the camera", text: "Open this page in Chrome (Android, computer) or Safari (iPhone)." };
    try { if (document.permissionsPolicy && !document.permissionsPolicy.allowsFeature("camera")) return { title: "The camera is blocked inside this page", text: "This page is shown inside another app or site that doesn't allow the camera. Open it in its own browser tab." }; } catch { /* ignore */ }
    return null;
  }
  function inAppMsg() {
    return { title: "Open in your browser", text: isIOS ? "This app's built-in browser can't use the camera. Tap ••• or the share icon, then “Open in Safari”." : "This app's built-in browser can't use the camera. Tap ⋮ then “Open in Chrome”." };
  }
  function deniedMsg() {
    if (isIOS) return { title: "Camera permission is off", text: "On iPhone: tap “aA” in the address bar → Website Settings → Camera → Allow. Or Settings → Safari → Camera → Allow. Then tap Try again." };
    if (isAndroid) return { title: "Camera permission is off", text: "Tap the icon left of the address (🔒 or ⓘ) → Permissions → Camera → Allow. Then tap Try again." };
    return { title: "Camera permission is off", text: "Click the camera icon in the address bar → Allow, then tap Try again." };
  }
  function errorInfo(err) {
    const s = String(err?.name || "") + " " + String(err?.message || err || "");
    if (/NotAllowed|Permission|denied|SecurityError/i.test(s)) return inApp ? inAppMsg() : deniedMsg();
    if (/NotFound|DevicesNotFound|Overconstrained|no camera|Requested device not found/i.test(s)) return { title: "No camera found", text: "This device has no camera we can use. Use “Scan from a photo” below." };
    if (/NotReadable|TrackStart|Could not start|in use/i.test(s)) return { title: "The camera is busy", text: "Another app or tab is using the camera. Close it, then tap Try again." };
    if (/NotSupported|not supported/i.test(s)) return inApp ? inAppMsg() : { title: "This browser can't open the camera here", text: "Open the page in Chrome (Android, computer) or Safari (iPhone), or use “Scan from a photo” below." };
    if (/Abort/i.test(s)) return { title: "The camera stopped", text: "Tap Try again." };
    return { title: "Couldn't start the camera", text: "Tap Try again, or use “Scan from a photo”. (" + s.trim().slice(0, 80) + ")" };
  }
  function showStageMsg(info, retry = true) {
    const m = $("stageMsg"); m.hidden = false; m.replaceChildren();
    const box = document.createElement("div");
    const b = document.createElement("b"); b.textContent = info.title;
    const p = document.createElement("div"); p.textContent = info.text;
    box.append(b, p);
    if (retry) { const btn = document.createElement("button"); btn.className = "btn primary"; btn.type = "button"; btn.textContent = "Try again"; btn.onclick = () => startCamera(); box.append(btn); }
    m.append(box); $("stage").classList.add("off");
  }
  const hideStageMsg = () => { $("stageMsg").hidden = true; $("stage").classList.remove("off"); };

  // ---------- camera ----------
  let scanner = null, running = false, starting = false, paused = false, track = { torch: null, zoom: null, torchOn: false };
  let last = { text: "", at: 0 };

  function videoConstraints() {
    const id = $("cameraSel").value;
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } }; // enough detail for barcodes, light enough for older phones
    return id ? { ...base, deviceId: { exact: id } } : { ...base, facingMode: "environment" }; // back lens by default
  }

  async function startCamera() {
    if (starting) return;
    const block = blockedReason();
    if (block) { showStageMsg(block, false); status("Camera not available — scan from a photo instead", false); return; }
    if (!Qr) { showStageMsg({ title: "Scanner didn't load", text: "Check the connection and reload the page." }); return; }
    starting = true; hideStageMsg(); status("Starting camera…");
    try {
      await stopCamera();
      scanner = scanner || new Qr("reader", { formatsToSupport: FORMATS, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      const cfg = { fps: 12, disableFlip: false, videoConstraints: videoConstraints() }; // no box: read a code anywhere in the picture, as fast as possible
      try {
        await scanner.start({ facingMode: "environment" }, cfg, onScan, () => {});
      } catch (e) {
        // the remembered lens is gone, or the size isn't supported: fall back to any camera
        if (/Overconstrained|NotFound|NotReadable/i.test(String(e?.name || e)) || $("cameraSel").value) {
          $("cameraSel").value = ""; store.set(CAM_KEY, "");
          await scanner.start({ facingMode: "environment" }, { fps: 12 }, onScan, () => {});
        } else throw e;
      }
      running = true; paused = false;
      fitStage(); loop1D();
      status("Scanning…");
      $("pauseBtn").textContent = "⏸"; $("pauseBtn").title = "Pause camera";
      await listCameras();
      setupTrackFeatures();
    } catch (e) {
      running = false;
      showStageMsg(errorInfo(e));
      status("Camera off", false);
    } finally { starting = false; }
  }

  /** Every ~1/4 s: look for a 1D barcode in the camera picture (middle band, and every 3rd time turned sideways). */
  let loopT = 0, tick = 0;
  function loop1D() {
    clearTimeout(loopT);
    loopT = setTimeout(() => {
      if (!running) return;
      const v = document.querySelector("#reader video");
      if (!paused && !document.hidden && v?.videoWidth && reader1D) {
        const w = v.videoWidth, h = v.videoHeight, turn = ++tick % 3 === 0;
        const crop = turn ? [w * 0.2, 0, w * 0.6, h] : [0, h * 0.2, w, h * 0.6];
        const r = decode1D(draw(v, w, h, crop, Math.min(turn ? crop[2] : crop[2], 1280), turn));
        if (r) onScan(r.text, { result: { format: { formatName: r.format } } });
      }
      loop1D();
    }, 260);
  }

  /** Give the view the camera picture's own shape (no stretching), no taller than 62% of the screen. */
  function fitStage() {
    const v = document.querySelector("#reader video"), st = $("stage");
    const go = () => { if (!v?.videoWidth) return; const r = v.videoWidth / v.videoHeight; st.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`; st.style.width = `min(100%, calc(62vh * ${r.toFixed(4)}))`; };
    if (v?.videoWidth) go(); else v?.addEventListener("loadedmetadata", go, { once: true });
  }

  async function stopCamera() {
    clearTimeout(loopT);
    if (scanner && (running || scanner.isScanning)) { try { await scanner.stop(); } catch { /* already stopped */ } }
    running = false; paused = false;
    $("torchBtn").hidden = true; $("zoomRow").hidden = true; track = { torch: null, zoom: null, torchOn: false };
  }

  async function listCameras() {
    let cams = [];
    // the camera is already allowed, so the browser gives names without opening a second camera
    try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").map((d) => ({ id: d.deviceId, label: d.label })); } catch { return; }
    const sel = $("cameraSel");
    sel.replaceChildren(new Option("Back camera (auto)", ""));
    cams.forEach((c, i) => sel.append(new Option(c.label || `Camera ${i + 1}`, c.id)));
    const want = store.get(CAM_KEY, "");
    sel.value = cams.some((c) => c.id === want) ? want : "";
    sel.closest(".controls").querySelector(".sel").hidden = cams.length < 1;
  }
  function currentDeviceId() {
    try { const v = document.querySelector("#reader video"); return v?.srcObject?.getVideoTracks?.()[0]?.getSettings?.().deviceId || ""; } catch { return ""; }
  }

  function setupTrackFeatures() {
    let caps = null;
    try { caps = scanner.getRunningTrackCameraCapabilities(); } catch { return; }
    try { const t = caps.torchFeature(); if (t.isSupported()) { track.torch = t; $("torchBtn").hidden = false; $("torchBtn").setAttribute("aria-pressed", "false"); } } catch { /* no torch */ }
    try {
      const z = caps.zoomFeature();
      if (z.isSupported() && z.max() > z.min()) {
        track.zoom = z; const r = $("zoom"); r.min = z.min(); r.max = Math.min(z.max(), 8); r.step = z.step() || 0.1; r.value = z.value() || z.min(); $("zoomRow").hidden = false;
      }
    } catch { /* no zoom */ }
  }

  function onScan(text, res) {
    const now = Date.now();
    if (!text || (text === last.text && now - last.at < 4000)) return; // same code still in view
    last = { text, at: now };
    const format = fmtName(res?.result?.format?.formatName);
    const item = { text, format, at: now, src: "camera" };
    addHistory(item); beep();
    const fr = $("frame"); fr.classList.add("hit"); setTimeout(() => fr.classList.remove("hit"), 600);
    if ($("keepGoing").checked) { toast(`${format}: ${text.length > 40 ? text.slice(0, 40) + "…" : text}`); return; }
    try { scanner.pause(true); paused = true; } catch { /* ignore */ }
    status("Found it", false);
    showResult(item);
  }

  function showResult(item) {
    $("result").hidden = false;
    const b = $("resFormat"); b.textContent = item.format; b.className = "badge " + (TWO_D.has(item.format) ? "qr" : "bar");
    $("resTime").textContent = when(item.at) + (item.src === "photo" ? " · photo" : "");
    $("resText").textContent = item.text;
    const url = isUrl(item.text);
    $("openBtn").hidden = !url; $("linkWarn").hidden = !url;
    if (url) $("openBtn").href = item.text; else $("openBtn").removeAttribute("href");
    $("copyBtn").onclick = async () => toast((await copyText(item.text)) ? "Copied" : "Couldn't copy — press and hold the text");
    $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function scanAgain() {
    $("result").hidden = true; last.at = Date.now(); // the code just read is probably still in view: don't take it again right away
    if (scanner && paused) { try { scanner.resume(); paused = false; status("Scanning…"); return; } catch { /* restart below */ } }
    startCamera();
  }

  // ---------- photo / file fallback ----------
  let fileScanner = null;
  async function scanFile(file) {
    if (!file) return;
    status("Reading the photo…");
    let res = null;
    try {
      if (!document.getElementById("fileReader")) { const d = document.createElement("div"); d.id = "fileReader"; d.hidden = true; document.body.append(d); }
      fileScanner = fileScanner || new Qr("fileReader", { formatsToSupport: FORMATS, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      res = await fileScanner.scanFileV2(file, false);
    } catch {
      // try again on a smaller copy: very large phone photos sometimes fail
      try { const small = await shrink(file, 1600); if (small) res = await fileScanner.scanFileV2(small, false); } catch { res = null; }
    }
    if (!res?.decodedText) {
      try { const bmp = await createImageBitmap(file); const r = decodePhoto1D(bmp, bmp.width, bmp.height); if (r) res = { decodedText: r.text, result: { format: { formatName: r.format } } }; } catch { /* not an image */ }
    }
    if (res?.decodedText) {
      const item = { text: res.decodedText, format: fmtName(res.result?.format?.formatName), at: Date.now(), src: "photo" };
      addHistory(item); beep(); showResult(item); status("Found it in the photo", false);
      try { if (running && !paused) { scanner.pause(true); paused = true; } } catch { /* ignore */ }
    } else {
      status(running ? "Scanning…" : "Camera off", running);
      toast("No code found in the photo — take it closer, sharp and straight");
    }
  }
  async function shrink(file, max) {
    const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k >= 1) return null;
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : null;
  }

  // ---------- history ----------
  const history = () => store.get(HIST_KEY, []);
  function addHistory(item) { const h = history(); h.unshift(item); store.set(HIST_KEY, h.slice(0, 1000)); renderHistory(); }
  function renderHistory() {
    const q = $("histSearch").value.trim().toLowerCase();
    const all = history(), list = q ? all.filter((x) => (x.text + " " + x.format).toLowerCase().includes(q)) : all;
    $("histCount").textContent = all.length ? `${list.length} of ${all.length} scan(s)` : "";
    const ul = $("histList"); ul.replaceChildren();
    if (!list.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = all.length ? "No match." : "No scans yet."; ul.append(li); return; }
    for (const x of list.slice(0, 300)) {
      const li = document.createElement("li");
      const t = document.createElement("div"); t.className = "t"; t.textContent = x.text;
      const m = document.createElement("div"); m.className = "m";
      const b = document.createElement("span"); b.className = "badge " + (TWO_D.has(x.format) ? "qr" : "bar"); b.textContent = x.format;
      const tm = document.createElement("span"); tm.className = "time"; tm.textContent = when(x.at) + (x.src === "photo" ? " · photo" : "");
      m.append(b, tm);
      const a = document.createElement("div"); a.className = "a";
      const cp = document.createElement("button"); cp.type = "button"; cp.textContent = "📋"; cp.title = "Copy"; cp.setAttribute("aria-label", "Copy " + x.text.slice(0, 40));
      cp.onclick = async () => toast((await copyText(x.text)) ? "Copied" : "Couldn't copy");
      const del = document.createElement("button"); del.type = "button"; del.textContent = "✕"; del.title = "Delete"; del.setAttribute("aria-label", "Delete");
      del.onclick = () => { store.set(HIST_KEY, history().filter((y) => !(y.at === x.at && y.text === x.text))); renderHistory(); };
      a.append(cp, del); li.append(t, m, a); ul.append(li);
    }
  }
  // CSV: quotes escaped; cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas
  const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function exportCsv() {
    const h = history(); if (!h.length) return toast("Nothing to export yet");
    const rows = [["Time", "Format", "Code", "Source"], ...h.map((x) => [new Date(x.at).toISOString(), x.format, x.text, x.src || "camera"])];
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }), name = `scans-${new Date().toISOString().slice(0, 10)}.csv`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Saved " + name);
  }

  // ---------- tabs, wiring ----------
  let tab = "scan";
  function showTab(t) {
    tab = t;
    document.querySelectorAll(".tabs button").forEach((b) => (b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    $("tab-scan").hidden = t !== "scan"; $("tab-history").hidden = t !== "history";
    if (t === "history") { renderHistory(); stopCamera().then(() => status("Camera off", false)); }
    else if ($("result").hidden) startCamera(); else status("Found it", false);
  }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("againBtn").addEventListener("click", scanAgain);
  $("fileIn").addEventListener("change", (e) => { scanFile(e.target.files?.[0]); e.target.value = ""; });
  $("cameraSel").addEventListener("change", () => { store.set(CAM_KEY, $("cameraSel").value); $("result").hidden = true; startCamera(); });
  $("torchBtn").addEventListener("click", async () => {
    if (!track.torch) return;
    try { await track.torch.apply(!track.torchOn); track.torchOn = !track.torchOn; $("torchBtn").setAttribute("aria-pressed", String(track.torchOn)); }
    catch { toast("This camera's light can't be switched on here"); }
  });
  $("zoom").addEventListener("input", (e) => { try { track.zoom?.apply(Number(e.target.value)); } catch { /* ignore */ } });
  $("pauseBtn").addEventListener("click", () => {
    if (!running) return startCamera();
    if (paused) { scanAgain(); $("pauseBtn").textContent = "⏸"; }
    else { try { scanner.pause(true); paused = true; status("Paused", false); $("pauseBtn").textContent = "▶"; $("pauseBtn").title = "Resume camera"; } catch { /* ignore */ } }
  });
  $("keepGoing").checked = !!store.get(KEEP_KEY, false);
  $("keepGoing").addEventListener("change", (e) => store.set(KEEP_KEY, e.target.checked));
  $("histSearch").addEventListener("input", renderHistory);
  $("csvBtn").addEventListener("click", exportCsv);
  $("clearBtn").addEventListener("click", () => {
    if (!history().length) return;
    if (window.confirm("Delete all saved scans on this device?")) { store.set(HIST_KEY, []); renderHistory(); }
  });

  // free the camera when the app goes to the background (iPhone needs this), start again when back
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (running) stopCamera(); }
    else if (tab === "scan" && $("result").hidden && !starting) startCamera();
  });

  // offline support
  if ("serviceWorker" in navigator && window.isSecureContext) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  window.__kwscan = { startCamera, stopCamera, history, scanFile }; // for tests
  renderHistory();
  startCamera();
})();
