# Data Model

The persistence layer is **PostgreSQL** accessed through **Drizzle ORM**. The schema is defined in
`src/server/db/schema.ts` and bootstrapped idempotently by `src/server/db/bootstrap.ts`
(advisory-locked so concurrent API/worker boots are safe).

## 1. Entity relationship overview

```
users 1 ──── n workspaces 1 ──── n workflows 1 ──── n runs 1 ──── n assets
                                  │                    │
                                  │                    ├── n product_variants 1 ──── n mockups
                                  │                    │         │
                                  │                    │         └── n marketplace_listings
                                  │                    └── n jobs
                                  │
                                  ├── n mockup_templates   (per workspace)
                                  ├── n prompt_templates   (per workspace)
                                  └── n workspace_connections (per workspace)
```

## 2. Tables (source of truth: `src/server/db/schema.ts`)

All tables share `id uuid defaultRandom primary key` plus `created_at`/`updated_at` timestamps.

### `users`
| Column | Type | Notes |
|---|---|---|
| `email` | varchar(255) | **unique**, required |
| `name` | varchar(120) | required |
| `google_id` | varchar(255) | nullable; set when Google OAuth is used |

### `workspaces`
| Column | Type | Notes |
|---|---|---|
| `owner_id` | uuid → users.id | required |
| `name` | varchar(120) | e.g. `"{user name}'s studio"` |

One workspace per user is created lazily by `ensureWorkspace` in `src/server/auth.ts`.

### `workflows`
| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid → workspaces.id | required |
| `name` | varchar(160) | required |
| `version` | integer, default 1 | workflow versioning |
| `definition_graph` | jsonb | a `WorkflowDefinition` (see `DOCS/interfaces/workflow.md`) |

Workflows are looked up by `(workspaceId, name)`; creating a run reuses an existing workflow with
the same name, otherwise it inserts one with `defaultWorkflow`.

### `runs`
| Column | Type | Notes |
|---|---|---|
| `workflow_id` | uuid → workflows.id | required |
| `status` | varchar(30) | `pending` → `queued` → `running` → `completed`/`failed` |
| `progress_percent` | integer, default 0 | 0–100 |
| `config` | jsonb | **the full run snapshot** (see §4) |
| `error_log` | text | set on failure |

### `assets`
| Column | Type | Notes |
|---|---|---|
| `run_id` | uuid → runs.id | nullable (uploads can exist before a run) |
| `workspace_id` | uuid → workspaces.id | required for ownership checks |
| `type` | varchar(30) | `design`, `uploaded-design` (used in zip as `generated-designs` vs `source-designs`) |
| `name` | varchar(255) | display name |
| `storage_path` | text | key inside the storage provider |
| `content_type` | varchar(120) | mime type |
| `metadata` | jsonb | provenance: `{provider, prompt, generatedPrompt, negativePrompt, style, includeText, source, model}` for AI designs, `{source: 'upload'}` for uploads |

### `product_variants`
| Column | Type | Notes |
|---|---|---|
| `run_id` | uuid → runs.id | required |
| `design_asset_id` | uuid → assets.id | the design that fanned out |
| `product_type` | varchar(40) | `tshirt` \| `hoodie` \| `sweatshirt` \| `phone-case` \| `wall-art` |
| `status` | varchar(30), default `pending` | set to `ready` on creation |

### `mockups`
| Column | Type | Notes |
|---|---|---|
| `product_variant_id` | uuid → product_variants.id | required |
| `template_id` | uuid → mockup_templates.id | nullable; only linked for deterministic templates with a UUID id |
| `storage_path` | text | nullable until rendered |
| `status` | varchar(30), default `pending` | set to `ready` after render |

### `marketplace_listings`
| Column | Type | Notes |
|---|---|---|
| `product_variant_id` | uuid → product_variants.id | required |
| `marketplace` | varchar(40) | destination id: `etsy`, `tpublic`, `drive`, `download`, … |
| `external_id` | varchar(255) | reserved for future real marketplace adapters |
| `status` | varchar(30), default `draft` | `download` destinations get `ready`; others `draft` |
| `metadata` | jsonb | `{title, tags}` generated at run time |

### `mockup_templates`
| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid → workspaces.id | required |
| `name` | varchar(160) | e.g. "Studio front", "Photo · Simple white t-shirt mockup" |
| `type` | varchar(30) | `deterministic` \| `generative` |
| `product_type` | varchar(40) | which product it applies to |
| `config` | jsonb | see §5 |

Seeded per workspace by `ensureDefaultTemplates` (deterministic + generative defaults, plus
photo templates from the downloaded library, matched by product type).

### `prompt_templates`
| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid → workspaces.id | required |
| `name` | varchar(160) | required |
| `prompt` | text | the collection theme prompt |
| `provider` | varchar(40), default `fal` | which image provider to use |
| `model` | varchar(160) | nullable; provider model id |
| `description` | varchar(255) | nullable |

Three defaults are seeded: "Funny cat collection", "Minimal botanical set", "Flux Klein typography".

### `workspace_connections`
| Column | Type | Notes |
|---|---|---|
| `workspace_id` | uuid → workspaces.id | required |
| `provider` | varchar(40) | `fal` \| `openrouter` \| `huggingface` \| `ollama` (image providers) |
| `default_model` | varchar(160) | provider model id |
| `enabled` | varchar(10), default `true` | can be disabled from the Connections UI |

### `jobs`
| Column | Type | Notes |
|---|---|---|
| `run_id` | uuid → runs.id | required |
| `step_name` | varchar(80) | `workflow:start`, `mockup:{designId}:{productType}` |
| `status` | varchar(30), default `queued` | `queued` → `running` → `completed` / `failed` |
| `retry_count` | integer, default 0 | |
| `error_log` | text | set on failure |

## 3. Lifecycle of a run

See `DOCS/architecture/pipeline.md` for the full walkthrough. Summary of DB writes:

1. `POST /api/workflows/runs` → insert/select `workflow`, insert `run` (`queued`), insert
   `jobs(workflow:start)`, enqueue BullMQ job.
2. Worker picks it up → run `running`, 5%.
3. Designs: either reuse `assets` referenced by `assetIds` (set `runId`) or generate + insert one
   `asset` per image (type `design`).
4. Fan-out: for each design × product → insert `job`, insert `product_variant` (`ready`), render
   mockups (insert `mockup` rows), insert `marketplace_listing` rows per destination.
5. Finish → run `completed`, 100%. On unhandled error → run `failed`, 0%, `error_log` set, running
   jobs marked failed.

## 4. The run snapshot (`runs.config`)

`config` stores the exact validated `createRunSchema` payload from the API, so a run is
reproducible even if the workflow or UI evolves later:

```jsonc
{
  "name": "Funny cat collection",
  "prompt": "Funny cat designs for people who take their naps seriously",
  "source": "ai",                  // "ai" | "upload"
  "style": "illustration",         // one of 8 ImageStyle ids
  "includeText": false,
  "negativePrompt": "…",           // optional
  "count": 12,                     // number of AI designs
  "products": ["tshirt", "hoodie", "sweatshirt"],
  "destinations": ["etsy", "download"],
  "provider": "fal",               // optional; defaults to AI_PROVIDER env
  "model": "fal-ai/flux/schnell",  // optional; defaults to provider default
  "assetIds": ["…uuid…"],          // when source = upload
  "templates": [ /* MockupTemplateSelection[] */ ]
}
```

## 5. Mockup template `config` JSONB

Two shapes exist:

**Built-in / seeded templates** — `{ "quantity": 1 }` (quantity is also stored for display).

**Downloaded photo templates** (deterministic) — `DeterministicTemplateConfig`:

```jsonc
{
  "assetPath": "download_mockups/tshirts/simple-white-t-shirt-mockup.webp",
  "sourceKey": "tshirts:3",          // category:index in mockup_image_templates JSON
  "sourceTitle": "Simple white t-shirt mockup",
  "boundingBox": { "x": 0.2, "y": 0.23, "width": 0.6, "height": 0.48, "rotateDeg": 0 },
  "blend": "multiply",               // "over" | "multiply" | "screen" | "soft-light"
  "designOpacity": 1,
  "quantity": 1
}
```

`boundingBox` values are normalized (0–1) fractions of the output canvas, or absolute pixels if
outside the 0–1 range. See `DOCS/server/mockup-rendering.md`.

## 6. Bootstrapping

`src/server/db/bootstrap.ts` runs a list of `CREATE TABLE IF NOT EXISTS` statements plus two
migrations (`ALTER TABLE assets ADD workspace_id …`, backfill from runs→workflows, and
`ALTER TABLE workspace_connections ADD enabled …`), all inside
`pg_advisory_lock('pod-automator-bootstrap')` so parallel API/worker startups don't race.
Run it manually with `npm run db:bootstrap` (it is also invoked automatically by
`npm run start:api` and `npm run start:worker`).

`drizzle.config.ts` points Drizzle Kit at `src/server/db/schema.ts` (migrations output dir:
`src/server/db/migrations`) for future migration workflows.
