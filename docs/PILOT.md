# Pilot readiness

## Before the first store
- [ ] Production deployed over HTTPS with backups (see DEPLOYMENT.md)
- [ ] `AI_SERVICE_TOKEN` set to a long random value; `RECEIPT_PROVIDER=gemini` with a real key (not `mock`)
- [ ] Demo data **not** seeded in production (`npm run db:seed` refuses when `NODE_ENV=production`)
- [ ] Your account marked platform admin; pilot pins imported with `npm run pilot:import` (from a secure machine)
- [ ] Test on at least one low-end Android phone and one iPhone:
  - [ ] Install to home screen (Add to Home Screen) and open it
  - [ ] Camera barcode scan: EAN-13 on a sachet, a can, a bottle; torch on/off; switch camera
  - [ ] Receipt photo with the rear camera; PDF upload from Files
  - [ ] "Use my current location" in store setup
  - [ ] Airplane mode: record 2 sales, reopen the app, turn data back on → both sync once
- [ ] A USB barcode scanner on a desktop/laptop (keyboard-wedge mode)

## Onboarding a store (≈ 20 minutes)
1. Owner registers and creates the store **at the store** (so GPS matches the pilot pin).
2. Add the 20 fastest-moving products first: scan each barcode → fill price and current count.
3. Record one real sale in cash, one GCash, one utang with a real customer.
4. Photograph the next supplier receipt and confirm it together.
5. Add staff (they register first, then the owner adds their email in Settings → Team).

## What to watch during the pilot
| Signal | Where |
|---|---|
| Sales per day per store, utang outstanding | Dashboard / Reports |
| Receipts stuck in "Couldn't read" | Receipts list (status) |
| Offline items needing attention | Header badge / Offline sync page |
| Negative or corrected stock | Reports → Inventory movements (`count_correction`, `adjustment`) |
| Who changed what | Audit log (owners/managers) |

## Known limits (be upfront with merchants)
- GCash is **recorded**, not verified. Check the GCash app.
- Receipts printed by KWADERNO are **not official BIR receipts**.
- Only whole sales can be voided (no partial returns yet).
- Offline: pages must have been opened once online; utang needs the customer to exist before going offline.
- AI receipt reading is an assistant: every line must be reviewed before stock changes.
