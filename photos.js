/* KELSON Photo Finder — looks up product photos on the open product databases (any country)
 * for the Super Admin, and sends each photo back to KELSON, which asks the admin before saving.
 * Barcode first (exact), then name search; sizes must agree (155g ≠ 425g). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const opener = (() => { try { return window.opener && !window.opener.closed ? window.opener : null; } catch { return null; } })();
  const DBS = [
    { host: "https://world.openfoodfacts.org", label: "Open Food Facts" },
    { host: "https://world.openbeautyfacts.org", label: "Open Beauty Facts" },
    { host: "https://world.openproductsfacts.org", label: "Open Products Facts" },
  ];
  const API = window.__kwPhotoApi || {}; // tests can swap the network
  const FIELDS = "code,product_name,product_name_en,brands,quantity,image_front_url,image_url";

  const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const SIZE_RE = /\b\d+(\.\d+)?\s*(g|gm|grams?|kg|ml|l|ltr|liters?|s|pcs|pc|oz)\b/g;
  const sizeOf = (t) => (fold(t).match(SIZE_RE) || []).map((x) => x.replace(/\s+/g, "").replace(/(gm|grams?)$/, "g").replace(/(ltr|liters?)$/, "l").replace(/pcs$/, "pc"));
  const toks = (t) => fold(t).replace(SIZE_RE, " ").split(" ").filter((w) => w.length >= 2);
  function lev(a, b) { if (Math.abs(a.length - b.length) > 1) return 2; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  function score(want, got) {
    const sa = sizeOf(want), sb = sizeOf(got); if (sa.length && sb.length && !sa.some((x) => sb.includes(x))) return 0;
    const ta = toks(want), tb = toks(got); if (!ta.length || !tb.length) return 0;
    const eq = (t, w) => t === w || (t.length >= 5 && w.length >= 5 && lev(t, w) <= 1);
    const m1 = ta.filter((t) => tb.some((w) => eq(t, w))).length, m2 = tb.filter((w) => ta.some((t) => eq(t, w))).length; if (!m1) return 0;
    const p = m1 / ta.length, r = m2 / tb.length; return (2 * p * r) / (p + r) + (sa.length && sb.length ? 0.05 : 0);
  }
  const titleOf = (p) => [String(p.brands || "").split(",")[0], p.product_name || p.product_name_en, p.quantity].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const imgOf = (p) => p.image_front_url || p.image_url || "";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function getJson(url) {
    if (API.getJson) return API.getJson(url);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
    try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); } finally { clearTimeout(t); }
  }
  async function getBlob(url) {
    if (API.getBlob) return API.getBlob(url);
    const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); return r.blob();
  }
  let lastSearch = 0; // the name search is limited to ~10 a minute: space them out
  async function search(db, q) {
    const wait = lastSearch + (API.gap ?? 6500) - Date.now(); if (wait > 0) await sleep(wait); lastSearch = Date.now();
    const d = await getJson(`${db.host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&json=1&page_size=12&fields=${FIELDS}`);
    return (d && d.products) || [];
  }

  async function find(item) {
    const bc = String(item.bc || "").replace(/\D/g, "");
    if (bc.length >= 8) for (const db of DBS) { // exact barcode: any country
      try { const d = await getJson(`${db.host}/api/v2/product/${bc}.json?fields=${FIELDS}`); const p = d && d.status === 1 && d.product; if (p && imgOf(p)) return { p: { ...p, code: p.code || bc }, db, how: "barcode" }; } catch { /* next */ }
    }
    const q = String(item.name || "").replace(/\(.*?\)/g, " ").replace(SIZE_RE, " ").replace(/\s+/g, " ").trim(); if (!q) return null;
    let best = null;
    for (const db of DBS) {
      let list = []; try { list = await search(db, q); } catch { continue; }
      for (const p of list) { if (!imgOf(p)) continue; const sc = score(item.name, titleOf(p)); if (!best || sc > best.sc) best = { p, db, sc, how: "name" }; }
      if (best && best.sc >= 0.8) break; // good enough: don't ask the other databases
    }
    return best && best.sc >= 0.6 ? best : null;
  }
  async function squareJpeg(blob, max) {
    const bmp = await createImageBitmap(blob); const side = Math.min(bmp.width, bmp.height), k = Math.min(1, max / side);
    const c = document.createElement("canvas"); c.width = Math.round(side * k); c.height = Math.round(side * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  }
  const send = (msg) => { try { opener && opener.postMessage(msg, "*"); } catch { /* KELSON closed */ } };

  async function run(items) {
    items = items.slice(0, 200); let found = 0;
    $("st").textContent = `Looking up ${items.length} product(s)…`;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; const li = document.createElement("li"); const n = document.createElement("div");
      n.innerHTML = '<div class="n"></div><div class="s">searching…</div>'; n.querySelector(".n").textContent = it.name; li.append(n); $("list").prepend(li);
      let hit = null; try { hit = await find(it); } catch { hit = null; }
      if (hit) {
        try {
          const raw = await getBlob(imgOf(hit.p)); const blob = await squareJpeg(raw, 640);
          const code = String(hit.p.code || "").replace(/\D/g, "");
          send({ type: "kw-photo-found", name: it.name, title: titleOf(hit.p), code, how: hit.how, score: hit.sc ?? 1, blob,
            source: hit.db.label, license: "CC BY-SA", link: `${hit.db.host}/product/${code}` });
          const img = document.createElement("img"); img.src = URL.createObjectURL(blob); img.alt = ""; li.prepend(img);
          n.querySelector(".s").innerHTML = '<span class="ok">✓ found</span> · '; n.querySelector(".s").append(`${titleOf(hit.p)} — ${hit.db.label}`);
          found++;
        } catch { hit = null; }
      }
      if (!hit) { send({ type: "kw-photo-none", name: it.name }); n.querySelector(".s").textContent = "not found online"; }
      $("bar").style.width = `${Math.round(((i + 1) / items.length) * 100)}%`;
      send({ type: "kw-photo-progress", done: i + 1, total: items.length, found });
    }
    send({ type: "kw-photo-done", found, total: items.length });
    document.querySelector("h1").textContent = "Done";
    $("st").textContent = AUTO ? `Found ${found} of ${items.length}. Sure matches were saved in KELSON by themselves — this tab closes now.` : `Found ${found} of ${items.length}. Check them in KELSON and tap Save — you can close this tab.`;
    if (AUTO) setTimeout(() => { try { window.close(); } catch { /* the browser keeps it */ } }, 2500);
  }
  let AUTO = location.hash === "#auto";

  let started = false;
  window.addEventListener("message", (e) => {
    if (!opener || e.source !== opener) return; // only the KELSON page that opened us
    const d = e.data; if (!d || d.type !== "kw-photo-list" || started || !Array.isArray(d.items)) return;
    started = true; if (d.auto) AUTO = true; run(d.items.filter((x) => x && typeof x.name === "string").map((x) => ({ name: x.name.slice(0, 120), bc: typeof x.bc === "string" ? x.bc.slice(0, 20) : "" })));
  });
  if (!opener) $("st").textContent = "Open this from KELSON → Super Admin → Photo library → Find photos online.";
  else { const hello = () => { if (!started) { send({ type: "kw-photo-hello" }); setTimeout(hello, 1000); } }; hello(); }
  window.__kwPhotoFinder = { score, find, sizeOf };
})();
