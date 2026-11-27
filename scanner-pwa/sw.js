// Offline support: keep the app's own files on the device. Scans never go through here.
const CACHE = "kwscan-v9";
const READER_CACHE = "kwscan-reader-v1"; // the handwriting reader (~7 MB): kept across app updates
const FILES = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "vendor/zxing-library-0.21.3.min.js", "logbook.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== READER_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// network first for everything (so a new version shows right away), the saved copy only when offline
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // the handwriting reader's files never change (versioned): from the phone first, the internet only the first time
  if (new URL(req.url).pathname.includes("/vendor/tesseract/")) { e.respondWith(caches.open(READER_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })))); return; }
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "index.html" : req, copy)); } return r; })
    .catch(() => caches.match(req.mode === "navigate" ? "index.html" : req).then((hit) => hit || caches.match(req))));
});
