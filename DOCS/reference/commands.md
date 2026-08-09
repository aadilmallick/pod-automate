# Commands Reference

## Root project (npm)

| Command | What it does |
|---|---|
| `npm install` | Install root dependencies |
| `npm run dev` | Vite dev server (port `WEB_PORT`, proxies `/api`, `/uploads`, `/mockup-assets`) |
| `npm run dev:api` | Hono API via `tsx src/server/index.ts` (port `PORT`) — **does not** bootstrap DB |
| `npm run dev:worker` | BullMQ worker via `tsx src/server/worker.ts` |
| `npm run build` | `tsc -b && vite build` (type-check + production bundle) |
| `npm run preview` | Preview the built bundle |
| `npm run start:api` | `db:bootstrap` + `tsx src/server/index.ts` (used by Docker `api` target) |
| `npm run start:worker` | `db:bootstrap` + `tsx src/server/worker.ts` (used by Docker `worker` target) |
| `npm run db:bootstrap` | Idempotent schema bootstrap (`src/server/db/bootstrap.ts`, advisory-locked) |
| `npm test` | `vitest run` (unit tests in `tests/unit/`) |
| `npx vitest` | Vitest watch mode |
| `npx drizzle-kit …` | Drizzle Kit (config: `drizzle.config.ts`, out: `src/server/db/migrations`) |

## Docker Compose

| Command | What it does |
|---|---|
| `docker compose up -d postgres redis minio` | Self-hosted infra (dev) |
| `docker compose --profile ollama up -d ollama` | Optional local image model |
| `docker compose up --build` | Full stack: api + worker + web (nginx) + infra |
| `docker compose down` | Stop containers (volumes persist) |

Services: `postgres` (5432), `redis` (6379), `minio` (9000 API / 9001 console), `ollama`
(11434, profile), `api` (`API_PUBLIC_PORT`), `worker`, `web` (`WEB_PORT` → nginx 80).

## Ollama

```bash
ollama pull x/flux2-klein        # default image model
ollama pull x/flux2-klein:9b     # optional 9B variant
ollama list                      # check installed models
```

## Mockup photo tooling (Bun project — separate)

```bash
cd download_mockup_scripts
bun install
bun run index.ts tshirts         # category ∈ tshirts | hoodies | posters | canvas | phone
```

Reads `../mockup_image_templates/{category}.json`, writes
`../download_mockups/{category}/{slug}.webp` (quality 80). Uses `sharp@0.35`.

## Health checks

```bash
curl http://localhost:3000/api/health           # API liveness
redis-cli ping                                   # Redis
curl http://localhost:9000/minio/health/live    # MinIO (S3 driver only)
```

## Smoke test a run (no API keys)

```bash
curl -X POST http://localhost:3000/api/workflows/runs \
  -H 'Content-Type: application/json' \
  -H 'x-dev-user-email: owner@local.test' \
  -d '{"name":"smoke","prompt":"A minimal geometric design","count":2,"products":["tshirt"],"provider":"mock"}'
```

Requires the worker process to be running; watch progress with `GET /api/runs`.
