# Worker & Workflow Runner

> **Source of truth:** `src/server/workflow-runner.ts` (+ `src/server/queue.ts`, `src/server/worker.ts`)

## 1. Process roles

- `src/server/queue.ts` — creates the shared Redis connection (ioredis) and the BullMQ
  `Queue('pod-workflows')`.
- `src/server/worker.ts` — process entrypoint; imports `workflow-runner.ts` (which constructs the
  `Worker`) and logs startup. Run with `npm run dev:worker` or the Docker `worker` target.
- `src/server/workflow-runner.ts` — defines `processRun(job)` and instantiates:

```ts
export const worker = new Worker<RunPayload>('pod-workflows', processRun, {
  connection: redis,
  concurrency: 2,
})
```

Plus event handlers: `completed` → log; `failed` → log + terminal state update (run `failed`,
0%, error_log; any jobs still `running` → `failed`).

## 2. RunPayload (job data)

Exactly the validated `createRunSchema` payload plus routing fields:

```ts
interface RunPayload {
  runId: string
  workspaceId: string
  prompt: string
  source?: 'ai' | 'upload'
  style?: ImageStyle
  includeText?: boolean
  negativePrompt?: string
  count: number
  products: string[]
  destinations: string[]
  provider?: string
  model?: string
  assetIds?: string[]
  templates?: Array<MockupTemplateSelection-like>
}
```

## 3. Execution algorithm (step by step)

### Setup
1. `effectiveProvider = job.data.provider ?? config.AI_PROVIDER`
2. `model = job.data.model ?? defaultModelForProvider(effectiveProvider)`
3. `effectiveIncludeText = source === 'upload' ? true : includeText` — uploaded artwork may
   contain text; never penalize it.
4. `negativePrompt = defaultNegativePrompt(effectiveIncludeText, customNegativePrompt)`
5. `designPrompt = buildDesignPrompt({ prompt, style, includeText: effectiveIncludeText,
   negativePrompt, width: 1024, height: 1024 })`
6. Run → `running`, 5%; `workflow:start` job → `running`.

### Design stage
**Uploads** (`assetIds` present):
- Load assets where `workspace_id = workspaceId AND id IN assetIds`; verify count matches (else
  throw "Selected assets could not be found in this workspace").
- Set `runId` on each asset row.
- `workflow:start` → `completed`.

**AI generation**:
- `generation = await generateImages(provider, { prompt: designPrompt, negativePrompt,
  width: 1024, height: 1024, count, model })`
- For each url (index i): download bytes → sniff format → store at
  `runs/{runId}/designs/design-{i+1 padded 3}.{ext}` → insert `assets` row with full provenance.
- `workflow:start` → `completed`.

### Fan-out stage (run at 35%)
For each `designId × productType`:

1. Insert `jobs` row: `stepName: "mockup:{designId}:{productType}"`, status `running`.
2. Insert `product_variants` (`designAssetId`, `productType`, `status: 'ready'`).
3. `designBuffer = storage.get(designAsset.storagePath)`.
4. Templates: `productTemplates = templates.filter(productType === t)`; if empty, fall back to
   `[{ id: 'fallback-studio', name: 'Studio front', kind: 'deterministic', productType,
   quantity: 1 }]`.
5. For each template × `0..quantity-1`:
   - **generative:** `mockupPrompt = buildMockupPrompt({ templateName, productType,
     designPrompt: prompt, style, includeText: effectiveIncludeText, negativePrompt })`; call
     `generateImages(provider, { prompt: mockupPrompt, negativePrompt,
     referenceImageUrls: [publicUrl(design)], width: 1600, height: 1600, count: 1, model })`;
     download result.
   - **deterministic:** `mockupBuffer = renderDeterministicMockup(designBuffer, { productType,
     templateName: template.name, templateConfig: template.config })` (WebP).
   - Store at `runs/{runId}/mockups/{variantId}-{templateId}-{n+1}.{ext}`; insert `mockups` row
     (`template_id` only when template.id is a UUID, `status: 'ready'`).
6. For each destination: insert `marketplace_listings` (`download` → `ready`, else `draft`;
   metadata title/tags).
7. Mark the per-variant job `completed`; update progress:
   `min(94, 35 + round(completed / (designs × products) × 55))`.

### Terminal states
- Success: run `completed`, 100%.
- Throw: BullMQ retries (3 attempts, exponential backoff). On the final attempt the `failed`
  handler persists run `failed`/0%/error and marks running jobs failed.

## 4. Helper utilities in this file

| Function | Purpose |
|---|---|
| `updateRun(runId, progress, status, errorLog?)` | DB update on `runs` |
| `updateJob(runId, stepName, status, errorLog?)` | DB update on `jobs` (by stepName) |
| `bufferFromUrl(url)` | Download http(s) URL or decode `data:` URI → Buffer |
| `imageFormat(buffer)` | Magic-byte sniffing → `{extension, contentType}` (svg/png/jpg/webp/bin) |
| `bufferDataUrl(buffer, contentType)` | Encode Buffer → data URI (currently unused; kept for data-URI round-trips) |

## 5. Concurrency & retries

- `concurrency: 2` — two runs (or jobs) processed in parallel per worker instance.
- Queue job options set by the API: `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`,
  `jobId: run.id` (idempotent enqueue), `removeOnComplete/Fail: 100`.

## 6. Failure semantics (important)

- A failure inside `processRun` marks the **whole run failed** (no partial-completion state today),
  but upstream BullMQ retries run first (attempts 1–3).
- Individual job rows are marked failed in the terminal `failed` handler — the UI surfaces
  `errorLog` per job, which is the foundation for the future "retry this job / retry with another
  provider" UX.

## Related docs

- High-level pipeline: `DOCS/architecture/pipeline.md`
- AI provider behavior: `DOCS/server/ai-providers.md`
- Deterministic rendering: `DOCS/server/mockup-rendering.md`
- Run monitor UI: `DOCS/features/run-monitor.md`
