# Deployment

Pod Automator runs identically in the cloud or self-hosted — the application is environment-driven
(`src/server/config.ts` is the single source of truth). This document covers the process model,
Docker Compose topology, and what changes between the two deployment styles.

## 1. Process model

Three cooperating processes:

| Process | Dev command | Docker target | Role |
|---|---|---|---|
| API | `npm run dev:api` (`tsx src/server/index.ts`) | `api` | Hono server: REST, static assets, auth, enqueueing |
| Worker | `npm run dev:worker` (`tsx src/server/worker.ts`) | `worker` | BullMQ consumer, executes runs |
| Web | `npm run dev` (Vite) | `web` (nginx) | Serves the SPA; proxies `/api`, `/uploads`, `/mockup-assets` |

The API and worker both need `DATABASE_URL` (Postgres) and `REDIS_URL` (Redis). The web process
does not.

## 2. Docker Compose topology (`docker-compose.yml`)

```
postgres:16-alpine  (port 5432, db pod_automator, user/pass pod/pod, healthcheck)
redis:7-alpine      (port 6379, healthcheck)
minio               (ports 9000 S3 API + 9001 console, minioadmin/minioadmin, healthcheck)
ollama              (profile "ollama", port 11434 — opt-in: docker compose --profile ollama up -d ollama)
api                 (Dockerfile target api, ports ${API_PUBLIC_PORT:-3000}:3000)
worker              (Dockerfile target worker)
web                 (Dockerfile target web, ports ${WEB_PORT:-5173}:80, nginx)
```

Key environment wiring inside compose:

- `DATABASE_URL: postgres://pod:pod@postgres:5432/pod_automator`
- `REDIS_URL: redis://redis:6379`
- `S3_ENDPOINT: http://minio:9000`
- `./data` mounted into both `api` and `worker` at `/app/data` (so local-filesystem storage works
  and is shared between them).
- Compose defaults `AUTH_MODE` to `google`; `NODE_ENV=development` for api/worker, `HOST:
  0.0.0.0`.

`nginx.conf` (in the `web` container) serves the built SPA from `/usr/share/nginx/html`, proxies
`/api`, `/uploads` and `/mockup-assets` to `api:3000`, and falls back to `index.html` for
client-side routes.

## 3. Dockerfile targets (`Dockerfile`)

```
base   node:20-alpine, WORKDIR /app, npm ci, COPY .
build  npm run build (PUBLIC_SITE_URL build arg baked into index.html via Vite plugin)
api    node_modules + src → npm run start:api (db bootstrap + tsx server)
worker node_modules + src → npm run start:worker
web    nginx:1.27-alpine, copies dist/ + nginx.conf
```

`npm run start:api` / `start:worker` run `db:bootstrap` first, so containers don't need a manual
bootstrap step.

## 4. Cloud vs self-hosted (same code, different env)

| Concern | Self-hosted | Cloud |
|---|---|---|
| Database | Local Postgres (`DATABASE_URL=postgres://…`) | Neon / hosted Postgres |
| Queue | Local Redis (`REDIS_URL=redis://…`) | Upstash / hosted Redis |
| Storage | `STORAGE_DRIVER=local`, `STORAGE_DIR=./data/uploads` | `STORAGE_DRIVER=s3` + `S3_*` vars (MinIO or AWS S3) |
| AI image gen | `AI_PROVIDER=ollama` (+ `OLLAMA_BASE_URL`), or any cloud key | `AI_PROVIDER=openrouter\|fal\|huggingface` with keys |
| Auth | `AUTH_MODE=development` (dev identity) or Google | `AUTH_MODE=google` + Google OAuth credentials |
| Frontend | Vite dev or nginx | nginx container / CDN (set `PUBLIC_SITE_URL`) |

**Important:** `config.ts` refuses to start in production with dev auth:

```ts
if (config.NODE_ENV === 'production' && config.AUTH_MODE !== 'google') {
  throw new Error('Production requires AUTH_MODE=google with Google OAuth credentials; development identity is unsafe.')
}
```

## 5. URLs and ports (the confusing part)

Several env vars interact. This table clarifies what each controls:

| Var | Meaning |
|---|---|
| `HOST` / `PORT` | API bind address/port inside the container (`HOST: 0.0.0.0`, `PORT: 3000`) |
| `API_PUBLIC_PORT` | **Host-facing** API port; used to derive `APP_URL` and for OAuth redirects / CORS. Defaults to `PORT`. |
| `PUBLIC_HOST` | Host used to derive `APP_URL` (`http://${PUBLIC_HOST}:${API_PUBLIC_PORT}`) |
| `WEB_HOST` / `WEB_PORT` | Web host/port used to derive `WEB_URL` (dev Vite) |
| `PUBLIC_WEB_HOST` | Host used to derive `WEB_URL` when not overridden |
| `WEB_BIND_HOST` | Vite server bind host |
| `APP_URL` / `WEB_URL` | Explicit full-URL overrides |
| `PUBLIC_SITE_URL` | Canonical deployed HTTPS origin for Open Graph / Twitter metadata (replaces `__PUBLIC_SITE_URL__` in `index.html` at build) |
| `PUBLIC_ASSET_URL` | Base URL for stored asset URLs; defaults to `${APP_URL}/uploads` |
| `API_PROXY_TARGET` / `API_PROXY_HOST` | Vite dev proxy override for `/api` |

Dev default: API on `localhost:3000`, Vite on `localhost:5173` (proxying `/api`, `/uploads`,
`/mockup-assets` to 3000).

## 6. Quick starts

### Local (self-hosted, free inference)
```bash
cp .env.example .env                 # set AUTH_SECRET, keys as needed
docker compose up -d postgres redis minio
npm install
npm run db:bootstrap

# optional: local image model
docker compose --profile ollama up -d ollama
ollama pull x/flux2-klein           # then set OLLAMA_BASE_URL=http://localhost:11434, AI_PROVIDER=ollama

npm run dev:api
npm run dev:worker
npm run dev
```

### Full Docker Compose
```bash
cp .env.example .env
docker compose up --build
# Web:   http://localhost:5173   (WEB_URL)
# API:   http://localhost:3000   (APP_URL)
# MinIO: http://localhost:9001
```

## 7. Production checklist

1. `NODE_ENV=production`, `AUTH_MODE=google`, valid `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
2. Register `${APP_URL}/api/auth/google/callback` as an authorized redirect URI (set
   `API_PUBLIC_PORT` when the host port differs from the internal port).
3. Long random `AUTH_SECRET` (≥16 chars).
4. `PUBLIC_SITE_URL` = deployed HTTPS origin.
5. `STORAGE_DRIVER=s3` with real bucket credentials, or keep `local` with a persistent volume.
6. Hosted `DATABASE_URL` and `REDIS_URL`.
7. API and worker scaled/deployed together (the worker is what actually processes runs).

## 8. Environment reference

Every variable, with defaults and validation: `DOCS/reference/env-vars.md`.
