# Development checklist

> **Status:** Stages 1–7 complete. Remaining before the pilot: real-device camera/scanner tests and production deployment (see docs/PILOT.md).

Legend: ✅ implemented **and** tested · 🟡 implemented, partially tested · ⏳ not started

## Stage 1 — Foundation
- ✅ Repository inspected (empty; greenfield)
- ✅ Architecture & plan (`docs/ARCHITECTURE.md`)
- ✅ Full schema for all 20 required tables + `sessions`, `store_counters` (`src/db/schema.ts`)
- ✅ Migration `drizzle/0000_init.sql`, applied from scratch on every test run
- ✅ Docker Compose (Postgres; app under `--profile app`), Dockerfile, `.env.example`
- ✅ Demo seed (`npm run db:seed`, idempotent, refuses production)

## Stage 2 — UI shell, auth, stores
- ✅ Registration, login, logout, server-side sessions, Argon2id (tests: `tests/auth.test.ts`)
- ✅ Rate limiting on login/register (test)
- ✅ CSRF origin check for cookie mutations (test)
- ✅ Store creation with business-type picker, owner membership, audit log (test)
- ✅ Store profile edit with role rules (test)
- ✅ Members: add/promote/remove, last-owner protection (tests)
- ✅ Store isolation: foreign store → 404, list scoped (test)
- ✅ Protected routes (`proxy.ts` + server checks); browser flow verified at Pixel 7 and 1440px, no horizontal overflow
- ✅ Dashboard from live DB queries with date filter (renders real zeros + empty states; data-path tests arrive with Stage 3/4 data)
- ✅ Components: AppSidebar, MobileBottomNavigation, StoreHeader, DashboardMetricCard, ConfirmationDialog, LoadingState, EmptyState, ErrorState
- 🟡 PWA manifest + icons (service worker / offline shell in Stage 6)
- ⏳ Email invitations for staff without an account

## Stage 3 — Catalog, inventory, barcodes
- ✅ Product create/edit/search (name, brand, SKU, exact barcode)/category & stock filters/archive & restore (tests: `tests/catalog.test.ts`; browser-verified)
- ✅ Role rules: staff add products & record damage; managers edit prices, archive, opening stock, general adjustments (tests)
- ✅ Multiple barcodes per product, unique per store, same code allowed across stores (tests)
- ✅ Packaging variants with separate stock + "open pack" repack movement (test; UI on product page)
- ✅ Inventory ledger: row-locked movements, no overselling under 25 concurrent decrements, balance == sum of ledger (tests)
- ✅ Idempotency keys on adjustments, stock-in, counts, repack; concurrent retries apply once (tests)
- ✅ Stock-in (multi-line, supplier auto-created, updates cost), damaged, expired, supplier/customer return, opening, correction — reason required (tests; browser-verified)
- ✅ Product page: stock, margin, barcodes, full stock history with user and reason
- ✅ Scan page: workflow A lookup, D inventory count, E unknown barcode → register (browser-verified with typed barcode)
- ✅ Workflow B stock-in by scan/search (browser-verified)
- 🟡 BarcodeScanner camera path (@zxing/browser, rear camera, torch, camera switch, permission states, duplicate-scan cooldown) — the no-camera fallback is verified in a browser; **live camera scanning still needs testing on real Android/iPhone devices**
- 🟡 USB scanner (keyboard-wedge burst detection) — implemented, not tested with a physical scanner
- ⏳ Workflow C (scan to sell) — arrives with the Stage 4 cart
- ⏳ Product images (column exists; upload arrives with Stage 5 file storage)

## Stage 8 — after the MVP
- ✅ Super-Admin portal (`/admin`, platform admins only, 404 for others): network KPIs, 30-day sales chart (hover + screen-reader table), top stores, by city, pilot funnel (tests; browser-verified)
- ✅ Admin stores table (read-only) and Leaflet network map of all 139 pilot pins + app stores, validated colour palette, legend toggles, survey-area filter (browser-verified; map tiles need internet)
- ✅ `npm run admin:grant -- <email>`; demo Super-Admin `admin@kwaderno.ph`
- ✅ Expiry tracking: strict product-photo → label-photo → date sequence, private photos, expired/this-week/30-day groups, dashboard alert, dispose → `expired` stock movement once (tests; browser-verified)
- ⏳ Web Push notifications for expiry (needs VAPID keys + a push-capable deployment); today alerts are in-app
- ⏳ AI reading of the expiry date from the label photo (date is typed by the merchant)
- ⏳ Poster studio, other business types, credit scoring, QR Ph (product roadmap)

## Pilot data & store location (added on request)
- ✅ Store GPS location: "Use my current location" in setup and settings, validation, clear/update (tests; browser-verified with simulated GPS)
- ✅ Private pilot merchant list from the field map (139 unique pins) + survey workbook; payment fields excluded (normaliser + tests)
- ✅ Idempotent import; auto-match store ↔ pin within 50 m, one store per pin, merchants see only the store name (tests)
- ✅ Admin-only API for the pilot list (403 for merchants) (test)
- ⏳ Admin map/dashboard UI (Super-Admin portal, after MVP)

## Stage 4 — Sales & utang
- ✅ Sell screen: tap-to-add grid (best sellers first), search, barcode scan → cart (workflow C), mobile cart sheet (browser-verified)
- ✅ Atomic checkout: sale + items (price/cost snapshot) + stock deduction + payment/utang + audit in one transaction; all-or-nothing on missing stock (tests)
- ✅ Server-side prices (client sends product + qty only); duplicate lines merged; per-store sale numbers without races (tests)
- ✅ Cash with change (sukli), GCash recorded with optional reference (not verified — stated in UI), Utang to a customer (tests; browser-verified)
- ✅ Discounts limited to managers/owners (test)
- ✅ Idempotent sale submit — retries never double-sell (test)
- ✅ Receipt: on screen, share (Web Share), print page; marked "not an official receipt"
- ✅ Sales history with date filter; sale detail; void by manager returns stock and reverses utang (tests; browser-verified)
- ✅ Customers: add/edit/search, "with utang" filter, total outstanding (tests)
- ✅ Utang ledger: credit sales, partial/full payments, sale voids; append-only with running balance; balance not editable directly (tests)
- ✅ Credit limits (manager-set); overpayment and paying zero balance rejected; concurrent payments cannot overdraw (tests)
- ⏳ Edit/refund part of a sale (only full void for now)
- ⏳ Official BIR receipts (out of MVP scope)

## Stage 5 — Receipt AI
- ✅ ReceiptUploader: rear camera capture, file picker, drag-and-drop, progress; JPG/PNG/WebP/PDF checked by content, size limit, rate limit (tests; browser-verified)
- ✅ Private storage; original file streamed only to store members (test)
- ✅ Statuses uploaded/queued/processing/pending_review/confirmed/failed/rejected; background processing; stale-job recovery; retry
- ✅ Python FastAPI service: `mock`, `gemini`, `paddle_qwen` (PaddleOCR + Qwen3-VL) providers behind one contract; token auth; normalisation + arithmetic confidence checks (7 pytest tests; Docker image built and run)
- ✅ Product matching (no paid service), confidence scores, unknown products → "new product" (tests)
- ✅ ReceiptReviewTable: edit/skip/add lines, match or create products, stock preview, confirm/reject (browser-verified)
- ✅ Inventory changes only on confirmation; raw output preserved; one purchase per receipt; same photo can't be confirmed twice; idempotent + race-safe confirm (tests)
- ✅ Works without AI: failure recorded, items entered manually (test)
- 🟡 `gemini` and `paddle_qwen` providers implemented but **not run against the real APIs** (no key / GPU in the build environment)

## Stage 6 — Reports, offline, audit
- ✅ 8 reports from the ledgers with date ranges and totals; CSV export (UTF-8 BOM, formula-injection safe) (tests; browser-verified download)
- ✅ Service worker: cached app shell + pages opened before; offline fallback page; never caches API calls (browser-verified: Sell page reloads offline)
- ✅ IndexedDB operation queue; sales made offline are queued with a UUID used as idempotency key; auto-sync on reconnect/30 s (browser-verified)
- ✅ `/sync` endpoint: per-operation applied/conflict/failed; resend-safe; conflicts never overwrite and wait for retry/discard (tests)
- ✅ Sync status badge (offline / waiting / needs attention) and Offline sync page
- ✅ Logout clears cached pages and warns about unsynced items
- ✅ Audit log page and API for owners/managers (tests)
- ✅ Offline also for stock adjustments and utang payments (queued from their dialogs; sync tests)

## Stage 7 — Hardening & pilot
- ✅ Full automated suite: 71 integration tests + 7 Python tests + 12-step browser e2e (`node e2e/run.mjs`) incl. layout sweep of 16 pages at 360 px and 1440 px
- ✅ Defects fixed during testing: phone header overflow when offline, peso sign overlapping amounts, login credentials in URL before JavaScript loaded (now POST + redirect), prerender clock error, upload path tracing warning
- ✅ Security headers (frame-ancestors none, nosniff, Permissions-Policy for camera/location, HSTS on HTTPS), `poweredByHeader` off
- ✅ `/api/health`; Docker images for app and AI service built and smoke-tested (non-root, migrations on start)
- ✅ docs/DEPLOYMENT.md, docs/PILOT.md, ai-service/README.md
- ⏳ Real-device tests (Android/iPhone camera, torch, install to home screen, USB scanner) — see docs/PILOT.md
- ⏳ Production hosting, real Gemini key, Redis rate limiting for multiple instances, object storage for serverless hosts
