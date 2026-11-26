# KWADERNO Retail Intelligence

A merchant capture app and a brand/operations portal for sari-sari stores. Shelf photos, wholesale receipts and handwritten sales ledgers become live stock counts, restock orders and share-of-shelf analytics. No vision model is trained here: extraction goes through a pluggable provider (a deterministic **mock** by default, or any VLM API).

- **Backend** (`backend/`): FastAPI + SQLAlchemy. SQLite by default, PostgreSQL via `DATABASE_URL`.
- **Frontend** (`frontend/`): React + TypeScript + Tailwind (Vite).
  - Mobile-first merchant app.
  - Desktop operations portal.
  - Offline-first: IndexedDB cache plus a sync queue.

## Run it

```bash
make setup      # Python venv + npm install
make api        # terminal 1 → http://localhost:8100  (API docs: /docs)
make web        # terminal 2 → http://localhost:5173
```

On first start the API seeds a demo:
- 4 stores, each with a catalog.
- Verified shelf photos and pending receipts.
- One duplicate attempt, so the verification log has something to show.
- A draft order and a submitted wholesale order.

Set `SEED_DEMO=0` for an empty database. Copy `.env.example` to `.env` to change settings.

- Merchant app: http://localhost:5173/store/capture (best on a phone, or in your browser's phone view)
- Operations portal: http://localhost:5173/portal/overview

**Demo accounts** (seeded only when `SEED_DEMO=1`; all use the password `demo1234`):

| Account | Can do |
|---|---|
| `nena@demo.kwaderno.ph`, `ben@…`, `rosa@…`, `lito@…` | Owner of one store each: the merchant app for that store only |
| `ops@demo.kwaderno.ph` | KELSON operations: every store and the operations portal |

New merchants register at `/register`; that creates their store with them as owner. Owners add staff under **Account**.

## What it does

### Merchant app (`/store/...`)

| Screen | What it does |
|---|---|
| **Capture → Photo** | Choose the type of photo: **Shelf** (sets stock to the counted units), **Receipt** (adds stock and updates cost) or **Handwritten ledger** (removes sold items). The vision provider extracts `sku, brand, variant, qty, unit_price, confidence` lines, which the merchant **reviews and edits before saving**. Duplicate photos and low-quality photos are flagged before any stock change or points. |
| **Capture → Barcode** | Scan with the camera through `BarcodeDetector` (Chrome, Edge, Android). The fallback is typing, or a USB/Bluetooth scanner that types and presses Enter. Buttons: −1, +1, +6, +12. Unknown codes open quick-add. |
| **Capture → Manual** | Search a product and type ± quantity, or quick-add a new product. |
| **Stock** | Editable catalog: name, brand, variant, barcode, price, cost, low-stock level, logo or photo. Shows low and out-of-stock flags. |
| **Restock** | **Predictive** draft orders. Each item's pace is units leaving stock per day over the last 14 days, from ledger photos, scans and lower shelf counts. An item is ordered when it would run out within the lead time (3 days) or is at its alert level, with enough to cover 10 days. Every line explains why ("Sells ~0.6/day, 2 day(s) left"). Items with no history refill to twice their alert level. Choose the distributor (Super8, Suy Sing…), edit quantities, then `draft → submitted → fulfilled`; fulfilling adds the stock. Tune with `RESTOCK_LEAD_DAYS` and `RESTOCK_COVER_DAYS`. |
| **Today's check-in** (top of Capture) | The "zero behaviour change" loop: keep the notebook and shelves as they are and just take **2 photos a day**, the ledger page and the shelves. Once both are verified it gives **+10 points**, plus **+30 for every 7 days in a row**. Shows the streak and the last 14 days. |
| **Rewards** | Points balance, history and redemption preview. Points per verified photo: shelf 10, receipt 15, ledger 15, plus check-in bonuses. Owners also get a link to the **Business score**. |
| **Business score** (owners) | A **cash-flow readiness score** (0–100, banded Building / Fair / Strong) built only from the store's own records. Five weighted factors, each with its points and a plain explanation: sales recorded regularly 35, stock vs sales 20, wholesale restocks 15, clear original photos 15, time on KWADERNO 15. Shows how to raise it, with a disclaimer that it is **not a credit decision**. |
| **Sync** | Offline queue with pending and failed items, plus **Sync now**. |

### Live scanner (barcode and QR, like a QR scanner app)
- The **Barcode** tab opens the back camera as soon as it is opened and reads any barcode (EAN/UPC, Code 128, Code 39, ITF) or QR code inside the box by itself — no button to press. It beeps, vibrates and shows the product; it keeps scanning for the next item.
- The browser asks for camera permission once; after that it opens straight away. "Stop camera" keeps it off until turned on again.
- Uses the phone's own detector when it has one (Chrome/Android) and the bundled ZXing reader everywhere else (iPhone Safari, Firefox, desktop). Retail barcodes are checked with their check digit so a misread is never used.
- e2e covers it with a fake camera (Code 128 and QR fixtures).

### Online ordering (store link, `/shop/<link-name>`)
- **Online** tab: the owner picks a link name, turns on pickup and/or delivery, sets a delivery fee, minimum order and a note, then shares the link (Facebook, group chat, QR).
- Customers open the link **without an account**: a photo menu of items in stock, a cart that survives a reload, checkout for pickup or delivery, then an order code with a live status page.
- Prices always come from the store's Stock list (the browser can't set them); costs, SKUs and exact stock are never shown. Stock is checked when ordering and again on completion, and is deducted only when the store marks the order **Complete** (`online_order` movement with the order code).
- Order flow: new → accepted → ready → completed (or cancelled at any step before completion). The customer's status link uses a private token stored only as a hash; the public status page doesn't repeat the name, phone or address.
- Abuse limits: per-device rate limit (`ORDER_RATE_LIMIT`, default 10 per 10 min), a hidden honeypot field, PH mobile number check, 50 lines × 99 qty max.
- Payment is cash or the store's own QR Ph on pickup/delivery — nothing here claims a payment was verified.
- **Sharing on social media** (like a Lazada or Shopee link): the Online tab gives a share link `/s/<link-name>` with Share, Facebook, Messenger, Viber, WhatsApp, Telegram, X, Copy link and Copy post buttons. Social apps show a preview card (store name, place, pickup/delivery and a few items with prices, drawn by the server as a 1200×630 picture). Every product has its own share link `/s/<link-name>/p/<id>` that opens the store with that item highlighted, and says so if it has sold out. Set `PUBLIC_URL` (for example `https://order.kwaderno.ph`) in production so previews use the right address.

### Web app (install on the home screen)
- The app is installable (manifest, icons, service worker): Chrome/Android shows **Install**, iPhone uses Share → Add to Home Screen. It opens full-screen and loads with a weak signal; API calls and photos always go to the network.
- Each store's order page has its own home-screen entry under the store's name (`/api/shop/<link-name>/manifest.webmanifest`), so customers can reorder in one tap.

### Operations portal (`/portal/...`)
- **Online orders** (`/portal/online`): every store's order link, orders, completed/cancelled, waiting now, online sales, average order, delivery share and orders per day for 7/30/90 days, with search, sorting and 50 stores per page. Aggregated in SQL; a test covers 1,000 stores and 20,000 orders in under 2 seconds. Customer names, phone numbers and addresses stay with each store and never reach the portal.
- **Overview:** each store's **units sold per day** (supply-chain velocity), **check-in streak** and **cash-flow score**; totals, share of shelf by brand (from each store's latest verified shelf photo), SKU stock health per store, a store table, and out-of-stock and low-stock alerts.
- **Wholesale orders:** the queue across all stores, with totals per distributor. Fulfil or cancel orders here.
- **Verification log:** flagged or pending captures with their hash and sharpness, verify or reject actions, and the full audit log.

## How the key rules work

| Rule | Implementation |
|---|---|
| Duplicate photos | `sha256` catches exact copies. A **256-bit perceptual dHash** catches re-saved, resized or re-compressed copies: they match within ≤ 24 bits, while different photos and receipts measured 40+ bits apart. Duplicates are stored as `rejected` with `duplicate_of`, never move stock and never earn points (`backend/image_checks.py`). |
| Low-quality photos | Flagged when smaller than 8 KB, shorter side under 320 px, or blur score (variance of the Laplacian) below 60. The items can still be saved after review, but **no points** unless a reviewer overrides. |
| AI can't change stock on its own | Uploading only creates a `pending_review` capture. Stock changes only on **confirm**, using the lines the merchant reviewed. Each capture can be confirmed once. |
| Points | One reward entry per capture, enforced by a database unique constraint on `capture_id`. |
| Offline | The catalog is cached in IndexedDB. Changes go into a queue with a unique `op_id`, sent in one `/api/sync` batch, and the server records applied `op_id`s, so retries never double-apply. Offline photos are stored as bytes and uploaded with `client_id`, which is also idempotent. |
| Stock history | Every change is an `inventory_movements` row with a reason (`shelf_count`, `receipt`, `ledger`, `barcode`, `manual`, `order`) and the quantity afterwards. Stock never goes below 0. |

## Vision providers (`backend/vision_service.py`)

| `VISION_PROVIDER` | Needs | Notes |
|---|---|---|
| `mock` (default) | nothing | Deterministic: the same image always gives the same lines. Uses the store catalog plus a reference sari-sari SKU list. |
| `openai_compatible` | `VISION_API_KEY`, `VISION_MODEL`, `VISION_API_BASE` | Works with OpenAI, Gemini's OpenAI-compatible endpoint, or a self-hosted **Qwen-VL / InternVL served by vLLM**. |
| `anthropic` | `VISION_API_KEY`, `VISION_MODEL` | Claude Messages API with image input. |

To add a provider, implement `extract(image, kind, catalog) -> ExtractionResult` and register it in `get_provider()`. If the provider errors, the photo is kept and the merchant types the lines. Keys are read on the server only.

## Security

- **Passwords:** hashed with scrypt (Python standard library), with a per-user salt and constant-time comparison. Minimum 8 characters.
- **Sessions:** a random bearer token per login. Only its SHA-256 is stored, it expires after `SESSION_DAYS` (default 30), and logout revokes it.
- **Roles:**
  - Store owner: everything for their stores, including prices and the team.
  - Store staff: capture, scan, adjust stock and orders, but no price or catalog edits and no team changes.
  - KELSON `ops`: every store, the portal, and awarding points for a flagged photo after review.
- **Store isolation:** every endpoint checks membership. Another store's data returns **404**, so store ids can't be probed. Single products, photos and orders are checked against their own store.
- **Photos are not public:** the API returns **signed links that expire** (HMAC, `MEDIA_URL_TTL`, default 1 h). Unsigned, tampered or expired links are refused. Set `MEDIA_SECRET` in production so links survive restarts.
- **Login rate limit:** 8 attempts per 5 minutes per email and IP. It's kept in memory, so use a shared store such as Redis when running several API instances.
- **Audit:** every audit entry and stock movement records the user who made it.
- **Logging out** on a device clears that account's cached catalog, orders and unsent queue (after a warning if anything is unsynced).

## API (all JSON, under `/api`)

Everything except `/health`, `/auth/register`, `/auth/login` and signed `/media` links needs `Authorization: Bearer <token>`.

- **Accounts:**
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /auth/me`
  - `GET/POST /stores/{id}/members` (owners add staff)

The full interactive reference is at http://localhost:8100/docs.

- **Stores and products**
  - `GET/POST /stores`
  - `GET/POST /stores/{id}/products`
  - `PATCH /products/{id}`
  - `POST /products/{id}/thumbnail`
  - `GET /stores/{id}/lookup?code=`
  - `POST /inventory/adjust`
- **Captures**
  - `POST /captures` (multipart: `store_id`, `kind`, `file`, optional `client_id`)
  - `GET /captures`
  - `POST /captures/{id}/confirm`
  - `POST /captures/{id}/reject`
- **Orders**
  - `GET /orders`
  - `POST /orders/draft`
  - `PATCH /orders/{id}`
  - `POST /orders/{id}/status`
- **Rewards:** `GET /stores/{id}/rewards`
- **Insights:**
  - `GET /stores/{id}/checkins` (last 30 days and streak)
  - `GET /stores/{id}/forecast` (pace, days left and suggested quantity per product)
  - `GET /stores/{id}/cashflow` (owners and ops only)
- **Offline sync:** `POST /sync` (body: `store_id` plus `ops[]` with `op_id`, `type`, `payload`)
- **Portal:**
  - `GET /portal/overview`
  - `GET /portal/audit`
- **Health:** `GET /health`

### Online ordering
- `GET|PUT /api/stores/{id}/shop` — link settings (PUT: owner only)
- `GET /api/stores/{id}/customer-orders?status=open|new|…`, `POST /api/customer-orders/{id}/status` `{status}`
- `GET /api/portal/online?days=&q=&sort=sales|orders|open|last|name&limit=&offset=` (operations only)
- Sharing: `GET /s/{slug}`, `GET /s/{slug}/p/{product_id}` (preview pages for social apps, then redirect), `GET /api/shop/{slug}/card.png`, `GET /api/shop/{slug}/manifest.webmanifest`
- Public, no login: `GET /api/shop/{slug}`, `POST /api/shop/{slug}/orders`, `GET /api/shop/{slug}/orders/{code}?t=<token>`

## Tests

```bash
make test   # pytest (27) + vitest (6) + TypeScript typecheck
make e2e    # builds the web app, starts the real API on a fresh seeded DB, drives Chromium (27 checks)
```

**Backend (pytest)**
- Capture ingestion and deterministic extraction.
- Rejection of non-images, bad kinds and unknown stores.
- Exact and near-duplicate rejection.
- Idempotent offline retry.
- Low-quality photos get no points unless overridden.
- Shelf, receipt and ledger inventory effects.
- Barcode and manual adjustments.
- Product edit and thumbnail.
- Full wholesale order lifecycle, including invalid transitions.
- Rewards credited exactly once.
- Idempotent sync.
- Portal analytics.
- Demo seed.
- VLM reply parsing and provider fallback.
- **Security (`tests/test_auth.py`):**
  - Register, login and logout; password rules and hashing.
  - Every endpoint requires a login; login rate limit.
  - **Store isolation** across 11 endpoints (another store's data returns 404, and nothing changes).
  - Staff permissions.
  - Signed photo links that expire.
  - Upload ids can't be reused across stores.

**Frontend (vitest)**
- Stock rules.
- Offline adjustments.
- IndexedDB cache.
- The queue stays intact while offline.
- Batch sync removes accepted entries and marks rejected ones.
- Queued photos upload with an idempotency key.

**End-to-end (`frontend/e2e/run.mjs`)**
- **Login:** logged-out visitors go to the login page; a wrong password is refused; a merchant sees only their own store; a merchant can't open the portal.
- **Merchant flow, on a Pixel 7 viewport:**
  - Photo capture, review, edit, confirm → +10 points.
  - The same photo is rejected as a duplicate.
  - A blurry photo is flagged.
  - Barcode lookup with +6.
  - Manual quick-add.
  - **Offline**: an adjustment is queued, then synced once.
  - A draft restock order is submitted.
  - The rewards balance updates.
- **Desktop portal:** overview, share of shelf and alerts; fulfilling an order; duplicate flags in the verification log.
- If the installed `playwright` package doesn't match your browsers, set `CHROMIUM_PATH`.

## Limits (honest list)
- The portal **Overview** page still computes each store's cash-flow score on every load: about 2 s with 1,000 stores in a test, and slower as history grows. Caching those scores is the next step before going past ~1,000 stores. (The Online orders page is already aggregated and paged.)
- Link previews need the app on a public `https://` address with `PUBLIC_URL` set; Facebook caches a preview for a while after the first share.

- **Camera barcode scanning** uses the browser's `BarcodeDetector`. That covers Chrome, Edge and Android; on iPhone Safari the merchant types the code or uses a scanner.
- **Mock vision** produces plausible but made-up lines. It shows the workflow, not accuracy. Use a real provider for real photos.
- **QR Ph payments and cash-in/cash-out** need a licensed payment partner (e.g. PayMongo or Xendit) and their API keys. They are not built, and no screen pretends otherwise.
- **The cash-flow score's weights** are a transparent starting point. They have not been validated against real repayment data; do that with a lender before relying on it.
- **Staff invitations by email** aren't built: the owner sets a starting password and shares it in person.
- **Rewards redemption** is a preview only.
