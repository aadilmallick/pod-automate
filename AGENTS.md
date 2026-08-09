# AGENTS.md — Pod Automator

> **What this file is:** a fast orientation guide for AI agents (and humans) working in this
> repository. It tells you what the project is, where the important code lives, what principles
> the codebase follows, and where to find deeper documentation.

---

## 1. What this project is

**Pod Automator** is a provider-agnostic **AI print-on-demand (POD) production pipeline**. It turns a
single product idea into a batch of marketplace-ready products:

```
Idea → AI-generated or uploaded designs → review → product variants (fan-out)
     → mockups (deterministic or AI-generative) → marketplace listings → ZIP export / publish
```

Key properties:

- **Interface-first, provider-agnostic.** All external services (image generation, storage,
  transformations, mockups, marketplaces) are behind capability interfaces in
  `src/core/interfaces/providers.ts`. The domain logic never imports a vendor SDK directly.
- **Dual deployment.** The *same* application runs cloud-hosted (S3, hosted Postgres/Redis,
  external AI APIs) or self-hosted (local filesystem, local Postgres/Redis, local Ollama/ComfyUI).
  Configuration is 100% environment-variable driven.
- **General engine, simple UI.** The backend is a general workflow/job engine; the V1 frontend is a
  guided multi-step wizard that produces valid workflow definitions.
- **Background jobs.** Runs are processed asynchronously by a BullMQ worker; every unit of work is a
  retryable job, and failures don't kill the whole run.

---

## 2. Tech stack

| Layer        | Technology |
|--------------|------------|
| Frontend     | React 18, Vite, plain CSS (`src/styles.css`), fslightbox for previews |
| API server   | Hono (`@hono/node-server`) |
| Language     | TypeScript, strict mode |
| Validation   | Zod (env config, API payloads) |
| Database     | PostgreSQL + Drizzle ORM |
| Queue        | BullMQ + Redis (ioredis) |
| Image work   | Sharp (deterministic mockup compositing, resizing) |
| AI providers | OpenRouter, Fal.ai, Hugging Face Inference, Ollama (local), mock |
| Storage      | Local filesystem or S3-compatible (MinIO) |

The root project uses **npm**. The standalone tool in `download_mockup_scripts/` is a separate
**Bun** project (its own `package.json` / `bun.lock` — do not run `npm install` there).

---

## 3. Repository map (where to look)

```
AGENTS.md                        ← you are here
README.md                        ← human-facing quickstart
FREEBUFF.md                      ← original one-shot build spec (the "mission brief")
conversation.md                  ← product PRD conversation history (why this exists)

DOCS/                            ← full engineering documentation (see §5)
  image_generation/tips.md       ← layered prompting guide

src/
  core/                          ← DOMAIN LAYER — no framework/vendor imports allowed
    interfaces/providers.ts      ← ★ THE capability interfaces (start here)
    prompting.ts                 ← layered prompt builder (design + mockup prompts)
    workflow.ts                  ← workflow graph model + production estimates
  data/catalog.ts                ← static catalogs: product options, template catalog, demo data
  client/api.ts                  ← typed frontend API client
  App.tsx                        ← entire frontend UI (dashboard, wizard, run monitor)
  main.tsx, styles.css           ← entry point, all styling

src/server/                      ← ADAPTER/INFRASTRUCTURE LAYER
  index.ts                       ← Hono app: all REST routes, static asset serving
  config.ts                      ← Zod-validated environment config (single source of truth)
  auth.ts                        ← dev-session + Google OAuth, workspace seeding
  ai.ts                          ← image provider adapters (mock/openrouter/fal/hf/ollama)
  catalog.ts                     ← dashboard catalog aggregation query
  queue.ts                       ← Redis connection + BullMQ queue
  worker.ts                      ← worker process entry
  workflow-runner.ts             ← ★ the actual pipeline execution logic
  mockup-library.ts              ← downloaded template registry, path resolution, placements
  mockup-renderer.ts             ← Sharp deterministic mockup compositing
  prompt-builder.ts              ← re-exports core prompting for the server
  storage.ts                     ← LocalStorageProvider / S3StorageProvider
  zip.ts                         ← structured ZIP export (manifest + folders)
  db/
    schema.ts                    ← ★ Drizzle schema (11 tables)
    client.ts                    ← pg Pool + drizzle instance
    bootstrap.ts                 ← idempotent schema bootstrap (advisory-locked)

download_mockup_scripts/         ← standalone Bun tool: fetch mockup template photos
  index.ts                       ← reads mockup_image_templates/{cat}.json → download_mockups/{cat}
mockup_image_templates/          ← source JSON lists of template photos (tshirts, hoodies, posters, canvas, phone)
download_mockups/                ← downloaded template photos, organized by category (served at /mockup-assets)

tests/unit/                      ← Vitest unit tests (prompting, workflow, mockup-renderer)
docker-compose.yml               ← postgres, redis, minio, ollama (profile), api, worker, web
Dockerfile                       ← multi-target: api / worker / web (nginx)
nginx.conf                       ← SPA + proxy /api, /uploads, /mockup-assets
```

**Starred files are the most important to read first** when working on the core:

1. `src/core/interfaces/providers.ts` — all capability contracts
2. `src/server/workflow-runner.ts` — the production pipeline
3. `src/server/db/schema.ts` — the data model
4. `src/server/index.ts` — the API surface

---

## 4. Architecture principles (do not violate these)

1. **Program to interfaces, never to concrete infrastructure.** If you add an AI service, a
   marketplace, a storage backend, or a transformation pipeline, it must implement an interface
   from `src/core/interfaces/providers.ts` and be selected by id/config — never hardcoded into
   domain logic. `src/core` must not import from `src/server` or vendor SDKs.
2. **Capability ≠ provider.** A provider implements capabilities (e.g., `generateImages`). The
   workflow only knows capabilities. Provider selection is *configuration*, not workflow logic.
3. **Environment-driven deployment.** Cloud vs self-hosted is decided by `.env` (e.g.,
   `STORAGE_DRIVER`, `AI_PROVIDER`, `DATABASE_URL`, `REDIS_URL`). Do not add
   environment-specific branches in domain code.
4. **General engine, simple UI.** The UI wizard produces a `WorkflowDefinition`; the engine can
   express arbitrary DAGs. Don't tighten the engine to match the wizard's constraints.
5. **Workflows are versioned, runs are immutable snapshots.** A `runs.config` JSONB holds the full
   execution config; changing a workflow later must not change what an old run means.
6. **Approval policies.** Every stage can be `auto` / `review` / `skip` — the pipeline should be
   able to pause at checkpoints.
7. **Server-side secrets.** API keys live only in `.env`, read by the server/worker. Never ship
   provider keys to the client bundle.

---

## 5. Documentation index

Full docs live in `DOCS/`. Start with `DOCS/README.md` for the map. Highlights:

| Topic | File |
|---|---|
| System architecture & principles | `DOCS/ARCHITECTURE.md` |
| Data model (11 tables) | `DOCS/architecture/data-model.md` |
| Pipeline & job execution | `DOCS/architecture/pipeline.md` |
| Cloud vs self-hosted deployment | `DOCS/architecture/deployment.md` |
| The capability interfaces | `DOCS/interfaces/providers.md` |
| Layered prompting system | `DOCS/interfaces/prompting.md` |
| Workflow graph model | `DOCS/interfaces/workflow.md` |
| All REST endpoints & schemas | `DOCS/api/endpoints.md` |
| AI provider adapters | `DOCS/server/ai-providers.md` |
| Workflow runner internals | `DOCS/server/workflow-runner.md` |
| Deterministic mockup rendering | `DOCS/server/mockup-rendering.md` |
| Auth (dev + Google OAuth) | `DOCS/server/auth.md` |
| Feature walkthroughs (wizard, run monitor, connections, mockups, listings, assets) | `DOCS/features/*.md` |
| Local setup & testing | `DOCS/development/setup.md`, `DOCS/development/testing.md` |
| How to extend (new provider/marketplace/template category) | `DOCS/development/extending.md` |
| Env vars & commands reference | `DOCS/reference/env-vars.md`, `DOCS/reference/commands.md` |
| Domain glossary | `DOCS/reference/glossary.md` |

---

## 6. Common commands

```bash
# dependencies (root project uses npm)
npm install

# bring up self-hosted infra (Postgres, Redis, MinIO)
docker compose up -d postgres redis minio
# optional local model server
docker compose --profile ollama up -d ollama

# bootstrap the DB schema (idempotent; also auto-runs via start:api / start:worker)
npm run db:bootstrap

# run the three processes (three terminals)
npm run dev:api        # Hono API  (tsx src/server/index.ts)
npm run dev:worker     # BullMQ worker
npm run dev            # Vite dev server (proxies /api → API)

# checks
npm run build          # tsc -b && vite build
npm test               # vitest run (tests/unit/*)

# mockup template photos (separate Bun project — do NOT npm install here)
cd download_mockup_scripts && bun install && bun run index.ts <category>   # e.g. tshirts
```

---

## 7. Environment & secrets

- Copy `.env.example` → `.env`. Every provider key stays server-side.
- `npm run dev:api`/`dev:worker` load `.env` via `dotenv` in `src/server/config.ts`.
- **Production hard requirement:** `NODE_ENV=production` + `AUTH_MODE=google` (the config module
  throws otherwise — dev identity is deliberately unsafe in production).
- `AUTH_SECRET` must be ≥ 16 characters (used to sign session cookies).
- `PUBLIC_SITE_URL` should be set to the deployed HTTPS origin so Open Graph/Twitter images are
  absolute URLs; the Vite plugin replaces `__PUBLIC_SITE_URL__` placeholders in `index.html`.
- Full reference: `DOCS/reference/env-vars.md`.

---

## 8. Gotchas & pitfalls (learned from the code)

- **The API needs the DB bootstrapped first.** `npm run start:api` / `start:worker` call
  `db:bootstrap` automatically; plain `tsx src/server/index.ts` does not. Bootstrap uses a
  Postgres advisory lock so concurrent API/worker boots are safe.
- **The worker must be running** for runs to progress — the API only *queues* jobs
  (`POST /api/workflows/runs` returns `202` immediately).
- **`download_mockup_scripts/` is a Bun project.** It has its own lockfile and uses
  `bun install` / `bun run`. Do not add it to the root npm install.
- **Mockup photos are served from the repo**, not from storage: `GET /mockup-assets/:category/:file`
  whitelists categories (`tshirts, hoodies, posters, canvas, phone`) and validates filenames.
- **Deterministic mockup asset paths are path-traversal-guarded** in `mockup-library.ts`
  (`resolveMockupAssetPath`) — keep it that way when extending.
- **Apparel mockups use `multiply` blending + near-white background removal** on the artwork;
  wall-art/phone-case use `over`. See `mockup-renderer.ts`.
- **Hugging Face returns a single image per call**; `generateImages` in `ai.ts` loops to reach
  `count`, batching at most 4 per request.
- **Ollama image generation is experimental** and host/runtime-limited; the app surfaces a clear
  connection/model status instead of silently failing.
- **Dev-mode users are auto-created** (`owner@local.test` by default) — the DB must be reachable
  even in development mode.
- **`runs.config` JSONB is the run snapshot.** The UI wizard state (`count`, `products`,
  `destinations`, `provider`, `templates`, …) is persisted there verbatim.
- The frontend is a **single-file app** (`src/App.tsx` ~470 lines) with all styles in
  `src/styles.css`. There is no router — `activeView` state switches views.

---

## 9. Suggested reading order for new agents

1. `README.md` (quickstart) + `DOCS/README.md` (doc map)
2. `src/core/interfaces/providers.ts` (contracts)
3. `DOCS/architecture/data-model.md` + `src/server/db/schema.ts`
4. `DOCS/architecture/pipeline.md` + `src/server/workflow-runner.ts`
5. `src/server/index.ts` (API) then `src/App.tsx` (UI)
6. `DOCS/development/extending.md` when adding new providers/features
