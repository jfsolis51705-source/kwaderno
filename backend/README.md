# KWADERNO network hub (Supabase)

The backend for store accounts, called "the hive" in the deck. Super Admin is the queen and each store phone is a worker bee. Each sale, customers and utang names stay on the phone. The hub only holds what each owner chose to share.

- **Project:** Supabase `kwaderno` (`njzuhthfvlaapzgzosbu`), region `ap-southeast-1` (Singapore), free plan.
- **Applied migrations:** [`supabase/migrations/`](supabase/migrations).

## Tables

| Table | Holds | Who can read | Who can write |
|---|---|---|---|
| `stores` | Name, area, privacy version, level 1/2 choices, deletion request | The owner, store members, admins | Anyone signed in can create their own; the owner can update |
| `store_members` | Owner and staff of each store | Members, admins | The owner adds or removes staff |
| `branches` | Branches of a store | Members, admins | The owner |
| `summaries` | One row per store and branch: `basic` (always), `learn` (level 1), `sales` (level 2) | Members, admins | Members |
| `credit_applications` | Level 3: one consent per application, `waiting` or `withdrawn` | Members, admins | The owner applies or withdraws |
| `network_docs` | What the queen sends down: engine pack, discount rules, insights, knowledge | Anyone signed in | Admins |
| `admins` | Super Admin accounts | Each admin can see only their own row | Database owner only |

## What the server enforces

These rules apply whatever an app sends.

- **Level 1 off:** `learn` is dropped. **Level 2 off:** `sales` is dropped.
- **Turning a level off** clears what was already stored at that level.
- **Money never travels in level 1:** `r30`, `cost`, `utang`, `days`, `mix` and `customers` are removed from it.
- **Customer names never travel in level 2:** `customers`, `customerNames` and `receipts` are removed from it.
- **`basic` keeps only three fields:** products, lowStock and lastActiveAt.
- **A deletion request** stops all further sync for that store.
- **Credit applications** can only be `waiting` or `withdrawn`. Nothing in the hub sends data to a lender.
- **`area_report()`** works only for admins, and only returns cities with 5 or more stores. Use it for anything that leaves KELSON.

## Tested

The SQL test was run inside a transaction and rolled back.

- **Owner:** became the owner member; level filters held; turning level 2 off cleared sales; customer names were stripped; the credit status guard held.
- **Another user:** saw 0 stores and 0 summaries, and was blocked from writing summaries and network docs.
- **Admin:** saw every store and credit application, and wrote network docs.
- **`area_report()`:** showed Marikina with 5 stores (3 of them sharing sales); left out Batac, with 1 store.
- **After a deletion request:** sync was refused.

## Open items

- **Security advisor warnings:** the helper functions (`is_admin`, `is_member`, `is_store_owner`) and the trigger functions sit in the `public` schema. That makes them callable through `/rest/v1/rpc`. They only report the caller's own membership, and the trigger functions do nothing when called directly. The planned fix is to move them into a private schema; that migration was not applied (declined).
- **Making someone a Super Admin:** add their `auth.users` id to `admins` from the Supabase dashboard (SQL editor).
- **Connecting the app:** the KWADERNO artifact runs inside claude.ai and keeps using its built-in database for now. Connect the scanner app or a standalone build with `@supabase/supabase-js` and the project's publishable key (Settings → API).
- **Sign-in:** turn on email or phone sign-in in Supabase Auth settings.
