# API v1

Base path: `/api/v1`. JSON in and out.

**Auth**: session cookie `kw_session` (browser), or `Authorization: Bearer <token>` (native clients:
send `x-client: native` to `/auth/login` to receive the token).
Cookie-authenticated mutations must come from the app's own origin (Origin header check).

**Success**: `{ "data": … }`  
**Error**: `{ "error": { "code", "message", "details?" } }`

| Status | code |
|---|---|
| 401 | UNAUTHENTICATED |
| 403 | FORBIDDEN (role too low, or cross-site request) |
| 404 | NOT_FOUND (also returned for stores you are not a member of) |
| 409 | CONFLICT / INSUFFICIENT_STOCK |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE |
| 422 | VALIDATION_ERROR — `details: [{ path, message }]` |
| 429 | RATE_LIMITED (+ `Retry-After`) |

## Implemented (Stage 2)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /auth/register | public | `{fullName, email, phone?, password}` → 201, sets cookie. 10/hour/IP |
| POST | /auth/login | public | `{email, password}` → `{user, stores}`. 30/15 min per IP, 8/15 min per email |
| POST | /auth/logout | any | Deletes the session server-side |
| GET | /auth/me | user | `{user, stores}` |
| GET | /stores | user | Stores you belong to, with your role |
| POST | /stores | user | Create store; you become owner. Optional `latitude`/`longitude`; response includes `pilotMatch` |
| GET | /stores/:storeId | staff | Profile + `myRole` |
| PATCH | /stores/:storeId | manager | Partial profile; `allowNegativeStock` is owner-only; `latitude`+`longitude` (both or `null`) — returns `pilotMatch` (store name) when the location matches a pilot pin within 50 m |
| POST | /stores/:storeId/select | staff | Sets active store cookie for the web UI |
| GET | /stores/:storeId/members | staff | Active members |
| POST | /stores/:storeId/members | owner | `{email, role: manager\|staff}` — user must already have an account |
| PATCH | /stores/:storeId/members/:memberId | owner | `{role}`; cannot remove the last owner |
| DELETE | /stores/:storeId/members/:memberId | owner | Soft-removes membership |
| GET | /stores/:storeId/dashboard?from=&to= | staff | Dates `YYYY-MM-DD` in store timezone; default today |

## Platform admin
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /admin/pilot-merchants | platform admin | All pilot pins with claim status. Contains personal data |

## Implemented (Stage 3) — all under `/stores/:storeId`
| Method | Path | Role | Notes |
|---|---|---|---|
| GET/POST | /categories | staff | POST `{name}` (case-insensitive upsert) |
| GET | /products?q=&categoryId=&filter=all\|low\|out\|archived&limit=&offset= | staff | `{items, total}`; `q` matches name/brand/SKU or exact barcode |
| POST | /products | staff | Product fields (money in centavos), optional `barcodes[]`, `categoryName`, `openingQuantity`, `packChildId`+`packQuantity` |
| GET / PATCH | /products/:id | staff / manager | GET includes stock, barcodes, pack links |
| POST / DELETE | /products/:id/archive | manager | Archive / restore |
| GET | /products/:id/history | staff | Stock ledger, newest first |
| POST | /products/:id/barcodes | staff | `{barcode}` — 409 names the product already using it |
| DELETE | /products/:id/barcodes/:barcode | manager | |
| GET | /barcodes/:code | staff | `{found, product}` — 200 even when unknown |
| GET | /inventory | staff | Same as /products (stock levels) |
| POST | /inventory/adjustments | staff* | `{productId, type, quantity, direction?, reason, idempotencyKey}`; *opening/adjustment need manager |
| POST | /inventory/stock-in | staff | `{supplierId?\|supplierName?, referenceNo?, purchaseDate?, lines:[{productId, quantity, unitCostCentavos}], idempotencyKey}` |
| POST | /inventory/counts | staff | `{lines:[{productId, countedQuantity}], idempotencyKey}` → corrections for differences only |
| POST | /inventory/repack | staff | `{packProductId, packs, idempotencyKey}` |
| GET/POST | /suppliers | staff | |
| GET | /purchases | staff | Recent stock-ins |

Stock-changing endpoints return **201** when applied and **200 with `replayed: true`** when the same `idempotencyKey` was already applied. `409 INSUFFICIENT_STOCK` includes `details.available`.

## Implemented (Stage 4) — under `/stores/:storeId`
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /sales?from=&to=&q= | staff | `q` = sale number. `{items, total, completedTotalCentavos}` |
| POST | /sales | staff | `{lines:[{productId, quantity}], paymentMethod: cash\|gcash\|credit, amountTenderedCentavos?, referenceNo?, customerId? (required for credit), discountCentavos? (manager), occurredAt?, idempotencyKey}`. Prices come from the catalog. 201 new / 200 replay. 409 `INSUFFICIENT_STOCK` or credit limit |
| GET | /sales/:id | staff | Receipt data: items, payments, customer, cashier |
| POST | /sales/:id/void | manager | `{reason}` — returns stock, reverses utang, keeps the record |
| GET / POST | /customers?q=&filter=all\|owing | staff | `{items, total, totalOwedCentavos}`; POST `{name, phone?, address?, notes?, creditLimitCentavos? (manager)}` |
| GET / PATCH | /customers/:id | staff | GET includes the utang ledger. Balance cannot be edited directly |
| POST | /customers/:id/payments | staff | `{amountCentavos, method: cash\|gcash, referenceNo?, note?, idempotencyKey}` — rejects more than owed |

GCash is **recorded only**; KWADERNO does not process or verify GCash payments.

## Implemented (Stage 5) — receipts, under `/stores/:storeId`
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /receipts | staff | Latest 50 with status |
| POST | /receipts | staff | multipart `file` (JPG/PNG/WebP/PDF, type checked by content, ≤ `MAX_UPLOAD_MB`). **202**; AI runs in the background. `duplicateOf` set when the same image was uploaded before. 60/hour per user |
| GET | /receipts/:id | staff | Header, raw AI output (unchanged), lines with extracted vs reviewed values, match suggestions, linked purchase |
| GET | /receipts/:id/file | staff | Original file (private, `nosniff`, sandboxed) |
| POST | /receipts/:id/retry | staff | Re-queue a failed reading (202) |
| POST | /receipts/:id/confirm | staff | `{idempotencyKey, supplierName?, receiptNumber?, purchaseDate?, lines:[{id?, rawDescription, action: match\|create\|skip, productId?, quantity?, unitCostCentavos?, newProduct?:{name, unit, sellingPriceCentavos}}]}` → one purchase + stock-in. 201 / 200 replay. 409 if the same photo was already confirmed |
| POST | /receipts/:id/reject | staff | `{reason}`; not allowed after confirmation |

Statuses: `uploaded → queued → processing → pending_review → confirmed` (or `failed` / `rejected`). Inventory changes **only** on confirm.

## Implemented (Stage 6)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /stores/:id/reports/:type?from=&to=[&format=csv] | staff | `daily_sales`, `sales_by_product`, `sales_by_payment`, `inventory`, `low_stock`, `purchases`, `utang`, `movements`. CSV: UTF-8 BOM, pesos as decimals, formula-injection safe |
| POST | /stores/:id/sync | staff | `{deviceId, operations:[{operationId (uuid), opType: sale.create\|inventory.adjust\|customer.payment, payload, clientCreatedAt?}]}` → per-op `applied`/`conflict`/`failed`. Idempotent per `operationId`. 120/min per user |
| GET | /stores/:id/sync | staff | Server log of received offline operations |
| GET | /stores/:id/audit?action=&from=&to= | manager | Audit trail with before/after |
| GET | /api/health | public | `{ok, db, ai}` — no data |

Login and register also accept plain `application/x-www-form-urlencoded` form posts (303 redirect), so they work before JavaScript loads.

## Stage 8
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /admin/overview | platform admin | Network KPIs, 30-day trend, top stores, by city, pilot funnel |
| GET | /admin/stores | platform admin | All stores with owner, counts, 30-day sales, location, pilot match |
| GET | /admin/map | platform admin | Pilot pins (with claim status) + app stores with GPS |
| GET | /stores/:id/expiries?status=active\|cleared | staff | `{items (soonest first, days_left), summary: {expired, soon, month}}` |
| POST | /stores/:id/expiries | staff | multipart `productPhoto` (step 1) + `labelPhoto` (step 2) + `productId`, `expiryDate`, `quantity?`, `note?`. Both photos required |
| GET | /stores/:id/expiries/:eid/photo/product\|label | staff | Private photo |
| POST | /stores/:id/expiries/:eid/clear | staff | `{reason: sold_out\|disposed\|returned, quantity?, idempotencyKey}` — disposed records an `expired` stock movement |

## Planned
Super-Admin portal APIs, staff invitations, partial returns.
