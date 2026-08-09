# Development Setup

This guide walks through a complete local environment: infrastructure, configuration, the
three-process dev loop, and the mockup photo tooling.

## 1. Prerequisites

- Node.js 20+ (the Dockerfile uses `node:20-alpine`; the root project uses **npm**)
- Docker + Docker Compose (Postgres, Redis, MinIO, optional Ollama)
- Optional: [Bun](https://bun.sh) — only for `download_mockup_scripts/`

## 2. One-time setup

```bash
cp .env.example .env

# 1) Start infrastructure
docker compose up -d postgres redis minio

# 2) Install root dependencies
npm install

# 3) Bootstrap the database schema (idempotent)
npm run db:bootstrap
```

`.env` essentials for a happy local run:

```
AUTH_SECRET=<at-least-16-chars>
AUTH_MODE=development
AI_PROVIDER=mock            # or openrouter/fal/huggingface/ollama once keys are set
STORAGE_DRIVER=local
```

Set `OPENROUTER_API_KEY` / `FAL_API_KEY` / `HUGGINGFACE_TOKEN` to use real providers. They stay
server-side.

## 3. The three-process dev loop

Three terminals:

```bash
# Terminal 1 — API (Hono on http://localhost:3000)
npm run dev:api

# Terminal 2 — Worker (BullMQ consumer; REQUIRED for runs to progress)
npm run dev:worker

# Terminal 3 — Vite dev server (http://localhost:5173)
npm run dev
```

Vite proxies `/api`, `/uploads` and `/mockup-assets` to the API (see `vite.config.ts`), so the
browser only talks to port 5173.

**Order matters:** the API needs the DB bootstrapped and Redis reachable; the worker needs both
plus the same `.env`. `npm run dev:api` does **not** auto-bootstrap (only `npm run start:api`
does) — run `npm run db:bootstrap` first if you see table-missing errors.

## 4. Dev-mode identity

With `AUTH_MODE=development`, the frontend calls `POST /api/auth/dev-session` on load, which
creates/uses the `owner@local.test` user and its workspace (seeded with templates, prompt
templates, and connections). No browser login needed.

## 5. Optional: local image generation (Ollama)

```bash
docker compose --profile ollama up -d ollama
ollama pull x/flux2-klein            # or x/flux2-klein:9b
```

Then in `.env`:

```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434   # = http://ollama:11434 when using the compose service from inside containers
```

Verify with the Connections UI → Ollama → **Test connection** (reports reachability + whether the
model is installed).

## 6. Mockup template photos (Bun project — separate)

The repo ships pre-downloaded photos in `download_mockups/`. To refresh/extend them:

```bash
cd download_mockup_scripts
bun install
bun run index.ts <category>     # category ∈ tshirts | hoodies | posters | canvas | phone
```

This reads `../mockup_image_templates/{category}.json` and writes
`../download_mockups/{category}/{slug}.webp` (quality 80). **Do not `npm install` in this
folder** — it's a Bun project (`bun.lock`).

To add a new template category:
1. Add `mockup_image_templates/{category}.json` (`[{ "src", "title" }]` entries).
2. `bun run index.ts {category}` to download.
3. Register the category in `src/server/mockup-library.ts` (`MockupCategory`,
   `categoryProductTypes`), the API route whitelist in `src/server/index.ts`, and
   `downloadedDefaults` filter in `src/server/auth.ts` if it should be seeded.

## 7. Verifying everything works

```bash
# API up?
curl http://localhost:3000/api/health

# Worker processing?
# Launch a run in the UI (wizard → summary → Launch), or:
curl -X POST http://localhost:3000/api/workflows/runs \
  -H 'Content-Type: application/json' \
  -H 'x-dev-user-email: owner@local.test' \
  -d '{"name":"smoke","prompt":"A minimal geometric design","count":2,"products":["tshirt"],"provider":"mock"}'

# Watch progress:
curl http://localhost:3000/api/runs
```

With `provider: mock` you get zero-cost SVG placeholder designs and deterministic mockups
(no API key required).

## 8. Checks

```bash
npm run build    # tsc -b && vite build (type-checks everything)
npm test         # vitest run (unit tests only)
```

## Related docs

- Environment variables: `DOCS/reference/env-vars.md`
- Commands: `DOCS/reference/commands.md`
- Testing: `DOCS/development/testing.md`
- Deployment (cloud/Docker): `DOCS/architecture/deployment.md`
