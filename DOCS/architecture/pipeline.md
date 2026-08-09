# Production Pipeline & Job Execution

This document explains how a run actually executes: the conceptual pipeline, the DAG model, the
BullMQ job flow, and the exact steps taken by the worker (`src/server/workflow-runner.ts`).

## 1. The conceptual pipeline

The product (from `FREEBUFF.md` / `conversation.md`) is a fixed high-level flow, expressed as a
reusable, versioned workflow:

```
[1. Design Creation]   AI generation or uploaded assets
        ↓
[2. Review checkpoint] user selects which designs survive (policy: review)
        ↓
[3. Transform]         artwork preparation (background handling, resize) — Sharp/local
        ↓
[4. Fan-out]           1 design → N product variants (tshirt, hoodie, …)
        ↓
[5. Mockups]           deterministic templates (Sharp) and/or AI-generative templates
        ↓
[6. Metadata]          listing title/tags per destination
        ↓
[7. Publish/Export]    marketplace listing rows + structured ZIP download
```

## 2. The workflow graph model

`src/core/workflow.ts` defines a **general DAG** that the wizard happens to produce as a linear
chain today:

```ts
interface WorkflowNode {
  id: string
  type: 'design-generation' | 'transform' | 'fan-out' | 'mockup' | 'metadata' | 'publish'
  label: string
  provider?: string
  policy: 'auto' | 'review' | 'skip'
}
interface WorkflowDefinition {
  version: number
  nodes: WorkflowNode[]
  edges: Array<{ from: string; to: string }>
}
```

`defaultWorkflow` (used for every run created from the UI) is the six-node chain above with
`policy: 'review'` on design generation and mockups, `'auto'` elsewhere.

**Why the graph isn't executed node-by-node today:** the current worker executes the pipeline
procedurally. The graph model is the persistence/versioning contract that keeps the door open for a
general engine later ("Model B engine, Model A UX" — see `conversation.md`).

## 3. Queue infrastructure

- `src/server/queue.ts` creates a Redis connection (ioredis) and a BullMQ `Queue('pod-workflows')`.
- `src/server/worker.ts` is a tiny entrypoint that imports `workflow-runner.ts` (which constructs a
  BullMQ `Worker` with `concurrency: 2`) and logs a startup message. It is run via
  `npm run dev:worker` / Docker `worker` target.
- Jobs are enqueued by the API with `jobId: run.id`, `attempts: 3`, exponential backoff
  (1s base), and `removeOnComplete/Fail: 100`.

## 4. Enqueue path (API side)

`POST /api/workflows/runs` (`src/server/index.ts`):

1. Validates the payload with `createRunSchema` (Zod).
2. Authenticates the user and resolves their workspace.
3. If a `provider` is supplied:
   - rejects disabled connections (`workspace_connections.enabled = 'false'`),
   - rejects providers with no credentials configured (`providerConfigured`),
   - rejects unsupported model ids (`validProviderModel`).
4. If `assetIds` are supplied, verifies they all belong to the workspace.
5. Reuses a workflow with the same `(workspaceId, name)` or creates one from `defaultWorkflow`.
6. Inserts the `run` (status `queued`, `config` = validated payload) and a
   `jobs(workflow:start)` row.
7. Enqueues the BullMQ job and returns `202 { run }`.

## 5. Execution path (worker side)

`processRun(job)` in `src/server/workflow-runner.ts`:

### 5.1 Setup
- Resolves the effective provider: `job.data.provider ?? config.AI_PROVIDER`.
- Resolves the model: `job.data.model ?? defaultModelForProvider(provider)`.
- Builds the negative prompt: `defaultNegativePrompt(includeText, customNegativePrompt)`.
  - For `source === 'upload'`, `includeText` is forced to `true` (existing artwork may contain
    text and must not be penalized).
- Builds the design prompt via `buildDesignPrompt({ prompt, style, includeText, negativePrompt,
  width: 1024, height: 1024 })`.
- Marks the run `running` at 5% and the `workflow:start` job `running`.

### 5.2 Design stage
**Uploaded designs** (`assetIds` present):
- Loads the assets, verifies they belong to the workspace, sets `runId` on each. The
  `workflow:start` job completes immediately.

**AI generation**:
- Calls `generateImages(provider, { prompt: designPrompt, negativePrompt, width: 1024, height:
  1024, count, model })` — the helper in `src/server/ai.ts` loops in batches of ≤ 4 until `count`
  images are produced.
- For each returned URL: downloads bytes (`bufferFromUrl` — handles both http(s) URLs and
  `data:` URIs), sniffs the format (`imageFormat` — svg/png/jpg/webp), stores at
  `runs/{runId}/designs/design-{NNN}.{ext}` via the `StorageProvider`, and inserts an `asset` row
  with full provenance in `metadata` (`provider`, `prompt`, `generatedPrompt`, `negativePrompt`,
  `style`, `includeText`, `source`, `model`).

### 5.3 Fan-out + mockup stage
Progress moves to 35%. For **each design × each product type**:

1. Insert a `jobs` row `mockup:{designId}:{productType}` with status `running`.
2. Insert a `product_variant` (`status: 'ready'`).
3. Load the design bytes from storage.
4. Select templates: the run's `templates` filtered to this product type; if none are configured,
   fall back to a single deterministic `Studio front` template (quantity 1).
5. For each template × quantity index:
   - **Generative:** builds a mockup prompt via
     `buildMockupPrompt({ templateName, productType, designPrompt: prompt, style, includeText,
     negativePrompt })`, calls the image provider with
     `referenceImageUrls: [publicUrl(design)]`, `width/height: 1600`, `count: 1`. Stores the
     result at `runs/{runId}/mockups/{variantId}-{templateId}-{n}.{ext}`.
   - **Deterministic:** calls
     `renderDeterministicMockup(designBuffer, { productType, templateName, templateConfig })`
     (Sharp compositing — see `DOCS/server/mockup-rendering.md`). Output is WebP.
   - Inserts a `mockups` row (`status: 'ready'`). `template_id` is only linked when the template
     id is a UUID (downloaded photo templates use ids like `downloaded-tshirts-3` and are not
     linked to the `mockup_templates` table).
6. For **each destination** (`etsy`, `tpublic`, `drive`, `download`, …): insert a
   `marketplace_listing` row — `download` gets `status: 'ready'`, everything else `draft` — with
   metadata `{ title: "{prompt.slice(0,65)} · {productType}", tags: ['print on demand',
   productType, 'original design'] }`.
7. Mark the per-design job `completed`, bump progress to `min(94, 35 + completed/total × 55)`.

### 5.4 Completion / failure
- Success → run `completed`, `progress_percent: 100`.
- Unhandled error → run `failed`, `progress_percent: 0`, `error_log: message`; all jobs still
  `running` are marked `failed` with the message. BullMQ retries (3 attempts, exponential backoff)
  happen before this terminal state is recorded.

## 6. Progress mapping (informational)

| Stage | Run progress |
|---|---|
| Job started | 5% |
| Designs done (AI or uploads linked) | 35% |
| Per variant+template work | 35% → 94% |
| Done | 100% |

## 7. Design decisions worth preserving

- **Batch generation:** `generateImages` requests at most 4 images per upstream call and loops,
  which keeps memory bounded for large `count` values and works around providers with low `n`.
- **Deterministic default fallback:** if a run configures no templates, the worker still produces
  one deterministic mockup per variant rather than failing.
- **Uploads skip AI design generation entirely** but still fan out into variants/mockups — the
  source-design assets are reused in place.
- **`download` is a first-class destination** that always produces a `ready` listing row, making
  ZIP export the guaranteed fallback regardless of marketplace adapter maturity.
