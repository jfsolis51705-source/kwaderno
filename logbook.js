/* KWADERNO Scan — Logbook: photo of a handwritten page (logbook, notebook, receipt) → sales or stock-in.
 *
 * Works offline after the first use: the handwriting reader (Tesseract 5, ~7 MB) is bundled with this app and kept
 * on the phone. Nothing is sent to any AI or server. Steps:
 *   1. capture the page (live camera, or a photo from the gallery)
 *   2. clean it: straighten (deskew), remove notebook ruled lines, local-contrast black & white + a gray copy
 *   3. read it twice (black & white, gray) and keep the reading that matches more of the store's products
 *   4. each line → qty · product · amount, matched with KWADERNO's own rules (store products, Filipino spellings,
 *      learned corrections, qty from amount ÷ price), checked against the page's written total
 *   5. review → send to KWADERNO (straight away when it's open, otherwise kept and sent later)
 * The store's product list comes from KWADERNO (kept on this phone) so matching also works offline. */
(() => {
  "use strict";
  const api = window.__kwscanApi; if (!api) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "text") e.textContent = v; else if (k.startsWith("on")) e[k] = v; else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };
  const store = api.store, toast = api.toast;
  const CAT_KEY = "kwscan-catalog", PEND_KEY = "kwscan-logbook-pending";
  const APP_BASE = (api.RETURN && api.RETURN.split("#")[0]) || "https://claude.ai/artifact/8JVsaCApj6gs8P2kSzpASY";
  const peso = (n) => "₱" + (Number(n) || 0).toFixed(2);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // ---------- the store's products (from KWADERNO, kept on this phone) ----------
  let catalog = store.get(CAT_KEY, null); // { products:[{id,name,price,cost,sold}], learned:[{raw,to}], dict:[{from,to}], at }
  const opener = api.opener;
  if (opener) {
    try { opener.postMessage({ type: "kw-hello" }, "*"); } catch { /* KWADERNO closed */ }
    window.addEventListener("message", (e) => {
      if (e.source !== opener || !e.data || e.data.type !== "kw-catalog" || !Array.isArray(e.data.products)) return;
      catalog = { products: e.data.products.slice(0, 5000).map((p) => ({ id: String(p.id), name: String(p.name || "").slice(0, 120), price: Number(p.price) || 0, cost: Number(p.cost) || 0, sold: Number(p.sold) || 0 })),
        learned: (e.data.learned || []).slice(-300), dict: (e.data.dict || []).slice(0, 500), at: Date.now() };
      store.set(CAT_KEY, catalog); renderCam();
    });
  }
  const products = () => catalog?.products || [];

  // ---------- matching rules (same as KWADERNO's logbook reader) ----------
  const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
  const SEED = [["coke", "coca cola"], ["koke", "coca cola"], ["cocacola", "coca cola"], ["sprite", "sprite"], ["royal", "royal"], ["pepsi", "pepsi"],
    ["pancit", "pancit canton"], ["canton", "pancit canton"], ["luckyme", "lucky me"], ["nudols", "noodles"], ["nudels", "noodles"], ["sardinas", "sardines"], ["sardin", "sardines"],
    ["itlog", "egg"], ["eggs", "egg"], ["kape", "coffee"], ["asukal", "sugar"], ["bigas", "rice"], ["mantika", "cooking oil"], ["toyo", "soy sauce"], ["suka", "vinegar"],
    ["patis", "fish sauce"], ["asin", "salt"], ["sabon", "soap"], ["shampo", "shampoo"], ["yosi", "cigarettes"], ["sigarilyo", "cigarettes"], ["yelo", "ice"],
    ["tinapay", "bread"], ["gatas", "milk"], ["kandila", "candle"], ["posporo", "matches"], ["sopdrinks", "softdrinks"], ["dtrgent", "detergent"], ["detirgent", "detergent"]];
  const IGNORE = new Set(["pcs", "pc", "piraso", "x", "php", "p", "pesos", "peso", "each", "bawat", "ea", "at"]);
  const SKIP = new Set(["total", "kabuuan", "date", "petsa", "benta", "sales", "stock", "in", "page", "pahina", "sub", "subtotal"]);
  const TOTAL_WORDS = /\b(total|kabuuan|tot|sum|lahat)\b/i;
  const DATE_WORDS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec|enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre|lunes|martes|miyerkules|huwebes|biyernes|sabado|linggo)[a-z]*\b|\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/i;
  const DIGITISH = { o: "0", d: "0", q: "9", l: "1", i: "1", "|": "1", "!": "1", z: "2", s: "5", b: "8", g: "9", t: "7" };
  const dictAll = () => { const m = new Map(SEED.map(([f, t]) => [f, t])); for (const e of catalog?.dict || []) if (e.from && e.to) m.set(fold(e.from), fold(e.to)); return m; };
  function asNumber(tok) {
    let t = String(tok).replace(/^(₱|php|p)(?=[\dOoIl|])/i, "").replace(/^[x@×]+|[x×]+$/gi, "").replace(/[.,\-]+$/, "");
    if (!t) return null;
    const digits = (t.match(/\d/g) || []).length;
    if (!digits || digits / t.length < 0.5 || t.length > 8) return null;
    t = t.replace(/[A-Za-z|!]/g, (c) => DIGITISH[c.toLowerCase()] ?? c);
    return /^\d+([.,]\d{1,2})?$/.test(t) ? Number(t.replace(",", ".")) : null;
  }
  const bigrams = (x) => { const t = x.replace(/\s+/g, ""), out = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
  function dice(a, b) { const A = bigrams(a), B = bigrams(b); let n = 0, ta = 0, tb = 0; for (const v of A.values()) ta += v; for (const v of B.values()) tb += v; for (const [g, v] of A) n += Math.min(v, B.get(g) || 0); return ta + tb ? (2 * n) / (ta + tb) : 0; }
  function normalize(text) {
    const dict = dictAll(); let t = " " + fold(text) + " ";
    for (const [f, to] of dict) if (f.includes(" ") && t.includes(" " + f + " ")) t = t.replace(" " + f + " ", " " + to + " ");
    const keys = [...dict.keys()].filter((k) => !k.includes(" ") && k.length >= 4), out = [];
    for (const w of t.trim().split(" ").filter(Boolean)) {
      if (IGNORE.has(w)) continue;
      if (dict.has(w)) { out.push(dict.get(w)); continue; }
      const near = w.length >= 4 ? keys.find((k) => Math.abs(k.length - w.length) <= 1 && lev(k, w) <= 1) : null;
      out.push(near ? dict.get(near) : w);
    }
    return out.join(" ");
  }
  const close = (t, w) => t === w || (w.length >= 4 && t.length >= 4 && lev(t, w) <= (w.length >= 7 ? 2 : 1));
  function match(rawName) {
    const key = fold(rawName), learned = [...(catalog?.learned || [])].reverse().find((x) => x.raw === key);
    if (learned) { const p = products().find((x) => fold(x.name) === fold(learned.to)); if (p) return { p, score: 1, learned: true }; }
    const n = normalize(rawName); if (!/[a-z]/.test(n)) return { p: null, score: 0 };
    const qt = n.split(" "); let best = null;
    for (const p of products()) {
      const pn = fold(p.name), pt = pn.split(" ").filter((w) => w.length >= 2); if (!pt.length) continue;
      const m = pt.filter((w) => qt.some((t) => close(t, w))).length, prec = qt.filter((t) => pt.some((w) => close(t, w))).length / qt.length, rec = m / pt.length;
      const score = Math.max(m ? (2 * rec * prec) / (rec + prec) : 0, dice(n, pn) * 0.9);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && p.sold > best.p.sold)) best = { p, score };
    }
    return best && best.score >= 0.4 ? { p: best.p, score: best.score } : { p: null, score: best?.score || 0 };
  }
  function parseLine(text, conf) {
    const raw = String(text || "").trim();
    const toks = raw.replace(/^[^A-Za-z0-9₱]+/, "").replace(/[,;:=]/g, " ").replace(/^(\d{1,2})([A-Za-z]{2,})/, "$1 $2").replace(/([A-Za-z]{3,})(\d+)\b/g, "$1 $2").split(/\s+/).filter(Boolean);
    const brands = new Set(products().flatMap((p) => fold(p.name).split(" ").filter((w) => /^\d+$/.test(w))));
    const nums = [], words = [];
    toks.forEach((t, i) => { const n = asNumber(t); const brand = n != null && brands.has(fold(t)) && i + 1 < toks.length && asNumber(toks[i + 1]) == null; if (n != null && !brand) nums.push({ n, i }); else words.push(t); });
    const name = words.join(" ");
    let qty = null, amount = null;
    if (nums.length >= 2) { const a = nums[0].n; if (Number.isInteger(a) && a > 0 && a < 100) qty = a; amount = nums[nums.length - 1].n; }
    else if (nums.length === 1) { const a = nums[0].n; if (nums[0].i === 0 && Number.isInteger(a) && a > 0 && a < 100) qty = a; else amount = a; }
    const looksTotal = TOTAL_WORDS.test(raw) || words.some((w) => { const f = fold(w); return f.length >= 3 && (lev(f, "total") <= 1 || lev(f, "kabuuan") <= 2); });
    const isTotal = looksTotal && amount != null;
    const isDate = DATE_WORDS.test(raw) && words.length <= 3;
    const header = isTotal || isDate || looksTotal || !toks.length || !/[a-z]/i.test(name) || toks.every((t) => SKIP.has(fold(t)) || asNumber(t) != null);
    const m = header ? { p: null, score: 0 } : match(name);
    let note = null; const price = m.p ? m.p.price / 100 : null;
    // the amount ÷ the product's price tells the qty: fills a missing qty, fixes a misread one ("1" read as "7"),
    // and a slightly misread amount (87 for 3 × ₱28 = 84) is not flagged
    if (m.p && amount != null && price) {
      const r = amount / price, n = Math.round(r);
      // only digits that handwriting readers mix up are corrected (1↔7, 2↔7, 3↔8, 4↔9, 5↔6, 6↔8); anything else is just flagged
      const LOOKALIKE = new Set(["1-7", "7-1", "2-7", "7-2", "3-8", "8-3", "4-9", "9-4", "5-6", "6-5", "6-8", "8-6", "1-4", "4-1"]);
      if (n >= 1 && n < 100 && Math.abs(r - n) < 0.12) { if (qty == null) { qty = n; note = "fromAmount"; } else if (qty !== n) { if (LOOKALIKE.has(qty + "-" + n)) { qty = n; note = "qtyFixed"; } else note = "mismatch"; } }
      else if (qty != null && Math.abs(qty * price - amount) > Math.max(1, amount * 0.1)) note = "mismatch";
    }
    return { raw, name, conf: Math.round(conf ?? 0), qty: qty ?? 1, amount, auto: m.p?.id || "", pid: m.p?.id || "", score: m.score, learned: !!m.learned, note, header, isTotal };
  }

  // ---------- photo cleanup ----------
  function toGray(img, maxSide) {
    const k = Math.min(2, maxSide / Math.max(img.width, img.height)), W = Math.round(img.width * k), H = Math.round(img.height * k);
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return { g, W, H, c };
  }
  /** Bradley local threshold: ink → 1, paper → 0 (shadows and uneven light don't matter). */
  function inkMap(g, W, H, rFrac = 1 / 50, T = 0.15) {
    const I = new Float64Array((W + 1) * (H + 1)), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    const r = Math.max(6, Math.round(Math.max(W, H) * rFrac));
    for (let y = 0; y < H; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r), area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        out[y * W + x] = g[y * W + x] * area < sum * (1 - T) ? 1 : 0; } }
    return out;
  }
  /** How tilted is the writing? Try −8°…8° and keep the angle where ink lines up in rows (sharpest row profile). */
  function skewAngle(ink, W, H) {
    const pts = []; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (ink[y * W + x]) pts.push(x - W / 2, y - H / 2);
    if (pts.length < 200) return 0;
    let best = 0, bestV = -1;
    for (let a = -8; a <= 8.001; a += 0.5) {
      const r = (a * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r), bins = new Float32Array(H * 2 + 10);
      for (let i = 0; i < pts.length; i += 2) { const y = Math.round(-pts[i] * s + pts[i + 1] * c + H); if (y >= 0 && y < bins.length) bins[y]++; }
      let v = 0; for (let i = 1; i < bins.length; i++) { const d = bins[i] - bins[i - 1]; v += d * d; }
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }
  function rotate(img, deg) {
    if (!deg) return img;
    const r = (deg * Math.PI) / 180, W = img.width, H = img.height, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.translate(W / 2, H / 2); x.rotate(-r); x.drawImage(img, -W / 2, -H / 2); return c;
  }
  /** Black & white copy with notebook ruled lines and margin lines removed, plus a contrast-stretched gray copy. */
  function cleanPage(img) {
    // 1) straighten
    const small = toGray(img, 700), angle = skewAngle(inkMap(small.g, small.W, small.H), small.W, small.H);
    const straight = rotate(img, angle);
    const { g, W, H } = toGray(straight, 2000);
    // 2) ink map, then drop long thin horizontal / vertical lines (printed rules), keep handwriting
    const ink = inkMap(g, W, H);
    for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) n += ink[y * W + x]; if (n > W * 0.45) for (let x = 0; x < W; x++) { const up = y > 2 && ink[(y - 3) * W + x], dn = y < H - 3 && ink[(y + 3) * W + x]; if (!(up && dn)) ink[y * W + x] = 0; } }
    for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) n += ink[y * W + x]; if (n > H * 0.6) for (let y = 0; y < H; y++) { const l = x > 2 && ink[y * W + x - 3], r = x < W - 3 && ink[y * W + x + 3]; if (!(l && r)) ink[y * W + x] = 0; } }
    const bw = document.createElement("canvas"); bw.width = W; bw.height = H; const bx = bw.getContext("2d"), bim = bx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = ink[i] ? 0 : 255; bim.data[i * 4] = bim.data[i * 4 + 1] = bim.data[i * 4 + 2] = v; bim.data[i * 4 + 3] = 255; } bx.putImageData(bim, 0, 0);
    // 3) gray copy with stretched contrast (keeps thin pen strokes that black & white can break)
    const sorted = Float32Array.from(g).sort(), lo = sorted[Math.floor(g.length * 0.02)], hi = sorted[Math.floor(g.length * 0.98)], span = Math.max(1, hi - lo);
    const gr = document.createElement("canvas"); gr.width = W; gr.height = H; const gx = gr.getContext("2d"), gim = gx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = Math.max(0, Math.min(255, ((g[i] - lo) / span) * 255)); gim.data[i * 4] = gim.data[i * 4 + 1] = gim.data[i * 4 + 2] = v; gim.data[i * 4 + 3] = 255; } gx.putImageData(gim, 0, 0);
    return { bw, gray: gr, angle };
  }

  // ---------- the handwriting reader (bundled, offline after first use) ----------
  const VENDOR = new URL("vendor/tesseract/", location.href).href;
  const READER_FILES = ["tesseract.min.js", "worker.min.js", "core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js", "lang/eng.traineddata.gz"].map((f) => VENDOR + f);
  let workerP = null, progress = { status: "", p: 0 };
  const loadScript = (src) => new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load")); document.head.append(s); });
  function reader() {
    return (workerP ??= (async () => {
      await loadScript(VENDOR + "tesseract.min.js");
      const w = await window.Tesseract.createWorker("eng", 1, { workerPath: VENDOR + "worker.min.js", corePath: VENDOR + "core", langPath: VENDOR + "lang", gzip: true,
        logger: (m) => { progress = { status: m.status || "", p: m.progress || 0 }; showProgress(); } });
      await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
      store.set("kwscan-reader-ready", true); renderCam();
      return w;
    })().catch((e) => { workerP = null; throw e; }));
  }
  /** Keep the reader's files on this phone so the Logbook works without internet next time. */
  async function keepOffline() {
    if (!("caches" in window)) return;
    try { const c = await caches.open("kwscan-reader-v1"); /* kept across app updates (see sw.js) */ for (const u of READER_FILES) if (!(await c.match(u))) await c.add(u); store.set("kwscan-reader-offline", true); renderCam(); } catch { /* offline now: try again next time */ }
  }

  // ---------- UI ----------
  const camUi = el("div", { class: "lb-cam", id: "lbCam", hidden: true },
    el("div", { class: "lb-frame", "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i")),
    el("p", { class: "lb-tip", id: "lbTip", text: "Fit the whole page in the frame · good light · hold steady" }),
    el("div", { class: "lb-ctl" },
      el("label", { class: "lb-side", role: "button", tabindex: "0" }, el("input", { type: "file", accept: "image/*", id: "lbFile", hidden: true }), el("span", { "aria-hidden": "true", text: "🖼" }), "Gallery"),
      el("button", { type: "button", class: "lb-shot", id: "lbShot", "aria-label": "Take the photo of the page" }),
      el("button", { type: "button", class: "lb-side", id: "lbPendBtn" }, el("span", { "aria-hidden": "true", text: "⇪" }), el("span", { id: "lbPendTxt", text: "Waiting" }))),
    el("div", { class: "lb-state", id: "lbState" }));
  $("scan").append(camUi);
  const sheet = el("section", { id: "lbSheet", class: "sheet", hidden: true, "aria-labelledby": "lbTitle" });
  document.body.append(sheet);

  function renderCam() {
    if (!$("lbState")) return;
    const n = products().length, pend = store.get(PEND_KEY, []);
    $("lbState").textContent = [store.get("kwscan-reader-offline", false) ? "✓ Reader saved on this phone (works offline)" : "Reader: downloads once (~7 MB), then works offline",
      n ? `✓ ${n} of your products known` : "Open the scanner from KWADERNO once so it knows your products"].join(" · ");
    $("lbPendBtn").hidden = !pend.length; $("lbPendTxt").textContent = `${pend.length} waiting`;
  }
  function showProgress() { const s = $("lbProg"); if (s) s.textContent = progress.status === "recognizing text" ? `Reading the writing… ${Math.round(progress.p * 100)}%` : progress.status ? `Getting the reader ready (first time only)… ${Math.round(progress.p * 100)}%` : ""; }
  window.__kwLogbook = { shown(on) { camUi.hidden = !on; if (on) { renderCam(); keepOffline(); } } };
  if (document.body.classList.contains("logbook")) window.__kwLogbook.shown(true);

  async function grabPhoto() {
    const v = api.video, t = api.track;
    // full camera resolution when the phone allows it (sharper handwriting), else the current video frame
    try { if (t && "ImageCapture" in window) { const blob = await new window.ImageCapture(t).takePhoto(); return await createImageBitmap(blob); } } catch { /* fall back */ }
    if (!v?.videoWidth) throw new Error("camera");
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0); return c;
  }
  $("lbShot").onclick = async () => { try { api.chirp(); const img = await grabPhoto(); readPage(img); } catch { toast("The camera isn't ready — try again, or use Gallery"); } };
  $("lbFile").onchange = async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { readPage(await createImageBitmap(f)); } catch { toast("That photo couldn't be opened"); } };
  $("lbPendBtn").onclick = showPending;

  let page = null; // { rows, mode, date, preview, total, angle }
  async function readPage(img) {
    page = { rows: [], mode: new URLSearchParams(location.search).get("lbmode") === "stockin" ? "stock" : "sale", /* the choice made on KWADERNO's Logbook page */ date: today(), preview: "", total: null, angle: 0 };
    const pv = document.createElement("canvas"), k = Math.min(1, 900 / Math.max(img.width, img.height)); pv.width = Math.round(img.width * k); pv.height = Math.round(img.height * k); pv.getContext("2d").drawImage(img, 0, 0, pv.width, pv.height); page.preview = pv.toDataURL("image/jpeg", 0.7);
    sheet.hidden = false;
    sheet.replaceChildren(el("header", { class: "bar" }, el("button", { class: "icon", type: "button", "aria-label": "Back", onclick: () => { sheet.hidden = true; }, text: "←" }), el("b", { id: "lbTitle", text: "Reading the page" }), el("span")),
      el("div", { class: "sheet-body" }, el("img", { src: page.preview, alt: "", class: "lb-prev" }), el("div", { class: "status" }, el("span", { class: "spin", "aria-hidden": "true" }), el("span", { id: "lbProg", text: "Cleaning the photo…" }))));
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { bw, gray, angle } = cleanPage(img); page.angle = angle;
      const w = await reader();
      // read the page three ways, then merge line by line (by position): each line keeps its best reading,
      // so a line one reading misses is taken from another
      const readAs = async (cv, psm) => {
        await w.setParameters({ tessedit_pageseg_mode: psm });
        const { data } = await w.recognize(cv, {}, { text: true, blocks: true });
        const lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((pg) => pg.lines || [])).filter((l) => String(l.text).trim());
        const sc = 1000 / cv.height; // same scale for every reading (all copies are the same size)
        return lines.map((l) => ({ ...parseLine(l.text, l.confidence), y: ((l.bbox.y0 + l.bbox.y1) / 2) * sc, h: (l.bbox.y1 - l.bbox.y0) * sc }));
      };
      const all = [...await readAs(bw, "6"), ...await readAs(gray, "6"), ...await readAs(gray, "4")].sort((a, b) => a.y - b.y);
      const hMed = all.map((r) => r.h).sort((a, b) => a - b)[Math.floor(all.length / 2)] || 30;
      const groups = []; for (const r of all) { const g = groups.at(-1); if (g && Math.abs(r.y - g.y) < hMed * 0.55) { g.rows.push(r); g.y = (g.y * (g.rows.length - 1) + r.y) / g.rows.length; } else groups.push({ y: r.y, rows: [r] }); }
      const rank = (r) => (r.pid ? 2 + r.score : 0) + (r.amount != null ? 0.3 : 0) + (r.note === "mismatch" ? -0.5 : 0) + r.conf / 200;
      const best = groups.map((g) => { const items = g.rows.filter((r) => !r.header); const pool = items.length >= g.rows.length / 2 ? items : g.rows; return pool.sort((a, b) => rank(b) - rank(a))[0]; });
      page.total = best.filter((r) => r.isTotal).map((r) => r.amount).pop() ?? null;
      // smudges and stray marks: unmatched lines with under 4 letters, or unclear (low confidence) — dropped
      page.rows = best.filter((r) => !r.header && (r.pid || ((r.name.match(/[a-z]/gi) || []).length >= 4 && r.conf >= 45)));
    } catch (e) {
      page.rows = []; page.error = e?.message === "load" ? "The reader couldn't load. Connect to the internet once, then it works offline." : "The page couldn't be read. Type the lines below while looking at the photo.";
    }
    if (!page.rows.length) page.rows.push({ raw: "", name: "", qty: 1, amount: null, pid: "", auto: "", score: 0 });
    api.beep(true); review();
  }

  function review() {
    const ps = [...products()].sort((a, b) => a.name.localeCompare(b.name));
    const body = el("div", { class: "sheet-body lb-review" });
    const sumRows = () => page.rows.filter((r) => !r.skip && r.pid).reduce((a, r) => { const p = ps.find((x) => x.id === r.pid); return a + (r.amount != null ? Number(r.amount) : p ? (Number(r.qty) || 0) * p.price / 100 : 0); }, 0);
    const draw = () => {
      const ok = page.rows.filter((r) => !r.skip && r.pid && Number(r.qty) > 0).length, open = page.rows.filter((r) => !r.skip && !r.pid).length;
      const sum = sumRows(), totalNote = page.total != null ? (Math.abs(sum - page.total) <= 1 ? `✓ Lines add up to the page total ${peso(page.total)}` : `⚠ Lines add up to ${peso(sum)} but the page total says ${peso(page.total)} — check a line`) : "";
      body.replaceChildren(...[
        el("div", { class: "lb-top" }, el("img", { src: page.preview, alt: "Photo of the page", class: "lb-thumb" }),
          el("div", { class: "lb-opts" },
            el("div", { class: "seg", role: "radiogroup", "aria-label": "Save as" },
              el("button", { type: "button", role: "radio", "aria-checked": String(page.mode === "sale"), onclick: () => { page.mode = "sale"; draw(); } }, "Sales"),
              el("button", { type: "button", role: "radio", "aria-checked": String(page.mode === "stock"), onclick: () => { page.mode = "stock"; draw(); } }, "Stock-in")),
            el("label", { class: "small" }, "Date ", el("input", { type: "date", id: "lbDate", value: page.date, max: today(), onchange: (e) => { page.date = e.target.value || today(); } })))),
        page.error ? el("p", { class: "warn", text: page.error }) : null,
        totalNote ? el("p", { class: totalNote.startsWith("✓") ? "lb-ok" : "warn", id: "lbTotal", text: totalNote }) : null,
        el("p", { class: "muted small", style: "margin:0", text: `${ok} line(s) ready${open ? ` · ${open} need a product (or tap ✕ to skip)` : ""}. Fix anything that's wrong — KWADERNO learns from your fixes.` }),
        el("ul", { class: "lb-rows", id: "lbRows" }, page.rows.map((r, i) => {
          const st = r.skip ? "skip" : !r.pid ? "open" : r.note === "mismatch" || r.note === "qtyFixed" ? "warn" : r.pid !== r.auto ? "fixed" : r.score >= 0.75 || r.learned ? "good" : "check";
          return el("li", { class: "lb-row " + st },
            r.raw ? el("div", { class: "lb-raw", text: `“${r.raw}”` }) : null,
            el("div", { class: "lb-line" },
              el("input", { type: "number", inputmode: "decimal", min: "0", step: "any", class: "lb-qty", "aria-label": "Quantity", value: r.qty ?? 1, oninput: (e) => { r.qty = e.target.value; } }),
              ps.length ? el("select", { class: "lb-prod", "aria-label": "Product", onchange: (e) => { r.pid = e.target.value; r.skip = false; draw(); } },
                el("option", { value: "", text: r.name ? `? ${r.name}` : "Choose the product…" }), ps.map((p) => el("option", { value: p.id, text: p.name, selected: p.id === r.pid })))
                : el("input", { type: "text", class: "lb-prod", "aria-label": "Product name", value: r.name || "", placeholder: "Product name", oninput: (e) => { r.name = e.target.value; r.pid = ""; } }),
              el("input", { type: "number", inputmode: "decimal", min: "0", step: "any", class: "lb-amt", "aria-label": "Amount in pesos", placeholder: "₱", value: r.amount ?? "", oninput: (e) => { r.amount = e.target.value === "" ? null : Number(e.target.value); } }),
              el("button", { type: "button", class: "lb-x", "aria-label": r.skip ? "Use this line" : "Skip this line", onclick: () => { r.skip = !r.skip; draw(); }, text: r.skip ? "↺" : "✕" })),
            r.note === "mismatch" ? el("div", { class: "small warn", text: "Qty × price doesn't match the amount — check it" }) : r.note === "fromAmount" ? el("div", { class: "small muted", text: "Qty worked out from amount ÷ price" })
              : r.note === "qtyFixed" ? el("div", { class: "small warn", text: "Qty corrected from amount ÷ price — check it" }) : null);
        })),
        el("button", { type: "button", class: "btn", onclick: () => { page.rows.push({ raw: "", name: "", qty: 1, amount: null, pid: "", auto: "", score: 0 }); draw(); } }, "+ Add a line"),
        el("button", { type: "button", class: "btn primary big", id: "lbSend", disabled: !ok || (!ps.length && !page.rows.some((r) => r.name)), onclick: send }, `Send ${ok || ""} line(s) to KWADERNO as ${page.mode === "sale" ? "sales" : "stock-in"}`.replace("  ", " ")),
        el("button", { type: "button", class: "btn", onclick: () => { sheet.hidden = true; } }, "Retake the photo")].filter(Boolean));
      if (!ps.length) { const b = body.querySelector("#lbSend"); b.disabled = !page.rows.some((r) => !r.skip && r.name); b.textContent = "Send to KWADERNO (it matches the products there)"; }
    };
    sheet.replaceChildren(el("header", { class: "bar" }, el("button", { class: "icon", type: "button", "aria-label": "Back", onclick: () => { sheet.hidden = true; }, text: "←" }), el("b", { id: "lbTitle", text: "Check the lines" }), el("span")), body);
    draw();
  }

  // ---------- sending to KWADERNO ----------
  function payloadOf(pg) {
    return { type: "kw-logbook", mode: pg.mode, date: pg.date, rows: pg.rows.filter((r) => !r.skip && (r.pid || r.name) && Number(r.qty) > 0)
      .map((r) => ({ pid: r.pid || "", name: String(r.name || "").slice(0, 80), raw: String(r.raw || "").slice(0, 120), qty: Number(r.qty) || 1, amount: r.amount == null || r.amount === "" ? null : Number(r.amount), auto: r.auto || "" })).slice(0, 80) };
  }
  const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const linkOf = (pl) => APP_BASE + "#logbook-" + b64(JSON.stringify({ m: pl.mode, d: pl.date, r: pl.rows.map((r) => [r.pid, r.name, r.qty, r.amount, r.auto, r.raw]) }));
  function send() {
    const pl = payloadOf(page); if (!pl.rows.length) return;
    let sent = false;
    if (opener && !opener.closed) { try { opener.postMessage(pl, "*"); sent = true; } catch { sent = false; } }
    if (sent) { api.beep(true); toast(`Sent ${pl.rows.length} line(s) to KWADERNO ✓`); sheet.hidden = true; return; }
    // KWADERNO isn't open here (or no internet): keep the page and send it from the "waiting" list
    const pend = store.get(PEND_KEY, []); pend.push({ ...pl, at: Date.now(), preview: page.preview.length < 120000 ? page.preview : "" }); store.set(PEND_KEY, pend.slice(-20));
    sheet.hidden = true; renderCam();
    toast(navigator.onLine ? "Saved — tap “waiting” to open KWADERNO and add it" : "Saved on this phone — send it when you have internet");
  }
  function showPending() {
    const pend = store.get(PEND_KEY, []);
    sheet.hidden = false;
    sheet.replaceChildren(el("header", { class: "bar" }, el("button", { class: "icon", type: "button", "aria-label": "Back", onclick: () => { sheet.hidden = true; }, text: "←" }), el("b", { id: "lbTitle", text: "Pages waiting to send" }), el("span")),
      el("div", { class: "sheet-body" },
        el("p", { class: "muted small", style: "margin:0", text: "Each page opens KWADERNO and adds its lines. Needs internet." }),
        pend.length ? el("ul", { class: "hist" }, pend.map((pl, i) => el("li", {},
          el("div", { class: "t", text: `${pl.rows.length} line(s) · ${pl.mode === "sale" ? "Sales" : "Stock-in"} · ${pl.date}` }),
          el("div", { class: "m" }, pl.rows.slice(0, 3).map((r) => `${r.qty} ${r.name || r.raw}`).join(" · ")),
          el("div", { class: "a" },
            el("a", { class: "btn sm primary", href: linkOf(pl), onclick: () => { const p2 = store.get(PEND_KEY, []); p2.splice(i, 1); store.set(PEND_KEY, p2); } }, "Send"),
            el("button", { type: "button", onclick: () => { const p2 = store.get(PEND_KEY, []); p2.splice(i, 1); store.set(PEND_KEY, p2); showPending(); renderCam(); }, "aria-label": "Delete", text: "✕" })))))
          : el("p", { class: "empty", text: "Nothing waiting." })));
  }
  window.addEventListener("online", renderCam);
  renderCam();
  window.__kwLogbookTest = { parseLine, cleanPage, readPage, get page() { return page; }, setCatalog(c) { catalog = c; store.set(CAT_KEY, c); renderCam(); } };
})();
