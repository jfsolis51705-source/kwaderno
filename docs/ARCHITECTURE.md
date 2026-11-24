# KWADERNO — Architecture & Implementation Plan

## Stage 1 findings (repository inspection)
- The repository was **empty**: no existing code, framework or modules to preserve.
- Tooling available: Node 22, PostgreSQL 16, Python 3.13, Docker.
- Network note: the shadcn/ui registry (ui.shadcn.com) is blocked from the build container, so the
  shadcn components in `src/components/ui/` were written by hand following the shadcn *new-york*
  source (same Radix primitives, `cva`, `cn()`), and they can be updated with the CLI later.

## Decisions (confirmed with product owner)
| Topic | Decision | Why |
|---|---|---|
| Scope | Sari-sari MVP first; schema leaves room for other business types, Super-Admin and the poster studio | Ship a working core before widening |
| Look | Clean tech: teal brand, light by default, dark-mode toggle | Readable in bright stores on low-end LCD phones |
| Data | Plain PostgreSQL + Drizzle + Docker Compose, our own auth | Portable (works on Supabase/Neon/RDS later) |
| Receipt AI | Separate Python FastAPI worker with pluggable providers; Gemini first, PaddleOCR + Qwen3-VL when a GPU is available | Self-hosting Qwen3-VL needs a GPU; core app must not depend on AI |

## Stack
- **Next.js 16** (App Router, Cache Components / Partial Prerendering, `proxy.ts`), TypeScript, Tailwind v4, shadcn/ui (Radix), Lucide.
- **PostgreSQL 16** via **Drizzle ORM** (`node-postgres`), SQL migrations in `drizzle/`.
- **Auth**: Argon2id password hashing (`@node-rs/argon2`), opaque session tokens (only SHA-256 stored), httpOnly SameSite=Lax cookie; Bearer token for future native clients.
- **Validation**: Zod schemas shared by client and server (`src/lib/validation.ts`); the server always re-validates.
- **Tests**: Vitest against a real Postgres test DB; route handlers called in-process. Playwright (pre-installed) for browser/viewport checks.

## Layering
```
src/app/(auth|app)/…         UI pages (Server Components + small client islands)
src/app/api/v1/…             Versioned REST API (Route Handlers) — thin
src/server/http.ts           publicRoute / authRoute / storeRoute wrappers: auth, CSRF origin check, error mapping
src/server/services/*.ts     Business logic. Every store-scoped function takes a StoreContext
src/server/services/stores.ts requireStoreAccess(): the ONE gate that creates a StoreContext
src/db/schema.ts             Tables, constraints, indexes
```
UI pages and the API call the **same services**, so authorization and business rules live in one place.
Mutations from the browser go through the API (needed for the offline queue in Stage 6).

### Store isolation
- Every store-owned table has `store_id`. Services only receive a `StoreContext` from `requireStoreAccess(userId, storeId, minRole)`,
  which checks an *active* membership in a non-deleted store.
- A foreign or non-existent store returns **404** (not 403) so IDs cannot be probed.
- Roles: `owner` > `manager` > `staff`. Owner-only: members, stock rules. Manager+: store profile, (Stage 3) catalog edits.

### Inventory integrity (applies from Stage 3)
- Stock changes only by inserting `inventory_transactions`; `inventory_balances` is updated in the **same DB transaction**
  after `SELECT … FOR UPDATE` on the balance row → serialises concurrent sales of the same product.
- Idempotency keys (unique per store) on sales, purchases, payments and adjustments; sync ops deduplicate on `operation_id`.
- A receipt can create at most one purchase (`purchases_receipt_uq`) — database-level guard against double confirmation.

### AI service (Stage 5)
```
app ──upload──▶ receipts (status=uploaded) ──enqueue──▶ ai-service (FastAPI)
                                                    provider: gemini | paddle_qwen | mock
ai-service ──callback/poll──▶ receipts.raw_extraction + receipt_items (status=pending_review)
merchant reviews → POST …/receipts/:id/confirm (idempotent) → purchase + stock-in transactions
```
If the AI service is down, receipts stay `queued`/`failed` with a retry, and manual stock-in still works.
Product matching runs in the app (it owns the catalog): bigram/token similarity, no paid service.

### Offline (Stage 6)
```
Service worker: app shell + previously opened pages (network-first), static assets (cache-first), never /api
Sell offline → IndexedDB queue {operationId (uuid), opType, payload} → POST /sync when online
Server: sync_operations row per operationId → domain service with idempotencyKey = operationId
        → applied | conflict (needs a person: retry/discard) | failed (auto-retry)
```

## Implementation order
| Stage | Scope | Status |
|---|---|---|
| 1 | Inspect repo, architecture, full schema + migrations, Docker Compose, env example | ✅ Done |
| 2 | Responsive UI shell, auth, store setup & membership, DB-derived dashboard | ✅ Done |
| 3 | Product catalog, packaging variants, barcodes, inventory ledger, barcode scanner | ✅ Done (real-device camera test pending) |
| 4 | Sales/POS, payments, customers & utang ledger | ✅ Done — **MVP complete** |
| 5 | Receipt upload, AI worker, review & confirmation | ✅ Done |
| 6 | Reports + CSV, offline PWA queue & sync, audit history UI | ✅ Done |
| 7 | Full test pass, defects, pilot prep, deployment | ✅ Done (real-device tests pending) |
