# Capability Interfaces

> **Source of truth:** `src/core/interfaces/providers.ts`

This is the heart of the architecture. Every external service — image generation, storage,
transformations, mockups, marketplaces — is expressed as a **capability interface**. Domain logic
never talks to vendor SDKs directly; it talks to these interfaces, and configuration decides which
implementation backs them.

The golden rule (from the original spec and `conversation.md`):

> **Provider ≠ capability.** A provider may implement several capabilities; a capability may have
> several providers. Never write `if (provider === 'fal') …` in workflow logic.

## 1. Shared types

```ts
type ImageFormat = 'png' | 'jpeg' | 'webp'
type ProductType = 'tshirt' | 'hoodie' | 'sweatshirt' | 'phone-case' | 'wall-art'
```

`ProductType` is used across the stack — in the DB (`product_variants.product_type`), the mockup
template catalog, placement defaults, and the wizard UI.

## 2. `ImageGenerationProvider`

```ts
interface ImageGenerationRequest {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  count: number
  referenceImageUrls?: string[]
  model?: string
}

interface ImageGenerationProvider {
  readonly id: string
  generateImages(request: ImageGenerationRequest): Promise<{
    urls: string[]          // http(s) URLs or data: URIs
    rawResponse: unknown    // provider payload, persisted as provenance
  }>
}
```

**Contract notes:**
- `generateImages` may return **fewer** URLs than `count`. The runner's `generateImages` helper
  (`src/server/ai.ts`) loops in batches of ≤ 4 until it has `count` URLs, so implementations can
  cap their `n`.
- `referenceImageUrls` is used for image-to-image (mockup generation passes the design URL).
- Implementations should throw descriptive errors when credentials are missing (the API layer
  surfaces these to the user).

**Implementations** (`src/server/ai.ts`):

| id | Class | Notes |
|---|---|---|
| `mock` | `MockImageProvider` | Returns SVG data-URL placeholders; zero cost smoke tests |
| `openrouter` | `OpenRouterImageProvider` | `POST https://openrouter.ai/api/v1/images`; sends `input_references` for reference images; `HTTP-Referer`/`X-Title` set to `WEB_URL`/`POD Automator` |
| `fal` | `FalImageProvider` | `POST https://fal.run/{model}`; `num_images`, `image_size`, `output_format: png`, `reference_image_url` |
| `huggingface` | `HuggingFaceImageProvider` | `@huggingface/inference` `textToImage`; returns **one** image (runner loops) |
| `ollama` | `OllamaImageProvider` | Local `POST {OLLAMA_BASE_URL}/api/generate` with `stream: false`, width/height options |

Factory: `imageProvider(id)` returns the right implementation; defaults to `config.AI_PROVIDER`.
`defaultModelForProvider(provider)` maps provider → configured model env var.

See `DOCS/server/ai-providers.md` for request/response details per provider.

## 3. `StorageProvider`

```ts
interface StorageProvider {
  put(path: string, buffer: Buffer, contentType: string): Promise<string> // returns key
  get(path: string): Promise<Buffer>
  delete(path: string): Promise<void>
  getPublicUrl(path: string): Promise<string>
}
```

**Implementations** (`src/server/storage.ts`), selected by `STORAGE_DRIVER`:

| Driver | Class | Notes |
|---|---|---|
| `local` | `LocalStorageProvider` | Root `STORAGE_DIR` (default `./data/uploads`); `getPublicUrl` = `${PUBLIC_ASSET_URL}/{key}` |
| `s3` | `S3StorageProvider` | AWS SDK v3 client, `forcePathStyle: true` (MinIO-compatible), bucket `S3_BUCKET`, endpoint `S3_ENDPOINT` |

`storage` is a singleton export; the whole codebase (API, worker, zip export) uses the same
instance.

## 4. `TransformationProvider`

```ts
interface TransformationProvider {
  removeBackground(imageBuffer: Buffer): Promise<Buffer>
  upscale(imageBuffer: Buffer, scaleFactor: number): Promise<Buffer>
  resize(imageBuffer: Buffer, width: number, height: number, fit?: 'cover' | 'contain' | 'fill'): Promise<Buffer>
  convertFormat(imageBuffer: Buffer, format: ImageFormat): Promise<Buffer>
}
```

**Current status:** the interface exists as a contract, and the closest concrete implementation is
the artwork preparation inside `mockup-renderer.ts` (Sharp-based resize, near-white background
removal for apparel, PNG conversion). There is no standalone `TransformationProvider` class wired
into the worker yet — the pipeline's "transform" stage is currently implicit in design/mockup
processing. This interface is the future home for pluggable background-removal/upscaling providers
(Fal.ai RMBG, remove.bg, ImageKit, etc.).

## 5. `MockupProvider` + `DeterministicMockupSpec`

```ts
interface DeterministicMockupSpec {
  baseImageBuffer: Buffer     // template photo
  designBuffer: Buffer        // artwork
  overlayBuffer?: Buffer
  boundingBox: { x: number; y: number; width: number; height: number; rotateDeg?: number }
}

interface MockupProvider {
  renderDeterministic(spec: DeterministicMockupSpec): Promise<Buffer>
  renderGenerative(templatePrompt: string, designUrl: string, options: Record<string, unknown>): Promise<Buffer>
}
```

**Concrete implementations:**
- `renderDeterministicMockup(designBuffer, options)` in `src/server/mockup-renderer.ts` — the
  Sharp compositor used by the worker for `kind: 'deterministic'` templates.
- `renderDeterministicFromSpec(spec, format)` — a lower-level spec-driven renderer (used by tests;
  implements the `DeterministicMockupSpec` contract).
- Generative mockups are currently implemented **in the worker** (`workflow-runner.ts`) via
  `buildMockupPrompt` + `ImageGenerationProvider` with the design as a reference image — the
  `MockupProvider.renderGenerative` interface is the future abstraction for that path.

Details in `DOCS/server/mockup-rendering.md`.

## 6. `MarketplaceAdapter`

```ts
interface MarketplaceListingPayload {
  title: string
  description: string
  tags: string[]
  price: number
  mainImageBuffer: Buffer
  mockupImageBuffers: Buffer[]
  sku?: string
  category?: string
}

interface MarketplaceAdapter {
  readonly id: string
  authenticate(credentials: Record<string, string>): Promise<boolean>
  getRequirements(): { maxTitleLength: number; requiredImageDimensions: { width: number; height: number } }
  createDraftListing(payload: MarketplaceListingPayload): Promise<{ externalListingId: string; draftUrl: string }>
  publishListing(externalListingId: string): Promise<{ success: boolean; url: string }>
}
```

**Current status:** the interface is defined, but **no concrete marketplace adapter is wired up
yet**. Today "destinations" (`etsy`, `tpublic`, `drive`, `download`) are just ids that produce
`marketplace_listings` rows (`download` → `ready`, others → `draft`) and appear in the ZIP
manifest. The interface is the contract the future Etsy / TeePublic / Shopify / Drive adapters
must implement (see `DOCS/development/extending.md` §2).

## 7. How configuration selects implementations

```
.env / workspace_connections  →  config.ts (Zod)  →  factories  →  interface instances
```

- Storage: `config.STORAGE_DRIVER` → `new LocalStorageProvider()` or `new S3StorageProvider()`.
- Image generation: `AI_PROVIDER` env default, overridable **per run** (`provider` in the wizard),
  overridable **per workspace** (default model in `workspace_connections`, toggled in the
  Connections UI), validated against a fixed model allowlist per provider.
- Marketplace/storage destination availability is a per-workspace row in
  `workspace_connections`/`marketplace_listings` — no hardcoding in the UI.

## 8. Design rationale

- **Buffers, not URLs, at the boundaries** — deterministic compositing and ZIP export both need
  raw bytes, and the storage layer is the only thing that knows where files live.
- **`rawResponse` provenance** — every AI generation keeps the provider's raw payload so runs are
  auditable/reproducible.
- **Small, capability-shaped interfaces** — `ImageGenerationProvider` doesn't include editing or
  upscaling; a future provider (e.g. ComfyUI) can implement exactly the capabilities it supports.
