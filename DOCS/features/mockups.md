# Feature: Mockups & Templates

Mockups are the product-presentation images. Pod Automator supports **two rendering strategies**,
chosen per run via templates — never ad-hoc generations in the happy path:

1. **Deterministic** — composite the exact design onto a photographic template at a known bounding
   box (Sharp). Fast, free, pixel-perfect.
2. **Generative (AI)** — instruct an image model to render the design into a lifestyle scene
   (template prompt + the design as a reference image). Expensive, but visually rich.

## 1. Template model

`MockupTemplateSelection` (also the dashboard's `templates` shape):

```ts
{
  id: string
  name: string                 // "Studio front", "Photo · Simple white t-shirt mockup"
  kind: 'deterministic' | 'generative'
  productType: ProductType     // tshirt | hoodie | sweatshirt | phone-case | wall-art
  quantity: number             // renders per design-variant
  config?: Record<string, unknown>  // deterministic: boundingBox/blend/designOpacity/assetPath
}
```

### Built-in catalog (`src/data/catalog.ts` `templateCatalog`)

| id | name | kind | product |
|---|---|---|---|
| `studio-front` | Studio front | deterministic | tshirt |
| `street-style` | Street style | generative | tshirt |
| `hoodie-studio` | Studio front | deterministic | hoodie |
| `hoodie-coffee` | Coffee shop | generative | hoodie |
| `crewneck-studio` | Studio front | deterministic | sweatshirt |
| `crewneck-coffee` | Coffee shop | generative | sweatshirt |
| `phone-hand` | In hand | deterministic | phone-case |
| `wall-living` | Living room | generative | wall-art |

### Downloaded photo templates (deterministic)

The `download_mockups/` folder holds hundreds of photographic templates (tshirts, hoodies,
posters, canvas, phone) fetched by `download_mockup_scripts/` from `mockup_image_templates/*.json`
sources. `src/server/mockup-library.ts`:

- reads the category JSON + local files,
- **matches titles to local files** via token-overlap scoring (`assetScore`, threshold ≥ 0.28) —
  never picks the first unrelated photo,
- generates ids like `downloaded-tshirts-3`,
- computes a sensible `boundingBox` per product type via `placementProfile` (e.g. phone-case:
  x 0.3 / y 0.18 / w 0.4 / h 0.64; wall-art: x 0.24 / y 0.16 / w 0.52 / h 0.58; apparel varies
  with title keywords like flat/folded/mannequin).

On workspace creation, `ensureDefaultTemplates` seeds a mix: the built-in templates + up to 10
photo templates (from `downloadedMockupTemplates()` filtered to tshirt/hoodie/phone-case/wall-art,
deduplicated by `assetPath`).

## 2. Deterministic rendering

`renderDeterministicMockup(designBuffer, { productType, templateName, templateConfig })`
in `src/server/mockup-renderer.ts`:

1. Resolves the template photo via `resolveMockupAssetPath` (path-traversal guarded; falls back to
   a product-type default template when no explicit config).
2. Computes placement: normalized (0–1) fractions × output size, or absolute pixels; clamped to
   canvas bounds.
3. Prepares the artwork with Sharp: rotate (optional), resize `fit: contain` centered with
   transparent background (lanczos3), `ensureAlpha`.
4. **Near-white background removal** for apparel (tshirt/hoodie/sweatshirt): pixels ≥ 238 are made
   transparent; 220–238 get a smooth alpha ramp. This is what lets AI-generated opaque squares
   print correctly on garments. Wall-art/phone-case keep the artwork as-is.
5. Applies `designOpacity` if < 1.
6. Composites onto the (resized, `fit: fill`) template with the configured blend — **multiply** for
   apparel, **over** for wall-art/phone-case (screen/soft-light supported in config).
7. Outputs WebP quality 94.

Full detail: `DOCS/server/mockup-rendering.md`.

## 3. Generative rendering

In `src/server/workflow-runner.ts`, for `kind: 'generative'` templates:

```
prompt = buildMockupPrompt({ templateName, productType, designPrompt, style, includeText, negativePrompt })
imageProvider.generateImages({
  prompt, negativePrompt,
  referenceImageUrls: [publicUrl(designAsset)],   // design as reference
  width: 1600, height: 1600, count: 1, model,
})
```

The design URL is passed as a **reference image** so the model preserves the artwork; the prompt
explicitly forbids redesigning/replacing/cropping it (see `DOCS/interfaces/prompting.md` §5).

## 4. Wizard selection (per product type)

In wizard step 4 (`ProductsStep`), the user:

1. chooses product types,
2. sees the live fan-out estimate (variants + mockup outputs),
3. toggles templates filtered to the selected products; each template contributes `quantity`
   renders per design-variant.

Selected templates are sent as `templates` in `createRun` and stored in `runs.config.templates`.

## 5. Rendering fallbacks

- No templates configured for a product → worker uses `fallback-studio` (deterministic, qty 1).
- Template id is a UUID → linked to `mockup_templates` in the `mockups` row; downloaded photo
  templates (non-UUID ids) are intentionally not linked.

## 6. Where mockups land

- Stored under `runs/{runId}/mockups/{variantId}-{templateId}-{n}.webp|png|svg` in the active
  `StorageProvider`.
- Rows in `mockups` (`status: 'ready'`, `storage_path` set).
- Surfaced in the run monitor grid and bundled into the ZIP export.

## Related docs

- Renderer internals: `DOCS/server/mockup-rendering.md`
- Template library/registry: `DOCS/server/mockup-library.md`
- Adding new template categories: `DOCS/development/extending.md` §3
