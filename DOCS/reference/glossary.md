# Glossary

Shared vocabulary across the codebase, docs, and product conversation. Terms marked ★ are
first-class concepts in the code.

## Domain objects

| Term | Meaning | Where it lives |
|---|---|---|
| ★ **Workspace** | Per-user container of workflows, templates, connections, assets. Created lazily with seeding. | `workspaces` table; `ensureWorkspace` in `src/server/auth.ts` |
| ★ **Workflow** | A reusable, versioned production recipe (a `WorkflowDefinition` DAG). | `workflows` table; `src/core/workflow.ts` |
| ★ **Run** | One execution of a workflow with a fixed configuration snapshot. | `runs` table; `runs.config` JSONB |
| ★ **Job** | A unit of work within a run (design stage, per-variant mockup stage). Retryable, individually tracked. | `jobs` table; BullMQ |
| ★ **Design / Asset** | A persisted image file (AI-generated `design` or `uploaded-design`) with provenance metadata. | `assets` table |
| ★ **Product variant** | One design × one product type (T-shirt, hoodie, …). The fan-out result. | `product_variants` table |
| ★ **Mockup** | A rendered product presentation image (deterministic or generative). | `mockups` table |
| ★ **Mockup template** | A reusable mockup definition: deterministic (photo + bounding box) or generative (AI scene prompt). | `mockup_templates` table + `templateCatalog` |
| ★ **Prompt template** | A saved AI prompt + provider + model for repeatable design collections. | `prompt_templates` table |
| ★ **Connection** | A workspace's provider entry (default model + enabled flag). Keeps provider config out of workflows. | `workspace_connections` table |
| ★ **Listing** | A marketplace-facing record for a product variant and destination. | `marketplace_listings` table |
| **Destination** | Where outputs go: `etsy`, `tpublic`, `drive`, `download`. `download` is always available (ZIP). | `runs.config.destinations` |
| **Batch** | Conceptual grouping of designs generated/processed together in a run (conversation term). | (conceptual; runs + assets cover it) |

## Concepts & policies

| Term | Meaning |
|---|---|
| ★ **Approval policy** | Per-node `auto` / `review` / `skip` — whether a stage runs unattended, waits for human review, or is excluded. |
| ★ **Fan-out** | One design → many product variants via the product list. `estimateProducts` computes totals. |
| **Deterministic mockup** | Sharp compositing of the design onto a photo template at a bounding box. Fast, free, exact. |
| **Generative mockup** | AI-rendered lifestyle scene using a template prompt + the design as reference image. |
| **Provenance** | The recorded history of an asset: provider, model, prompt, style, source. Stored in `assets.metadata`. |
| **Provider-agnostic** | The app works with any provider implementing a capability interface; provider is configuration, not logic. |
| **Interface-first** | Program to interfaces (`src/core/interfaces/providers.ts`), never concrete vendors. |
| **Self-hosted / cloud** | Two deployment profiles of the same env-driven app (local Postgres/Redis/MinIO + Ollama vs hosted services). |
| **Run snapshot** | `runs.config` stores the exact launch payload so old runs stay reproducible. |
| **Model allowlist** | Per-provider list of accepted model ids (`providerModels` in `src/server/index.ts`). |

## Tech & infrastructure

| Term | Meaning |
|---|---|
| **Hono** | The API framework (`src/server/index.ts`). |
| **BullMQ** | Queue/worker system on Redis (`pod-workflows` queue). |
| **Drizzle** | TypeScript ORM used against Postgres. |
| **Sharp** | Image processing library for deterministic mockup compositing. |
| **MinIO** | Self-hosted S3-compatible object storage used in Docker Compose. |
| **Zod** | Runtime validation for env config and API payloads. |
| **Bootstrap** | The idempotent `db:bootstrap` schema setup (advisory-locked). |
| **`download_mockups/`** | Repo folder of photographic mockup templates (webp), organized by category. |
| **`mockup_image_templates/`** | Source JSON (`{src, title}`) used by the Bun download tool. |
| **`/mockup-assets/`** | Public route serving downloaded template photos (whitelisted categories). |
| **`/uploads/`** | Public route serving stored assets through the active storage driver. |

## Status enums

| Entity | Values |
|---|---|
| `runs.status` | `pending` → `queued` → `running` → `completed` / `failed` |
| `jobs.status` | `queued` → `running` → `completed` / `failed` |
| `product_variants.status` | `pending` → `ready` |
| `mockups.status` | `pending` → `ready` |
| `marketplace_listings.status` | `draft` (etsy/tpublic/drive) or `ready` (download) |
| UI run status labels | `Running` / `Ready` / `Draft` (dashboard demo catalog) |
