# Architecture Overview

This document describes the overall architecture of **Pod Automator**: what it is, the layered
structure of the codebase, the core design principles, and how the pieces fit together. Deeper
detail lives in the sibling documents listed at the end.

## 1. What it is

Pod Automator is a **provider-agnostic AI print-on-demand production pipeline**. Users describe a
collection (e.g. "50 funny cat T-shirt designs"), optionally upload their own artwork, and the
system automatically:

1. generates or imports designs,
2. lets the user review/select them,
3. fans each design out into product variants (T-shirt, hoodie, sweatshirt, phone case, wall art),
4. renders mockups (deterministic template compositing **and/or** AI-generative lifestyle scenes),
5. records marketplace listings for chosen destinations,
6. exposes everything as a structured ZIP export, ready for publishing.

The mental model (from the original product conversation in `conversation.md`):

> **Assets enter a workflow. Nodes transform assets. Destinations consume assets.**

## 2. High-level system diagram

```
                    ┌──────────────────────┐
                    │  Browser (React/Vite) │
                    │  src/App.tsx          │
                    └──────────┬───────────┘
                               │ HTTP + cookies (credentials: include)
                               ▼
                    ┌──────────────────────┐
                    │  Hono API            │  src/server/index.ts
                    │  REST + static files │
                    └──────┬────────┬──────┘
                           │        │
                ┌──────────▼──┐   ┌─▼─────────────────┐
                │ PostgreSQL  │   │ Redis + BullMQ    │
                │ (Drizzle)   │   │ queue.ts          │
                └──────────┬──┘   └─┬─────────────────┘
                           │        │ enqueue run job
                           │        ▼
                           │  ┌──────────────────────┐
                           │  │ BullMQ Worker        │  src/server/workflow-runner.ts
                           │  │ (separate process)   │
                           │  └──────┬───────────────┘
                           │         │ uses
                           │         ▼
                           │  ┌───────────────────────────────┐
                           │  │ Capability adapters           │
                           │  │ ai.ts · storage.ts ·          │
                           │  │ mockup-renderer.ts · zip.ts   │
                           │  └──────┬────────────────────────┘
                           │         │ external / local services
                           │         ▼
                           │  ┌──────────────────────────────────────┐
                           │  │ OpenRouter · Fal.ai · Hugging Face · │
                           │  │ Ollama · S3/MinIO · local filesystem │
                           │  └──────────────────────────────────────┘
                           │
                           └── writes runs, assets, variants, mockups, listings, jobs
```

**Key property:** the API only *validates + queues*. All production work happens in the worker
process, so a run can outlive a browser session and failures can be retried independently.

## 3. Layered codebase

```
src/
├── core/          ← DOMAIN LAYER
│   ├── interfaces/providers.ts   capability contracts (no vendors)
│   ├── prompting.ts              prompt generation logic
│   └── workflow.ts               workflow graph model + estimation math
│
├── data/          ← STATIC CATALOGS (product options, template catalog, demo content)
│   └── catalog.ts
│
├── client/        ← FRONTEND API CLIENT (typed fetch wrappers)
│   └── api.ts
│
├── server/        ← ADAPTER/INFRASTRUCTURE LAYER (Hono, Drizzle, BullMQ, Sharp, SDKs)
│   ├── index.ts   Hono app & routes
│   ├── config.ts  Zod env config
│   ├── auth.ts    sessions + OAuth + workspace seeding
│   ├── ai.ts      image generation providers
│   ├── storage.ts storage providers
│   ├── mockup-library.ts / mockup-renderer.ts
│   ├── workflow-runner.ts  the pipeline
│   ├── queue.ts / worker.ts
│   ├── zip.ts     export
│   └── db/        schema.ts · client.ts · bootstrap.ts
```

Rules enforced by convention:

- `src/core` must **not** import from `src/server` or from vendor SDKs. It only defines types and
  pure functions (prompt building, workflow math).
- The **server imports core types** and implements/uses them.
- **The client imports core types** for shared enums (e.g. `ProductType`, `ImageStyle`) but never
  server internals.
- External services appear **only inside adapters** that implement an interface from
  `src/core/interfaces/providers.ts`.

## 4. The domain model (short version)

Full detail in `DOCS/architecture/data-model.md`.

```
User → Workspace
        ├── Workflows (versioned, definitionGraph JSONB)
        │      └── Runs (status, progressPercent, config JSONB snapshot)
        │            ├── Assets (designs, uploaded designs; provenance in metadata)
        │            ├── ProductVariants (design × productType)
        │            │      ├── Mockups (rendered files)
        │            │      └── MarketplaceListings (per destination)
        │            └── Jobs (per unit of work; status, retryCount, errorLog)
        ├── MockupTemplates (deterministic | generative)
        ├── PromptTemplates (reusable AI prompts)
        └── WorkspaceConnections (per-provider default model + enabled flag)
```

**The run is an immutable snapshot.** `runs.config` stores everything the UI configured
(count, products, destinations, provider/model, templates, asset ids), so re-running or editing a
workflow later never corrupts the meaning of an old run.

## 5. Core design principles

1. **Program to interfaces, never to concrete infrastructure.** Every external capability
   (`StorageProvider`, `ImageGenerationProvider`, `TransformationProvider`, `MockupProvider`,
   `MarketplaceAdapter`) is a TypeScript interface. Vendor SDKs live inside adapter classes that
   are instantiated by configuration (`src/server/config.ts` + small factory functions).
2. **Capability ≠ provider.** A provider implements one or more capabilities. The workflow engine
   refers only to capabilities; *which* provider backs a capability is configuration
   (`AI_PROVIDER`, per-run `provider`, per-connection `defaultModel`).
3. **Environment-driven deployment.** Cloud vs self-hosted is decided by `.env`
   (`STORAGE_DRIVER=local|s3`, `AI_PROVIDER`, `DATABASE_URL`, `REDIS_URL`, `AUTH_MODE`). There are
   no `if (production)` branches in domain logic — only in `config.ts`.
4. **General engine, simple UI.** `defaultWorkflow` is a linear DAG today, but `WorkflowDefinition`
   can express arbitrary node graphs. The wizard just produces valid definitions.
5. **Everything is a retryable background job.** The API enqueues; the worker executes; failures
   mark the run `failed` with an error log, and the UI offers retry entry points.
6. **Approval policies.** Each workflow node carries `policy: 'auto' | 'review' | 'skip'`,
   representing the product's "approval checkpoint" concept (e.g. review designs before fan-out).
7. **Server-side secrets.** Provider keys live only in server/worker `.env`; the Vite client never
   receives them (it only sees `configured: boolean`).

## 6. Process model

| Process | Command | Responsibility |
|---|---|---|
| **API** | `npm run dev:api` / Docker `api` target | REST endpoints, static asset serving, auth, enqueue runs |
| **Worker** | `npm run dev:worker` / Docker `worker` target | Consume `pod-workflows` queue, execute runs |
| **Web** | `npm run dev` / Docker `web` target | Vite dev server (proxies `/api`, `/uploads`, `/mockup-assets`) or nginx serving `dist/` |

In dev, run all three in separate terminals. In Docker Compose, all three run as containers and
the nginx container proxies `/api`, `/uploads` and `/mockup-assets` to the API container.

## 7. Where each concern lives (quick table)

| Concern | Location |
|---|---|
| Capability contracts | `src/core/interfaces/providers.ts` |
| Prompt generation | `src/core/prompting.ts` |
| Workflow definition & estimates | `src/core/workflow.ts` |
| Static catalogs (products, templates, demo) | `src/data/catalog.ts` |
| Frontend API client | `src/client/api.ts` |
| Entire UI | `src/App.tsx` + `src/styles.css` |
| Env config | `src/server/config.ts` |
| Auth | `src/server/auth.ts` |
| Image providers | `src/server/ai.ts` |
| Storage providers | `src/server/storage.ts` |
| Mockup template registry | `src/server/mockup-library.ts` |
| Deterministic mockup rendering | `src/server/mockup-renderer.ts` |
| Run execution | `src/server/workflow-runner.ts` |
| Queue infrastructure | `src/server/queue.ts`, `src/server/worker.ts` |
| ZIP export | `src/server/zip.ts` |
| DB schema/bootstrap | `src/server/db/` |
| Template photo pipeline | `download_mockup_scripts/` → `mockup_image_templates/*.json` → `download_mockups/*` |

## 8. Further reading

- [Data model](architecture/data-model.md)
- [Pipeline & job execution](architecture/pipeline.md)
- [Deployment](architecture/deployment.md)
- [Capability interfaces](interfaces/providers.md)
- [Prompting system](interfaces/prompting.md)
- [Workflow model](interfaces/workflow.md)
