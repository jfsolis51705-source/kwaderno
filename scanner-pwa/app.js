/* KWADERNO Scan — live QR + barcode scanner with auto-capture (Android, iPhone/iPad, Mac/PC).
 *
 * Camera: getUserMedia, back lens, 1920×1080, continuous autofocus, torch/zoom when the camera has them.
 * Decoding, about 10 times a second, QR and 1D at the same time, no mode switch:
 *   - the phone's own BarcodeDetector when it has one (Android Chrome: very fast, gives the code's corners);
 *   - otherwise ZXing 0.21.3 ("try harder") on the scan window, the whole picture and the window turned 90°.
 * A Bluetooth/USB scanner (it types fast and presses Enter) works at the same time.
 * Opened from KWADERNO (?kw=1&return=…) the code is sent straight back. History stays on this device. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const ZX = window.ZXing;
  const HIST_KEY = "kwscan-history", CAM_KEY = "kwscan-camera", BATCH_KEY = "kwscan-batch";

  // ---------- formats ----------
  const WANT = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "data_matrix", "pdf417", "aztec"];
  const NAMES = { qr_code: "QR", QR_CODE: "QR", ean_13: "EAN-13", EAN_13: "EAN-13", ean_8: "EAN-8", EAN_8: "EAN-8", upc_a: "UPC-A", UPC_A: "UPC-A", upc_e: "UPC-E", UPC_E: "UPC-E",
    code_128: "Code 128", CODE_128: "Code 128", code_39: "Code 39", CODE_39: "Code 39", code_93: "Code 93", CODE_93: "Code 93", itf: "ITF", ITF: "ITF", codabar: "Codabar", CODABAR: "Codabar",
    data_matrix: "Data Matrix", DATA_MATRIX: "Data Matrix", pdf417: "PDF417", PDF_417: "PDF417", aztec: "Aztec", AZTEC: "Aztec", HID: "Scanner" };
  const TWO_D = new Set(["QR", "Data Matrix", "PDF417", "Aztec"]);
  const fmtName = (raw) => NAMES[raw] || String(raw || "Code").replace(/_/g, " ");

  /** EAN/UPC check digit: sum odd positions ×3 + even positions (from the right of the payload), mod 10. */
  function checkDigitOk(code) {
    if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return null;
    const d = code.split("").map(Number), last = d.pop();
    const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === last;
  }
  const GS1 = [[[480, 489], "Philippines"], [[0, 19], "USA / Canada"], [[30, 39], "USA / Canada"], [[60, 139], "USA / Canada"], [[450, 459], "Japan"], [[490, 499], "Japan"],
    [[690, 699], "China"], [[880, 880], "South Korea"], [[885, 885], "Thailand"], [[888, 888], "Singapore"], [[893, 893], "Vietnam"], [[899, 899], "Indonesia"], [[955, 955], "Malaysia"],
    [[930, 939], "Australia"], [[400, 440], "Germany"], [[500, 509], "United Kingdom"], [[300, 379], "France"], [[840, 849], "Spain"], [[800, 839], "Italy"], [[870, 879], "Netherlands"]];
  function gs1Of(code) {
    if (!/^\d+$/.test(code) || ![12, 13].includes(code.length)) return "";
    const p = Number((code.length === 12 ? "0" + code : code).slice(0, 3));
    const hit = GS1.find(([[a, b]]) => p >= a && p <= b);
    return hit ? hit[1] : "";
  }

  // ---------- small helpers ----------
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full / private */ } } };
  let toastT = 0;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200); }
  function status(msg, busy = true) { $("statusText").textContent = msg; $("status").classList.toggle("idle", !busy); }
  let actx = null;
  function beep(ok = true) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = "square"; o.frequency.value = ok ? 1760 : 220; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(actx.destination); o.start(); o.stop(t + 0.13);
    } catch { /* no audio */ }
    try { navigator.vibrate?.(ok ? 100 : [40, 60, 40]); } catch { /* no vibration */ }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { /* ignore */ } ta.remove(); return ok;
    }
  }
  const isUrl = (t) => { try { const u = new URL(t); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };
  const when = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|TikTok|Snapchat|MicroMessenger/i.test(ua);

  // ---------- opened from KWADERNO: where to send the code back ----------
  const params = new URLSearchParams(location.search);
  const RETURN = (() => {
    const r = params.get("return") || "";
    // only back to the KWADERNO app (or a local test copy) — never to any other site
    if (/^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9_-]+#scan-(sell|stock)-$/.test(r)) return r;
    if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/[^#]*#scan-(sell|stock)-$/.test(r)) return r;
    return "";
  })();
  const KW = !!RETURN, KW_MODE = (RETURN.match(/#scan-(sell|stock)-$/) || [])[1] || "";
  const opener = (() => { try { return window.opener && !window.opener.closed ? window.opener : null; } catch { return null; } })();
  function sendToKwaderno(codes) {
    if (!KW || !codes.length) return false;
    if (opener) { try { opener.postMessage({ type: "kw-scan", code: codes.join("\n"), mode: KW_MODE }, "*"); return "message"; } catch { /* fall back to the link */ } }
    location.href = RETURN + encodeURIComponent(codes.join(","));
    return "link";
  }

  // ---------- environment checks ----------
  function blockedReason() {
    if (!window.isSecureContext) return { title: "The camera needs a secure link", text: "Open this page with https:// — browsers only allow the camera on secure pages." };
    if (!navigator.mediaDevices?.getUserMedia) return inApp ? inAppMsg() : { title: "This browser can't use the camera", text: "Open this page in Chrome (Android, computer) or Safari (iPhone, iPad, Mac)." };
    try { if (document.permissionsPolicy && !document.permissionsPolicy.allowsFeature("camera")) return { title: "The camera is blocked inside this page", text: "Open the scanner in its own browser tab." }; } catch { /* ignore */ }
    return null;
  }
  function inAppMsg() { return { title: "Open in your browser", text: isIOS ? "This app's built-in browser can't use the camera. Tap ••• or Share → “Open in Safari”." : "This app's built-in browser can't use the camera. Tap ⋮ → “Open in Chrome”." }; }
  function deniedMsg() {
    if (isIOS) return { title: "Camera permission is off", text: "Tap “aA” in the address bar → Website Settings → Camera → Allow (or Settings → Safari → Camera → Allow), then Try again." };
    if (isAndroid) return { title: "Camera permission is off", text: "Tap the icon left of the address (🔒 or ⓘ) → Permissions → Camera → Allow, then Try again." };
    return { title: "Camera permission is off", text: "Click the camera icon in the address bar → Allow, then Try again." };
  }
  function errorInfo(err) {
    const s = String(err?.name || "") + " " + String(err?.message || err || "");
    if (/NotAllowed|Permission|denied|SecurityError/i.test(s)) return inApp ? inAppMsg() : deniedMsg();
    if (/NotFound|DevicesNotFound|Overconstrained|Requested device not found/i.test(s)) return { title: "No camera found", text: "This device has no camera we can use. A Bluetooth/USB scanner or typing the number still works." };
    if (/NotReadable|TrackStart|Could not start|in use/i.test(s)) return { title: "The camera is busy", text: "Another app or tab is using the camera. Close it, then tap Try again." };
    if (/NotSupported/i.test(s)) return inApp ? inAppMsg() : { title: "This browser can't open the camera here", text: "Open the page in Chrome (Android, computer) or Safari (iPhone)." };
    return { title: "Couldn't start the camera", text: "Tap Try again. (" + s.trim().slice(0, 80) + ")" };
  }
  function showStageMsg(info, retry = true) {
    const m = $("stageMsg"); m.hidden = false; m.replaceChildren();
    const box = document.createElement("div"), b = document.createElement("b"), p = document.createElement("div");
    b.textContent = info.title; p.textContent = info.text; box.append(b, p);
    if (retry) { const btn = document.createElement("button"); btn.className = "btn primary"; btn.type = "button"; btn.textContent = "Try again"; btn.onclick = () => startCamera(); box.append(btn); }
    m.append(box);
  }

  // ---------- decoders ----------
  let detector = null, reader = null;
  async function setupDecoders() {
    if ("BarcodeDetector" in window && !window.__noNativeDetector) {
      try { const sup = await window.BarcodeDetector.getSupportedFormats(); const f = WANT.filter((x) => sup.includes(x)); if (f.length) detector = new window.BarcodeDetector({ formats: f }); } catch { detector = null; }
    }
    if (ZX && !reader) {
      const B = ZX.BarcodeFormat, h = new Map();
      h.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [B.QR_CODE, B.EAN_13, B.EAN_8, B.UPC_A, B.UPC_E, B.CODE_128, B.CODE_39, B.CODE_93, B.ITF, B.CODABAR, B.DATA_MATRIX, B.PDF_417, B.AZTEC]);
      h.set(ZX.DecodeHintType.TRY_HARDER, true);
      reader = new ZX.MultiFormatReader(); reader.setHints(h);
    }
  }
  const work = document.createElement("canvas"), wg = work.getContext("2d", { willReadFrequently: true });
  /** Decode a region of the video with ZXing. Returns { text, format, points (in video pixels) } or null. */
  function zxRegion(v, sx, sy, sw, sh, turn) {
    const k = Math.min(1, 1280 / Math.max(sw, sh)), W = Math.round(sw * k), H = Math.round(sh * k);
    work.width = turn ? H : W; work.height = turn ? W : H;
    wg.setTransform(1, 0, 0, 1, 0, 0);
    if (turn) { wg.translate(H, 0); wg.rotate(Math.PI / 2); }
    wg.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
    for (const Bin of [ZX.HybridBinarizer, ZX.GlobalHistogramBinarizer]) {
      try {
        const r = reader.decode(new ZX.BinaryBitmap(new Bin(new ZX.HTMLCanvasElementLuminanceSource(work))));
        const pts = (r.getResultPoints() || []).filter(Boolean).map((p) => {
          let x = p.getX(), y = p.getY();
          if (turn) { const cx = x, cy = y; x = cy; y = H - cx; }
          return { x: x / k + sx, y: y / k + sy };
        });
        return { text: r.getText(), format: ZX.BarcodeFormat[r.getBarcodeFormat()], points: pts };
      } catch { /* not in this region */ } finally { try { reader.reset(); } catch { /* ignore */ } }
    }
    return null;
  }
  /** Where are barcode-like stripes in the picture? (from KWADERNO's photo reader) best first, boxes in video pixels. */
  function locateBarcodes(bmp) {
    const W = 400, k = W / (bmp.videoWidth || bmp.width), H = Math.max(8, Math.round((bmp.videoHeight || bmp.height) * k)), c = document.createElement("canvas"); c.width = W; c.height = H;
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
  /** Cut out a found spot with a margin, zoom so the bars span ~1000 px, and read it. */
  function zxSpot(v, cand) {
    const [x0, y0, x1, y1] = cand.box, w = x1 - x0, hh = y1 - y0, pxm = w * 0.2, pym = hh * 0.4;
    const sx = Math.max(0, x0 - pxm), sy = Math.max(0, y0 - pym), sw = Math.min(v.videoWidth - sx, w + 2 * pxm), sh = Math.min(v.videoHeight - sy, hh + 2 * pym);
    if (sw < 16 || sh < 8) return null;
    const turn = cand.dir === "h", along = turn ? sh : sw, k = Math.min(4, 1000 / along), W = Math.round(sw * k), H = Math.round(sh * k);
    if (W * H > 4e6) return null;
    work.width = turn ? H : W; work.height = turn ? W : H;
    wg.setTransform(1, 0, 0, 1, 0, 0); wg.imageSmoothingQuality = "high";
    if (turn) { wg.translate(H, 0); wg.rotate(Math.PI / 2); }
    wg.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
    for (const Bin of [ZX.HybridBinarizer, ZX.GlobalHistogramBinarizer]) {
      try {
        const r = reader.decode(new ZX.BinaryBitmap(new Bin(new ZX.HTMLCanvasElementLuminanceSource(work))));
        const pts = (r.getResultPoints() || []).filter(Boolean).map((p) => { let x = p.getX(), y = p.getY(); if (turn) { const cx = x; x = y; y = H - cx; } return { x: x / k + sx, y: y / k + sy }; });
        return { text: r.getText(), format: ZX.BarcodeFormat[r.getBarcodeFormat()], points: pts };
      } catch { /* not here */ } finally { try { reader.reset(); } catch { /* ignore */ } }
    }
    return null;
  }
  /** The scan window, in video pixels (the video fills the screen like object-fit: cover). */
  function windowInVideo(v) {
    if (grocery) { const vw = v.videoWidth, vh = v.videoHeight; return { x: vw * 0.05, y: vh * 0.12, w: vw * 0.9, h: vh * 0.76 }; } // no frame on screen: the middle of the picture
    const vr = v.getBoundingClientRect(), fr = $("frame").getBoundingClientRect();
    const sc = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight), ox = (vr.width - v.videoWidth * sc) / 2, oy = (vr.height - v.videoHeight * sc) / 2;
    const pad = 0.12; // a little outside the corners too: barcodes held close stick out
    let x = (fr.left - vr.left - ox) / sc, y = (fr.top - vr.top - oy) / sc, w = fr.width / sc, h = fr.height / sc;
    x -= w * pad; y -= h * pad; w *= 1 + 2 * pad; h *= 1 + 2 * pad;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(v.videoWidth - x, w); h = Math.min(v.videoHeight - y, h);
    return { x, y, w, h, sc, ox, oy };
  }
  const goodCode = (text, format) => {
    const t = String(text || "").trim(); if (!t) return false;
    const f = fmtName(format);
    if (["EAN-13", "EAN-8", "UPC-A"].includes(f)) return checkDigitOk(t) !== false;
    return true;
  };

  // ---------- camera ----------
  let stream = null, track = null, running = false, paused = false, starting = false, loopT = 0, tick = 0, busy = false;
  let caps = {}, torchOn = false, last = { text: "", at: 0 }, holdUntil = 0;
  const GONE_MS = 1000; // how long a code must be out of view before the same code counts again
  let lastPhase = -1; // which way of looking found the last code
  const video = $("video");

  async function startCamera() {
    if (starting) return;
    const block = blockedReason();
    if (block) { showStageMsg(block, false); status("Camera not available — a Bluetooth/USB scanner or typing still works", false); return; }
    starting = true; $("stageMsg").hidden = true; status("Starting camera…");
    try {
      stopCamera();
      await setupDecoders();
      const id = store.get(CAM_KEY, "");
      const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      try { stream = await navigator.mediaDevices.getUserMedia({ video: id ? { ...base, deviceId: { exact: id } } : { ...base, facingMode: { ideal: "environment" } }, audio: false }); }
      catch (e) { if (id && /Overconstrained|NotFound|NotReadable/i.test(String(e?.name || e))) { store.set(CAM_KEY, ""); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); } else throw e; }
      video.srcObject = stream; video.muted = true; video.setAttribute("playsinline", ""); await video.play().catch(() => {});
      track = stream.getVideoTracks()[0];
      caps = (track.getCapabilities && track.getCapabilities()) || {};
      // close-up barcodes need the lens to keep refocusing
      if ((caps.focusMode || []).includes("continuous")) { try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ } }
      setupControls();
      running = true; paused = false; $("pauseBtn").classList.remove("paused"); $("pauseBtn").setAttribute("aria-label", "Pause scanning");
      status(detector ? "Scanning… (fast reader)" : "Scanning…");
      listCameras();
      loop();
    } catch (e) {
      running = false; showStageMsg(errorInfo(e)); status("Camera off", false);
    } finally { starting = false; }
  }
  function stopCamera() {
    clearTimeout(loopT); running = false;
    if (stream) stream.getTracks().forEach((t) => t.stop()); // frees the camera (iPhone needs this)
    stream = null; track = null; torchOn = false; video.srcObject = null;
  }
  function setupControls() {
    $("torchBtn").hidden = !caps.torch; $("torchBtn").setAttribute("aria-pressed", "false");
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const z = $("zoom"); z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 10); z.step = caps.zoom.step || 0.1;
      z.value = (track.getSettings?.().zoom) || caps.zoom.min; $("zoomRow").hidden = false;
    } else $("zoomRow").hidden = true;
  }
  async function setZoom(v) {
    if (!track || !caps.zoom) return;
    const z = Math.max(caps.zoom.min, Math.min(Math.min(caps.zoom.max, 10), v)); $("zoom").value = z;
    try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* ignore */ }
  }
  async function listCameras() {
    let cams = [];
    try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"); } catch { return; }
    const sel = $("cameraSel"); sel.replaceChildren(new Option("Back camera (auto)", ""));
    cams.forEach((c, i) => sel.append(new Option(c.label || `Camera ${i + 1}`, c.deviceId)));
    sel.value = store.get(CAM_KEY, "") || "";
    $("lensBtn").hidden = cams.length < 2;
  }

  // ---------- the scanning loop: ~10 tries a second ----------
  function loop() {
    clearTimeout(loopT);
    loopT = setTimeout(async () => {
      if (!running) return;
      if (!paused && !busy && !document.hidden && video.videoWidth && Date.now() > holdUntil) {
        busy = true;
        try {
          let hit = null;
          if (detector) {
            try {
              const r = await detector.detect(video);
              const x = r.find((c) => goodCode(c.rawValue, c.format));
              if (x) hit = { text: x.rawValue, format: x.format, points: (x.cornerPoints || []).map((p) => ({ x: p.x, y: p.y })) };
            } catch { detector = null; }
          }
          if (!hit && reader) {
            const v = video, w = windowInVideo(v);
            // while a code is in view, keep looking the way that found it (so "gone" really means gone); otherwise rotate
            const tracking = lastPhase >= 0 && Date.now() - last.at < 2000, t = tracking && tick++ % 4 !== 3 ? lastPhase : tick++ % 5;
            // scan window most of the time; the window turned sideways, the whole picture, and "find the stripes and zoom in" in between
            let r = null;
            if (t === 4) { for (const c of locateBarcodes(v).slice(0, 2)) { r = zxSpot(v, c); if (r) break; } }
            else r = t === 3 ? zxRegion(v, 0, 0, v.videoWidth, v.videoHeight, false) : t === 2 ? zxRegion(v, w.x, w.y, w.w, w.h, true) : zxRegion(v, w.x, w.y, w.w, w.h, false);
            if (r && goodCode(r.text, r.format)) { hit = r; lastPhase = t; }
          }
          if (hit) found(hit, "camera");
        } finally { busy = false; }
      }
      loop();
    }, 100);
  }

  // ---------- a code was found ----------
  let batch = store.get(BATCH_KEY, false), batchCodes = [];
  function found(hit, src) {
    const text = String(hit.text).trim(), now = Date.now();
    // Counting identical items (10 cans = same barcode 10 times): the same code counts again only after it has
    // left the camera's view for a moment — a can held still is never counted twice. Scanners/typing always count.
    if (src === "camera" && text === last.text && now - last.at < GONE_MS) { last.at = now; return; }
    last = { text, at: now };
    const item = { id: now + "-" + Math.random().toString(36).slice(2, 7), value: text, format: fmtName(hit.format), source: src === "hid" ? "Bluetooth/USB scanner" : src === "typed" ? "Typed" : "Camera", timestamp: now };
    addHistory(item);
    if (grocery) {
      // a QR code needs the screen (link, text…): show the camera screen and the result
      if (TWO_D.has(item.format)) { setMode("camera", true); qrDetour = true; beep(true); holdUntil = now + 10 * 60 * 1000; status("Found it", false); setTimeout(() => (KW ? (sendToKwaderno([text]) === "message" && showResult(item, true)) : showResult(item)), 300); return; }
      batchCodes.unshift(item); groceryHit(item);
      if (KW && opener) sendToKwaderno([text]);
      return;
    }
    beep(true);
    if (hit.points?.length) drawHit(hit.points);
    const fr = $("frame"); fr.classList.add("hit"); setTimeout(() => fr.classList.remove("hit"), 700);
    if (batch) {
      batchCodes.unshift(item); renderBatch();
      if (KW && opener) sendToKwaderno([text]);
      toast(`${item.format}: ${text.length > 34 ? text.slice(0, 34) + "…" : text}`);
      return;
    }
    holdUntil = now + 10 * 60 * 1000; // hold until the person goes back to scanning
    status("Found it", false);
    setTimeout(() => {
      if (KW) { const how = sendToKwaderno([text]); if (how === "message") { showResult(item, true); toast("Sent to KWADERNO ✓"); } return; }
      showResult(item);
    }, 350);
  }
  /** Green outline around the code where the camera saw it. */
  function drawHit(points) {
    const c = $("overlay"), r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const sc = Math.max(r.width / video.videoWidth, r.height / video.videoHeight), ox = (r.width - video.videoWidth * sc) / 2, oy = (r.height - video.videoHeight * sc) / 2;
    let pts = points.map((p) => ({ x: p.x * sc + ox, y: p.y * sc + oy }));
    if (pts.length === 2) { // a 1D barcode gives the two ends of its scan line: draw a box around it
      const [a, b] = pts, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, hh = len * 0.28, ex = dx / len * len * 0.08, ey = dy / len * len * 0.08;
      pts = [{ x: a.x - ex + nx * hh, y: a.y - ey + ny * hh }, { x: b.x + ex + nx * hh, y: b.y + ey + ny * hh }, { x: b.x + ex - nx * hh, y: b.y + ey - ny * hh }, { x: a.x - ex - nx * hh, y: a.y - ey - ny * hh }];
    }
    g.strokeStyle = "#22c55e"; g.lineWidth = 4; g.fillStyle = "rgba(34,197,94,.18)"; g.lineJoin = "round";
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); g.stroke();
    setTimeout(() => g.clearRect(0, 0, r.width, r.height), 900);
  }

  // ---------- GROCERY MODE ----------
  let grocery = store.get("kwscan-mode", "grocery") !== "camera", qrDetour = false; // qrDetour: switched to the camera only for a QR code
  const names = new Map(); // code → product name (Open Food Facts), looked up once
  function lookupName(code) {
    if (names.has(code) || !/^\d{8,14}$/.test(code)) return;
    names.set(code, "");
    fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,quantity`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { const p = d && d.status === 1 ? d.product : null; if (p?.product_name) { names.set(code, p.product_name + (p.quantity ? " " + p.quantity : "")); renderHud(); if ($("popCode").textContent === code) $("popName").textContent = names.get(code); } }).catch(() => {});
  }
  function setMode(m, quiet) {
    grocery = m !== "camera"; store.set("kwscan-mode", grocery ? "grocery" : "camera");
    document.body.classList.toggle("grocery", grocery); document.body.classList.remove("peek"); $("hudPeek").setAttribute("aria-pressed", "false");
    $("modeGrocery").setAttribute("aria-selected", String(grocery)); $("modeCamera").setAttribute("aria-selected", String(!grocery));
    renderHud(); renderBatch();
    if (!quiet) toast(grocery ? "Barcode: no camera picture — point and it counts" : "QR Camera: camera picture on screen");
  }
  /** Loud two-tone chirp (louder than the normal beep). */
  function chirp() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const t = actx.currentTime;
      for (const [f, at] of [[1800, 0], [2600, 0.07]]) {
        const o = actx.createOscillator(), g = actx.createGain(); o.type = "square"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.9, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.09);
        o.connect(g).connect(actx.destination); o.start(t + at); o.stop(t + at + 0.1);
      }
    } catch { /* no audio */ }
    try { navigator.vibrate?.(120); } catch { /* no vibration */ }
  }
  /** Quick flash of the phone's flashlight on every scan (Android; iPhone doesn't let websites use it), plus a white wash on screen. */
  async function torchFlash() {
    const w = document.querySelector(".flashwash") || document.body.appendChild(Object.assign(document.createElement("div"), { className: "flashwash" }));
    w.classList.remove("on"); void w.offsetWidth; w.classList.add("on");
    if (!track || !caps.torch || torchOn) return;
    try { await track.applyConstraints({ advanced: [{ torch: true }] }); setTimeout(() => { track?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); }, 150); } catch { /* no flashlight here */ }
  }
  let popT = 0;
  function groceryHit(item) {
    chirp(); torchFlash(); lookupName(item.value);
    const total = batchCodes.length, same = batchCodes.filter((x) => x.value === item.value).length;
    const p = $("pop"); $("popName").textContent = names.get(item.value) || item.format; $("popCode").textContent = item.value;
    $("popTotal").textContent = `×${same} · ${total} item${total === 1 ? "" : "s"}`;
    p.hidden = false; p.classList.remove("show"); void p.offsetWidth; p.classList.add("show");
    clearTimeout(popT); popT = setTimeout(() => { p.hidden = true; p.classList.remove("show"); }, 900);
    renderHud(item.value);
  }
  function renderHud(fresh) {
    if (!$("hud")) return;
    // one row per product, the most recently scanned on top
    const groups = new Map(); for (const x of batchCodes) { const g = groups.get(x.value) || { value: x.value, format: x.format, n: 0 }; g.n++; groups.set(x.value, g); }
    $("hudCount").textContent = String(batchCodes.length);
    $("hudCountLbl").textContent = `TOTAL · ${groups.size} PRODUCT${groups.size === 1 ? "" : "S"}`;
    const last = batchCodes[0];
    $("hudLast").textContent = last ? `Last: ${names.get(last.value) || last.value}` : "Point the back of the phone at a barcode";
    const ul = $("hudList"); ul.replaceChildren();
    if (!groups.size) { const li = document.createElement("li"); li.className = "empty-row"; li.textContent = "No items yet — scan a barcode"; ul.append(li); }
    for (const g of groups.values()) {
      const li = document.createElement("li"), n = document.createElement("span"), c = document.createElement("span"), x = document.createElement("span");
      n.className = "n"; n.textContent = names.get(g.value) || g.format; c.className = "c"; c.textContent = g.value; x.className = "x"; x.textContent = "×" + g.n;
      if (g.value === fresh || (!fresh && last && g.value === last.value)) li.className = "fresh"; li.append(n, x, c); ul.append(li);
    }
    $("hudUndo").disabled = !batchCodes.length;
    $("hudUndo").textContent = last ? `↶ Remove last scan (${names.get(last.value) || last.value})` : "↶ Remove last scan";
    const send = $("hudSend"); send.hidden = !(KW && !opener && batchCodes.length);
    if (!send.hidden) { send.href = RETURN + encodeURIComponent(batchCodes.map((x) => x.value).reverse().join(",")); send.textContent = `Send ${batchCodes.length} to KWADERNO`; }
  }
  /** A mistake: take back the most recent scan (again and again, newest first). Also takes 1 off the KWADERNO sale. */
  function undoLast() {
    const x = batchCodes.shift(); if (!x) return;
    store.set(HIST_KEY, history().filter((y) => y.id !== x.id));
    if (KW && opener) { try { opener.postMessage({ type: "kw-unscan", code: x.value, mode: KW_MODE }, "*"); } catch { /* KWADERNO tab closed */ } }
    beep(false); renderHud(); renderBatch();
    toast(`Removed 1 × ${names.get(x.value) || x.value}`);
  }

  // ---------- result page ----------
  let offCtl = null;
  function showResult(item, sent) {
    $("result").hidden = false;
    const code = item.value, num = /^\d+$/.test(code), ck = checkDigitOk(code), gs = gs1Of(code);
    $("resFormat").textContent = item.format;
    $("resCode").textContent = code;
    $("resCheck").textContent = ck === true ? "✓ Check digit OK" + (gs ? ` · GS1 ${gs}` : "") : ck === false ? "✗ Check digit doesn't match — scan again" : gs ? `GS1 ${gs}` : "";
    $("resCheck").classList.toggle("bad", ck === false);
    $("resSource").textContent = `${item.source} · ${when(item.timestamp)}`;
    const url = isUrl(code);
    $("openBtn").hidden = !url; $("linkWarn").hidden = !url; if (url) $("openBtn").href = code;
    $("webBtn").href = "https://www.google.com/search?q=" + encodeURIComponent(code);
    $("kwBack").hidden = !KW; if (KW) $("kwBack").href = RETURN + encodeURIComponent(code);
    $("resArt").replaceChildren(); const art = eanSvg(code); if (art) $("resArt").append(art); $("resArt").hidden = !art;
    $("resImg").replaceChildren(document.createTextNode(TWO_D.has(item.format) ? "▦" : "▥"));
    $("resName").textContent = sent ? "Sent to KWADERNO ✓" : num ? "Looking up the product…" : TWO_D.has(item.format) ? "QR code" : "Code";
    $("resBrand").textContent = sent ? "Go back to the KWADERNO tab — the item is there." : "";
    $("againBtn").focus();
    // product name and photo from Open Food Facts (only the barcode number is sent)
    offCtl?.abort();
    if (num && code.length >= 8 && !sent) {
      offCtl = new AbortController(); const ctl = offCtl;
      fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,image_front_small_url,quantity`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null)).then((d) => {
          if (ctl.signal.aborted) return;
          const p = d && d.status === 1 ? d.product : null;
          $("resName").textContent = p?.product_name ? p.product_name + (p.quantity ? ` ${p.quantity}` : "") : "Product not in the public list";
          $("resBrand").textContent = p?.brands || (p ? "" : "Add it in KWADERNO with this barcode.");
          if (p?.image_front_small_url && /^https:\/\//.test(p.image_front_small_url)) { const im = new Image(); im.alt = ""; im.referrerPolicy = "no-referrer"; im.src = p.image_front_small_url; $("resImg").replaceChildren(im); }
        }).catch(() => { if (!ctl.signal.aborted) { $("resName").textContent = "Couldn't look it up (offline?)"; } });
    }
  }
  function closeResult() { if (qrDetour) { qrDetour = false; setMode("grocery", true); } $("result").hidden = true; offCtl?.abort(); holdUntil = Date.now() + 600; last.at = Date.now() + 600; /* the code just read is probably still in view */ status(running ? "Scanning…" : "Camera off", running); if (!running) startCamera(); }

  /** Draws an EAN-13 / UPC-A / EAN-8 barcode as SVG (like the code on the pack). */
  function eanSvg(code) {
    if (!/^\d+$/.test(code) || checkDigitOk(code) !== true) return null;
    const Lp = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
    const G = Lp.map((p) => p.split("").map((b) => (b === "0" ? "1" : "0")).reverse().join("")), R = Lp.map((p) => p.split("").map((b) => (b === "0" ? "1" : "0")).join(""));
    const PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
    let bits = "";
    if (code.length === 8) { bits = "101" + code.slice(0, 4).split("").map((d) => Lp[d]).join("") + "01010" + code.slice(4).split("").map((d) => R[d]).join("") + "101"; }
    else { const c = code.length === 12 ? "0" + code : code; if (c.length !== 13) return null; const par = PAR[c[0]];
      bits = "101" + c.slice(1, 7).split("").map((d, i) => (par[i] === "L" ? Lp[d] : G[d])).join("") + "01010" + c.slice(7).split("").map((d) => R[d]).join("") + "101"; }
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), W = bits.length + 18;
    svg.setAttribute("viewBox", `0 0 ${W} 60`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Barcode " + code);
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") { const r = document.createElementNS(ns, "rect"); r.setAttribute("x", 9 + i); r.setAttribute("y", 2); r.setAttribute("width", 1); r.setAttribute("height", 46); r.setAttribute("fill", "#000"); svg.append(r); }
    const t = document.createElementNS(ns, "text"); t.setAttribute("x", W / 2); t.setAttribute("y", 58); t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "8"); t.setAttribute("font-family", "monospace"); t.setAttribute("fill", "#000"); t.textContent = code; svg.append(t);
    return svg;
  }

  // ---------- Bluetooth / USB scanners (keyboard wedge) ----------
  // They type a whole code in a burst (< 50 ms between keys) and press Enter. Caught anywhere on the page,
  // so no text box has to be focused (iPhone/iPad hide the keyboard when a scanner is paired).
  const hid = { buf: "", last: 0 };
  window.addEventListener("keydown", (e) => {
    const t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) { hid.buf = ""; return; }
    const now = performance.now();
    if (e.key === "Enter") { const code = hid.buf; hid.buf = ""; if (code.length >= 4 && now - hid.last < 120) { e.preventDefault(); if (!$("result").hidden) closeResult(); found({ text: code, format: "HID" }, "hid"); } return; }
    if (e.key.length !== 1) return;
    if (now - hid.last > 60) hid.buf = ""; // a person typing is slower: start over
    hid.buf += e.key; hid.last = now;
  }, true);

  // ---------- touch: tap to focus, pinch to zoom ----------
  const stage = $("stage"); let pinch = null;
  stage.addEventListener("pointerdown", async (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const ring = $("focusRing"), r = stage.getBoundingClientRect(); ring.style.left = e.clientX - r.left + "px"; ring.style.top = e.clientY - r.top + "px";
    ring.classList.add("on"); setTimeout(() => ring.classList.remove("on"), 700);
    if (!track) return;
    try {
      const modes = caps.focusMode || [];
      const adv = {}; if (modes.includes("single-shot")) adv.focusMode = "single-shot"; else if (modes.includes("manual")) adv.focusMode = "continuous";
      if (caps.pointsOfInterest !== undefined) adv.pointsOfInterest = [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }];
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
      if (modes.includes("continuous")) setTimeout(() => track?.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}), 1500);
    } catch { /* focus not adjustable here */ }
  });
  stage.addEventListener("touchstart", (e) => { if (e.touches.length === 2 && caps.zoom) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: Number($("zoom").value) }; } }, { passive: true });
  stage.addEventListener("touchmove", (e) => { if (pinch && e.touches.length === 2) { const [a, b] = e.touches; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); setZoom(pinch.z * (d / pinch.d)); } }, { passive: true });
  stage.addEventListener("touchend", () => { pinch = null; });

  // rotating tips, like a native scanner
  const HINTS = ["Point the camera at a barcode or QR code", "Tap the code in the frame to focus", "Pinch or use the slider to zoom", "Tilt a little to avoid glare and reflections", "Hold about a hand's length away"];
  let hintI = 0; setInterval(() => { if (!document.hidden && $("result").hidden) $("hint").textContent = HINTS[++hintI % HINTS.length]; }, 3500);

  // ---------- history ----------
  const history = () => store.get(HIST_KEY, []);
  function addHistory(item) { const h = history(); h.unshift(item); store.set(HIST_KEY, h.slice(0, 1000)); }
  function renderHistory() {
    const q = $("histSearch").value.trim().toLowerCase(), all = history();
    const list = q ? all.filter((x) => (x.value + " " + x.format + " " + x.source).toLowerCase().includes(q)) : all;
    $("histCount").textContent = all.length ? `${list.length} of ${all.length} scan(s)` : "";
    const ul = $("histList"); ul.replaceChildren();
    if (!list.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = all.length ? "No match." : "No scans yet."; ul.append(li); return; }
    for (const x of list.slice(0, 300)) {
      const li = document.createElement("li"), t = document.createElement("div"), m = document.createElement("div"), a = document.createElement("div");
      t.className = "t"; t.textContent = x.value; m.className = "m";
      const b = document.createElement("span"); b.className = "badge"; b.textContent = x.format;
      const s = document.createElement("span"); s.textContent = `${x.source} · ${when(x.timestamp)}`; m.append(b, s);
      a.className = "a";
      const cp = document.createElement("button"); cp.type = "button"; cp.textContent = "⧉"; cp.setAttribute("aria-label", "Copy"); cp.onclick = async () => toast((await copyText(x.value)) ? "Copied" : "Couldn't copy");
      const del = document.createElement("button"); del.type = "button"; del.textContent = "✕"; del.setAttribute("aria-label", "Delete"); del.onclick = () => { store.set(HIST_KEY, history().filter((y) => y.id !== x.id)); renderHistory(); };
      a.append(cp, del); li.append(t, m, a); ul.append(li);
    }
  }
  const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function exportCsv() {
    const h = history(); if (!h.length) return toast("Nothing to export yet");
    const rows = [["id", "value", "format", "source", "timestamp"], ...h.map((x) => [x.id, x.value, x.format, x.source, new Date(x.timestamp).toISOString()])];
    const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"), name = `scans-${new Date().toISOString().slice(0, 10)}.csv`; a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Saved " + name);
  }

  // ---------- batch (continuous) ----------
  function renderBatch() {
    $("batch").hidden = !batch; $("batchBtn").setAttribute("aria-pressed", String(batch));
    // one line per code with how many times it was scanned (10 cans of the same product = ×10)
    const groups = new Map(); for (const x of batchCodes) { const g = groups.get(x.value) || { value: x.value, format: x.format, n: 0 }; g.n++; groups.set(x.value, g); }
    $("batchCount").textContent = `${batchCodes.length} scanned · ${groups.size} product(s)` + (KW && opener ? " · sent to KWADERNO" : "");
    $("batchSend").hidden = !(KW && !opener && batchCodes.length);
    const ul = $("batchList"); ul.replaceChildren();
    for (const g of [...groups.values()].slice(0, 50)) {
      const li = document.createElement("li"), a = document.createElement("span"), b = document.createElement("b"), f = document.createElement("span");
      a.textContent = g.value + " "; f.className = "badge"; f.textContent = g.format; a.append(f); b.className = "num"; b.textContent = "×" + g.n; li.append(a, b); ul.append(li);
    }
  }

  // ---------- wiring ----------
  $("againBtn").onclick = closeResult; $("resBack").onclick = closeResult;
  $("copyBtn").onclick = async () => toast((await copyText($("resCode").textContent)) ? "Copied" : "Couldn't copy — press and hold the number");
  $("histBtn").onclick = () => { $("history").hidden = false; renderHistory(); };
  $("histBack").onclick = () => { $("history").hidden = true; };
  $("histSearch").oninput = renderHistory; $("csvBtn").onclick = exportCsv;
  $("clearBtn").onclick = () => { if (history().length && window.confirm("Delete all saved scans on this device?")) { store.set(HIST_KEY, []); renderHistory(); } };
  $("torchBtn").onclick = async () => { if (!track) return; try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); torchOn = !torchOn; $("torchBtn").setAttribute("aria-pressed", String(torchOn)); } catch { toast("The light can't be switched on here"); } };
  $("lensBtn").onclick = () => { const sel = $("cameraSel"), opts = [...sel.options].map((o) => o.value); const next = opts[(opts.indexOf(sel.value) + 1) % opts.length]; store.set(CAM_KEY, next); sel.value = next; const o = sel.selectedOptions[0]; toast(o ? o.text : "Camera"); startCamera(); };
  $("cameraSel").onchange = () => { store.set(CAM_KEY, $("cameraSel").value); startCamera(); };
  $("zoom").oninput = (e) => setZoom(Number(e.target.value));
  $("zoomIn").onclick = () => setZoom(Number($("zoom").value) + Math.max(0.2, (caps.zoom?.max - caps.zoom?.min) / 10 || 0.5));
  $("zoomOut").onclick = () => setZoom(Number($("zoom").value) - Math.max(0.2, (caps.zoom?.max - caps.zoom?.min) / 10 || 0.5));
  $("pauseBtn").onclick = () => {
    if (!running) return startCamera();
    paused = !paused; $("pauseBtn").classList.toggle("paused", paused);
    $("pauseBtn").setAttribute("aria-label", paused ? "Resume scanning" : "Pause scanning"); $("pauseBtn").firstElementChild.textContent = paused ? "▶" : "▮▮";
    if (paused) video.pause(); else video.play().catch(() => {});
    document.body.classList.toggle("paused", paused);
    status(paused ? "Paused — tap ▶ to scan" : "Scanning…", !paused);
  };
  $("batchBtn").onclick = () => { batch = !batch; store.set(BATCH_KEY, batch); renderBatch(); toast(batch ? "Batch: keeps scanning, one after another" : "Single: stops at each code"); };
  $("batchDone").onclick = () => { batch = false; store.set(BATCH_KEY, false); renderBatch(); };
  $("batchSend").onclick = () => sendToKwaderno(batchCodes.map((x) => x.value).reverse());
  $("typeBtn").onclick = () => { $("typeIn").value = ""; $("typeWarn").textContent = ""; $("typeDlg").showModal(); setTimeout(() => $("typeIn").focus(), 50); };
  $("typeForm").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "ok") return;
    const v = $("typeIn").value.replace(/\s+/g, "");
    if (!v) { e.preventDefault(); return; }
    if (checkDigitOk(v) === false || (/^\d+$/.test(v) && v.length >= 9 && v.length <= 11)) { e.preventDefault(); beep(false); $("typeWarn").textContent = v.length >= 9 && v.length <= 11 ? `Only ${v.length} digits — product barcodes have 8, 12 or 13.` : "The last digit (check digit) doesn't match — check the number."; return; }
    setTimeout(() => found({ text: v, format: /^\d{13}$/.test(v) ? "EAN_13" : /^\d{12}$/.test(v) ? "UPC_A" : /^\d{8}$/.test(v) ? "EAN_8" : "Typed" }, "typed"), 0);
  });
  if (KW) { $("kwBadge").hidden = false; document.title = "Scan → KWADERNO"; }

  // free the camera in the background, start again when back
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); else if ($("result").hidden && !starting) startCamera(); });
  window.addEventListener("pagehide", stopCamera);
  if ("serviceWorker" in navigator && window.isSecureContext) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  $("modeGrocery").onclick = () => setMode("grocery");
  $("modeCamera").onclick = () => setMode("camera");
  $("hudPeek").onclick = () => { const on = !document.body.classList.contains("peek"); document.body.classList.toggle("peek", on); $("hudPeek").setAttribute("aria-pressed", String(on)); $("hudPeek").textContent = on ? "👁 Hide camera" : "👁 Show camera"; };
  $("hudUndo").onclick = undoLast;
  $("hudClear").onclick = () => { if (!batchCodes.length) return; batchCodes = []; renderHud(); renderBatch(); toast("New count"); };
  setMode(grocery ? "grocery" : "camera", true);

  window.__kwscan = { history, startCamera, stopCamera, found, get detector() { return !!detector; } }; // for tests
  renderBatch();
  startCamera();
})();
