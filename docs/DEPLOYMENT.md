# Deployment

KWADERNO is three parts: the **Next.js app** (UI + API), **PostgreSQL 16**, and the optional **receipt AI service** (Python).
The app works fully without the AI service — receipts then fall back to manual entry.

## 1. Requirements
| Part | Minimum for a pilot (≈ 50 stores) |
|---|---|
| App | 1 vCPU, 1 GB RAM, Node 22, persistent disk for uploads (or object storage, see below) |
| Database | PostgreSQL 16, daily backups, point-in-time recovery if available |
| AI service | 0.5 vCPU / 512 MB with `RECEIPT_PROVIDER=gemini`; a GPU host (≥16 GB VRAM) if you self-host Qwen3-VL |
| HTTPS | Required — camera, location and service worker only work on HTTPS (or localhost) |

## 2. Environment variables
| Variable | Where | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | app | yes | `postgres://user:pass@host:5432/kwaderno` (use `sslmode=require` for managed DBs) |
| `APP_URL` | app | yes | Public origin, e.g. `https://app.kwaderno.ph` — used for CSRF origin checks and HSTS |
| `UPLOAD_DIR` | app | yes | Private folder for receipt files (persistent volume). Never served statically |
| `MAX_UPLOAD_MB` | app, ai | no | Default 10 |
| `SESSION_TTL_DAYS` | app | no | Default 30 |
| `AI_SERVICE_URL` | app | no | e.g. `http://ai:8001`. Unset = manual receipt entry only |
| `AI_SERVICE_TOKEN` | app, ai | if AI used | Shared secret, long random string. Same value on both |
| `AI_TIMEOUT_MS` | app | no | Default 120000 |
| `RECEIPT_PROVIDER` | ai | no | `gemini` \| `paddle_qwen` \| `mock` (default mock — demo only) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | ai | for gemini | Key stays on the AI service only |
| `QWEN_VL_BASE_URL`, `QWEN_VL_MODEL`, `QWEN_VL_API_KEY` | ai | for paddle_qwen | OpenAI-compatible endpoint (vLLM, SGLang, Ollama) |

Secrets belong in your platform's secret manager, never in the repository or in `NEXT_PUBLIC_*` variables.

## 3. Option A — one server with Docker Compose
```bash
cp .env.example .env            # set APP_URL, AI_SERVICE_TOKEN, RECEIPT_PROVIDER, GEMINI_API_KEY
docker compose --profile app up -d --build
docker compose exec app node --import tsx src/db/migrate.ts   # migrations also run automatically at start
```
Put a TLS reverse proxy (Caddy, nginx, a cloud load balancer) in front of port 3000. Back up the `pgdata` and `uploads` volumes.
Change the database password in `docker-compose.yml` before exposing anything.

## 4. Option B — managed services
- **App:** any Node 22 host (Vercel, Render, Fly.io, Railway, a VM). Build `npm ci && npm run build`, start `npm start`, run `npm run db:migrate` on each release.
  On serverless hosts, local disk is not persistent: replace `src/server/storage.ts` with an object-storage implementation (S3/Vercel Blob/GCS, private bucket) — the interface is two functions.
  The in-memory rate limiter is per instance: use a shared store (Redis) when running more than one instance.
- **Database:** Neon, Supabase Postgres, RDS, Cloud SQL — any PostgreSQL 16.
- **AI service:** any container host (Cloud Run, Fly.io, Render). Keep it private or behind the token.

## 5. Release checklist
1. `npm run typecheck && npm run lint && npm test` (needs `TEST_DATABASE_URL`)
2. `cd ai-service && python -m pytest`
3. `npm run build`
4. Back up the database, then `npm run db:migrate`
5. Deploy, then check `GET /api/health` → `{"ok":true,"db":true,"ai":"ok"}`
6. Run `node e2e/run.mjs` against a **staging** copy (it creates records)

## 6. Operations
- **Health:** `GET /api/health` (200 when the DB is reachable; `ai` is informational).
- **Logs:** the app logs unexpected errors with `[kwaderno]`; user-facing messages never include stack traces.
- **Backups:** database + upload storage. Restoring the DB without the uploads only loses receipt images, not stock data.
- **Platform admin:** `npm run admin:grant -- you@example.com` (revoke with `--revoke`). The portal is at `/admin`.
- **Map tiles:** `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION` (defaults to the public OpenStreetMap server — fine for a small admin team; use a tile provider for heavier use).
- **Pilot merchant data:** see `docs/DATABASE.md#pilot-merchant-data-privacy`. The source files never go into the image (`.dockerignore` excludes `data/`).
- **Service worker updates:** `/sw.js` is served with `Cache-Control: no-cache`; bump `VERSION` in `public/sw.js` when you change caching rules.
