# Deterministic Mockup Rendering (Sharp)

> **Source of truth:** `src/server/mockup-renderer.ts`

Deterministic mockups composite a design onto a photographic template at a precise bounding box
using **Sharp**. This is the fast, free, pixel-perfect mockup path (vs. AI-generative mockups).

## 1. Entry points

```ts
renderDeterministicMockup(designBuffer: Buffer, options: {
  productType: ProductType | string
  templateName: string
  templateConfig?: unknown          // DeterministicTemplateConfig
  outputWidth?: number              // default: template's native width (750 from downloads)
  outputHeight?: number
}): Promise<Buffer>                 // WebP, quality 94
```

Used by the worker for every `kind: 'deterministic'` template selection.

```ts
renderDeterministicFromSpec(spec: DeterministicMockupSpec, outputFormat: 'webp' | 'png' = 'webp')
```

A lower-level spec-driven renderer that takes buffers directly (`baseImageBuffer`,
`designBuffer`, `boundingBox`) and supports PNG output. Used by the test suite; implements the
`MockupProvider`/`DeterministicMockupSpec` contract from `DOCS/interfaces/providers.md` §5.

## 2. Placement math

Placement comes from `config.boundingBox` or product-type defaults:

```ts
const defaultPlacements = {
  tshirt:      { x: 0.20, y: 0.23, width: 0.60, height: 0.48 },
  hoodie:      { x: 0.18, y: 0.20, width: 0.64, height: 0.52 },
  sweatshirt:  { x: 0.19, y: 0.21, width: 0.62, height: 0.50 },
  'phone-case':{ x: 0.29, y: 0.20, width: 0.42, height: 0.60 },
  'wall-art':  { x: 0.24, y: 0.16, width: 0.52, height: 0.58 },
}
```

- Values in `[0,1]` are treated as **normalized fractions** of the output canvas and multiplied
  by width/height; otherwise they're interpreted as **absolute pixels**.
- `placementFor` reads `config.boundingBox` fields with fallback to defaults (non-finite numbers
  fall back too).
- `clampPlacement` ensures the box stays within the canvas (min 1px size).

Template-library `placementProfile` (in `mockup-library.ts`) computes the seeded `boundingBox`
for downloaded photos — e.g. phone-case `{0.3, 0.18, 0.4, 0.64}`, wall-art `{0.24, 0.16, 0.52,
0.58}`, apparel varies by title keywords (flat/folded/hanging/mannequin → centered smaller box).

## 3. Artwork preparation (`prepareArtwork`)

1. **Rotate** (optional `rotateDeg`) with transparent background.
2. **Resize** to the placement box: `fit: 'contain'`, centered, transparent background,
   `kernel: 'lanczos3'`.
3. **Ensure alpha**, then operate on raw pixels.

### Near-white background removal (apparel only)

AI images are usually opaque squares. For `tshirt`/`hoodie`/`sweatshirt`, near-white pixels are
turned transparent so the print hugs the artwork:

```
r,g,b > 238        → alpha = 0        (white canvas)
r,g,b > 220        → alpha = (238 − max(r,g,b)) / 18 × 255   (smooth ramp)
```

This is what makes AI-generated designs print correctly on garments. Wall-art and phone-case
**keep the full artwork** (no removal).

### Opacity

`config.designOpacity` (clamped 0–1) scales the alpha channel when < 1.

Output: PNG (compression 9, adaptive filtering).

## 4. Compositing

```
sharp(templatePath)
  .rotate()                      // respect EXIF orientation
  .resize({ width: outputWidth, height: outputHeight, fit: 'fill', kernel: 'lanczos3' })
  .composite([{ input: artwork, left, top, blend }])
  .webp({ quality: 94, effort: 4 })
```

Blend mode per product (`blendFor`, overridable via `config.blend`):

| Product | Default blend |
|---|---|
| tshirt / hoodie / sweatshirt | `multiply` |
| wall-art / phone-case | `over` |

(`screen` and `soft-light` are supported values for future templates.)

`multiply` keeps garment folds/texture visible through the print; `over` is right for flat
products where the design should be fully opaque on top.

## 5. Template asset resolution

`resolveMockupAssetPath(config, productType, title)` in `mockup-library.ts`:

1. If `config.assetPath` exists (e.g. `download_mockups/tshirts/foo.webp`): resolve against the
   repo's `download_mockups/` root and **verify the resolved path stays inside it** (path
   traversal guard — see `DOCS/server/mockup-library.md`).
2. Otherwise fall back to `defaultMockupTemplate(productType, title)` — the best-matching
   downloaded photo for the product type (sweatshirt falls back to tshirt category).

Missing/blocked paths throw: "Deterministic mockup asset is unavailable for {templateName or
productType}".

## 6. Output format

Always **WebP quality 94** (effort 4) from `renderDeterministicMockup` — the worker stores it
with `content_type: 'image/webp'` and `.webp` extension. `renderDeterministicFromSpec` can also
emit PNG (used for tests).

## 7. Tests

`tests/unit/mockup-renderer.test.ts`:
- renders a deterministic WebP at 750×750 using a downloaded tshirt template,
- keeps transparent artwork from painting the whole placement rectangle,
- path-traversal cases (`{assetPath: '…/secret.webp'}`, `/tmp/secret.webp`) return `undefined`
  from `resolveMockupAssetPath`.
