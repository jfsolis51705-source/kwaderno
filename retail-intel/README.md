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

## What it does

### Merchant app (`/store/...`)

| Screen | What it does |
|---|---|
| **Capture → Photo** | Choose the type of photo: **Shelf** (sets stock to the counted units), **Receipt** (adds stock and updates cost) or **Handwritten ledger** (removes sold items). The vision provider extracts `sku, brand, variant, qty, unit_price, confidence` lines, which the merchant **reviews and edits before saving**. Duplicate photos and low-quality photos are flagged before any stock change or points. |
| **Capture → Barcode** | Scan with the camera through `BarcodeDetector` (Chrome, Edge, Android). The fallback is typing, or a USB/Bluetooth scanner that types and presses Enter. Buttons: −1, +1, +6, +12. Unknown codes open quick-add. |
| **Capture → Manual** | Search a product and type ± quantity, or quick-add a new product. |
| **Stock** | Editable catalog: name, brand, variant, barcode, price, cost, low-stock level, logo or photo. Shows low and out-of-stock flags. |
| **Restock** | Draft a wholesale order from low-stock items, choose the distributor (Super8, Suy Sing…), edit quantities, then `draft → submitted → fulfilled`. Fulfilling adds the stock. |
| **Rewards** | Points balance, history and redemption preview. Points per verified photo: shelf 10, receipt 15, ledger 15. |
| **Sync** | Offline queue with pending and failed items, plus **Sync now**. |

### Operations portal (`/portal/...`)
- **Overview:** totals, share of shelf by brand (from each store's latest verified shelf photo), SKU stock health per store, a store table, and out-of-stock and low-stock alerts.
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

## API (all JSON, under `/api`)

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
- **Offline sync:** `POST /sync` (body: `store_id` plus `ops[]` with `op_id`, `type`, `payload`)
- **Portal:**
  - `GET /portal/overview`
  - `GET /portal/audit`
- **Health:** `GET /health`

## Tests

```bash
make test   # pytest (15) + vitest (6) + TypeScript typecheck
make e2e    # builds the web app, starts the real API on a fresh seeded DB, drives Chromium (18 checks)
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

**Frontend (vitest)**
- Stock rules.
- Offline adjustments.
- IndexedDB cache.
- The queue stays intact while offline.
- Batch sync removes accepted entries and marks rejected ones.
- Queued photos upload with an idempotency key.

**End-to-end (`frontend/e2e/run.mjs`)**
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

- **Camera barcode scanning** uses the browser's `BarcodeDetector`. That covers Chrome, Edge and Android; on iPhone Safari the merchant types the code or uses a scanner.
- **Mock vision** produces plausible but made-up lines. It shows the workflow, not accuracy. Use a real provider for real photos.
- **No login** in this module. Store choice is a selector. In production, put it behind KWADERNO's authentication and scope every endpoint to the user's stores (the main KWADERNO app already does this).
- **Rewards redemption** is a preview only.
