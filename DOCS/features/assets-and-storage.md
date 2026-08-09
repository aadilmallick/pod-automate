# Feature: Assets & Storage

Assets are the persisted files of the system — AI-generated designs, uploaded designs, and
rendered mockups — each with provenance metadata. Storage is fully abstracted behind the
`StorageProvider` interface.

## 1. Asset lifecycle

| Stage | Type | Created by | `storage_path` convention |
|---|---|---|---|
| Upload | `uploaded-design` | `POST /api/assets/upload` | `uploads/{timestamp}-{sanitized-name}` |
| AI design | `design` | worker design stage | `runs/{runId}/designs/design-{NNN}.{ext}` |
| Mockup | (separate `mockups` table) | worker fan-out stage | `runs/{runId}/mockups/{variantId}-{templateId}-{n}.{ext}` |

Every `assets` row carries:

- `workspace_id` — ownership (used for authorization on upload/reuse),
- `run_id` — nullable (uploads can precede any run; the worker assigns `runId` when used),
- `content_type` — sniffed from bytes by the worker (`imageFormat`: svg/png/jpg/webp detection
  via magic bytes) or from the upload form,
- `metadata` (JSONB) — provenance:
  - AI designs: `{ provider, prompt, generatedPrompt, negativePrompt, style, includeText,
    source, model }`
  - uploads: `{ source: 'upload' }`

## 2. The StorageProvider

```ts
interface StorageProvider {
  put(path: string, buffer: Buffer, contentType: string): Promise<string> // returns key
  get(path: string): Promise<Buffer>
  delete(path: string): Promise<void>
  getPublicUrl(path: string): Promise<string>
}
```

Two implementations in `src/server/storage.ts`, selected by `STORAGE_DRIVER`:

### LocalStorageProvider (`local`)
- Root: `STORAGE_DIR` (default `./data/uploads` — gitignored).
- `put` writes the file (mkdir -p), `get` reads it, `delete` unlinks (errors swallowed).
- `getPublicUrl` → `${PUBLIC_ASSET_URL}/${key}` (default `http://…/uploads/…`).
- Served to browsers by the API's `GET /uploads/*` route.

### S3StorageProvider (`s3`)
- AWS SDK v3 with `forcePathStyle: true` (works with MinIO and AWS S3 alike).
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
- `getPublicUrl` → `${PUBLIC_ASSET_URL}/${key}` (the URL points at the API's `/uploads/*` route,
  which proxies through `storage.get` — so the same asset URLs work in both drivers).

The module exports a singleton `storage` used everywhere (API routes, worker, zip export).

## 3. Upload API

`POST /api/assets/upload` (`multipart/form-data`, field `file`):

1. Auth + workspace resolution.
2. Validates `file instanceof File` (Hono `parseBody`).
3. Key: `uploads/{Date.now()}-{sanitized name}`.
4. **Local driver:** writes directly to disk under `STORAGE_DIR`. **S3 driver:** `storage.put`.
5. Inserts an `assets` row (`type: 'uploaded-design'`, `metadata: { source: 'upload' }`).
6. Returns `201 { id, name, path, url }`.

Accepted by the wizard upload zone (PNG/JPG/WEBP, multiple files); each upload becomes a
selectable design in the review step.

## 4. Serving assets

| Route | Purpose | Auth |
|---|---|---|
| `GET /uploads/*` | Serve stored assets (`storage.get`, content-type by extension, immutable cache header) | none (public) |
| `GET /mockup-assets/:category/:file` | Serve downloaded template photos from `download_mockups/` (category whitelist + filename regex, immutable cache) | none (public) |

`/uploads` and `/mockup-assets` are proxied by the Vite dev server and nginx to the API.

## 5. Asset library UI

The `assets` view renders `catalog.assets` (from `GET /api/dashboard/catalog`, latest 100) as a
thumbnail grid; clicking opens an **FsLightbox** full-screen preview. Uploaded/generated/mockup
filters exist in the toolbar as UI (filtering is presentational today).

## 6. Ownership & safety

- Runs verify uploaded `assetIds` belong to the workspace before enqueueing (API) and before
  processing (worker) — mismatches abort with a clear error.
- Template photo paths are validated against `download_mockups/` (path-traversal guard) —
  see `DOCS/server/mockup-library.md`.

## Related docs

- Storage interface contract: `DOCS/interfaces/providers.md` §3
- Data model (assets table): `DOCS/architecture/data-model.md`
- ZIP export bundles these files: `DOCS/features/listings-and-destinations.md` §4
