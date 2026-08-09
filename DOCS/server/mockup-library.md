# Mockup Template Library

> **Source of truth:** `src/server/mockup-library.ts`

The mockup template library manages the **downloaded photographic templates** used by
deterministic rendering: how they're discovered, matched, configured, and safely resolved.

## 1. Data sources

```
mockup_image_templates/{category}.json   ← source JSON: [{ "src": url, "title": "…" }]
        │  (downloaded by download_mockup_scripts — see DOCS/development/setup.md)
        ▼
download_mockups/{category}/{slug}.webp  ← local photo files (webp/png/jpg)
```

Categories (`MockupCategory`): `tshirts`, `hoodies`, `posters`, `canvas`, `phone`.

Each category maps to a `ProductType`:

| Category | ProductType |
|---|---|
| tshirts | tshirt |
| hoodies | hoodie |
| posters | wall-art |
| canvas | wall-art |
| phone | phone-case |

## 2. Registry & matching

`downloadedMockupTemplates()` (cached) builds a library of `DownloadedMockupTemplate`:

```ts
{
  id: 'downloaded-{category}-{index+1}',
  category, productType,
  title,                      // human title from JSON
  assetPath: 'download_mockups/{category}/{file}',
  assetFile,
  sourceUrl,
  sourceKey: '{category}:{index+1}',
}
```

**Title → file matching** (`localAssetForTitle`) is deliberate, never accidental:

1. Try exact slug match (`{slugify(title)}.webp`).
2. Otherwise score every unused file by **token overlap** between title and filename
   (`assetScore` = overlap / max token counts, ignoring stopwords `the with and for from` and
   short tokens ≤ 2 chars). Only candidates with score ≥ **0.28** qualify; pick the best, tie-broken
   alphabetically.

This handles the rename drift between human-friendly JSON titles and sanitized download
filenames.

## 3. Placement profiles

`placementProfile(template)` computes the seeded `boundingBox` for each downloaded template
(normalized 0–1 fractions):

| Case | Box |
|---|---|
| phone-case | `{x:0.3, y:0.18, w:0.4, h:0.64}` |
| wall-art | `{x:0.24, y:0.16, w:0.52, h:0.58}` |
| apparel w/ title matching `flat\|folded\|hanging\|rack\|mannequin\|front view` | `{x:0.24, y:0.2, w:0.52, h:0.52}` |
| hoodie (default) | `{x:0.18, y:0.2, w:0.64, h:0.52}` |
| other apparel (default) | `{x:0.2, y:0.23, w:0.6, h:0.48}` |

`configForDownloadedTemplate` bundles `assetPath`, `sourceKey`, `sourceTitle`, `boundingBox`,
`quantity: 1` into the template's `config` JSONB.

## 4. Path safety (read carefully before extending)

`resolveMockupAssetPath(config, productType, title)`:

- **Explicit path:** requires `assetPath` to start with `download_mockups/`; resolves against
  `mockupAssetRoot` (the repo's `download_mockups/` folder), then verifies the resolved candidate
  is **inside the root** (`relative()` must not start with `..` and must not be absolute) and
  exists. Otherwise returns `undefined`.
- **Fallback:** `defaultMockupTemplate(productType, title)` → best-matching downloaded photo
  (`sweatshirt` normalizes to `tshirt`); returns `undefined` if the library is empty.

The API route `GET /mockup-assets/:category/:file` has its own guard: category must be in the
whitelist and filename must match `^[a-zA-Z0-9._-]+$`. **Keep both guards when extending.**

## 5. Helpers

| Function | Purpose |
|---|---|
| `defaultMockupTemplate(productType, title)` | Preferred downloaded template for a product (title-substring match, else first) |
| `assetCategoryForProduct(productType)` | Reverse map product → category (posters/canvas → wall-art) |
| `assetFileName(path)` | basename without extension |
| `parseTemplateConfig(value)` | Safe cast of unknown → `DeterministicTemplateConfig` |
| `mockupTemplatePreviewPath(config)` | Turns a config's `assetPath` into the `/mockup-assets/{cat}/{file}` URL shown in the UI (only for `download_mockups/…` paths) |

## 6. Seeding

`ensureDefaultTemplates` (in `src/server/auth.ts`) seeds each new workspace with:

- the 8 built-in templates (deterministic studio + generative lifestyle per product),
- up to 10 downloaded photo templates (filtered to tshirt/hoodie/phone-case/wall-art, first 10),
  deduplicated by `assetPath`,
- and backfills existing deterministic templates with photo assets when they lack an `assetPath`.

## 7. Serving to the UI

Template previews are served via `GET /mockup-assets/{category}/{file}` (immutable cache header)
and proxied by Vite/nginx. The dashboard catalog attaches `previewUrl` per template.

## Related docs

- Rendering internals: `DOCS/server/mockup-rendering.md`
- Mockup feature overview: `DOCS/features/mockups.md`
- Adding a new template category: `DOCS/development/extending.md` §3
