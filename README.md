# KWADERNO

The merchant app of the **KELSON** AI Operating System — inventory, sales, utang and receipt scanning for
Filipino sari-sari stores. Responsive PWA for Android, iPhone, tablets and desktop browsers.

> Status: **Stages 1–8 complete** — auth, stores, products, barcodes, stock ledger, scanning, selling (cash/GCash/utang), customers & utang, receipt AI, reports + CSV, offline sync, audit log, expiry tracking, and the KELSON Super-Admin portal (`/admin`). Next: real-device tests and pilot deployment ([docs/PILOT.md](docs/PILOT.md)). See [`docs/CHECKLIST.md`](docs/CHECKLIST.md).

## Quick start
Requirements: Node 22+, and PostgreSQL 16 (local or via Docker).

```bash
cp .env.example .env.local
docker compose up -d db          # or use your own Postgres and edit DATABASE_URL
npm install
npm run db:migrate
npm run db:seed                  # demo@kwaderno.ph / demo-tindahan (Super-Admin: admin@kwaderno.ph, same password) — 51 products modelled on real QC sari-sari shelves (prices are estimates, no barcodes)
npm run dev                      # http://localhost:3000
```

Full stack in Docker (app + Postgres + receipt AI): `docker compose --profile app up --build`.

Receipt AI locally (optional):
```bash
cd ai-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
RECEIPT_PROVIDER=mock AI_SERVICE_TOKEN=change-me .venv/bin/uvicorn app.main:app --port 8001
```

## Pilot merchant data (optional, private)
Put the field map export and survey workbook in `data/private/` (git-ignored) as `pilot-map.kml` and `pilot-leads.xlsx`, then:
```bash
npm run pilot:normalize   # needs python3 + openpyxl; drops all payment fields
npm run pilot:import      # loads pins and matches stores within 50 m
```
See [docs/DATABASE.md](docs/DATABASE.md#pilot-merchant-data-privacy) for what is kept and who can see it.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest integration tests (needs `TEST_DATABASE_URL`; the DB is reset each run) |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Demo data (dev only) |
| `npm run e2e` | Browser end-to-end checks against a running app (creates records — dev/staging only) |
| `npm run pilot:normalize` / `pilot:import` | Load private pilot merchant pins (see below) |
| `npm run admin:grant -- <email> [--revoke]` | Grant/revoke KELSON Super-Admin access |

## Docs
- [Architecture & plan](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API](docs/API.md)
- [Checklist](docs/CHECKLIST.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Pilot readiness](docs/PILOT.md)
- [Receipt AI service](ai-service/README.md)

## Project layout
```
src/app/(auth)        login, register
src/app/(app)         merchant app (dashboard, settings, modules)
src/app/onboarding    store setup
src/app/api/v1        REST API
src/server            auth, http wrappers, services (business rules)
src/db                schema, client, migrate, seed
src/components        ui/ (shadcn), app/ (shell & shared), forms/
drizzle/              SQL migrations
tests/                Vitest integration tests
```
