# API Reference

> **Source of truth:** `src/server/index.ts` (Hono app)

All API routes are under `/api`, CORS-enabled for the web origin with credentials. Requests must
carry session cookies (`credentials: 'include'`). Errors are returned as
`{ "error": "message" }`; the Hono `onError` handler maps "Authentication required" → 401 and
everything else → 500 (with a server-side console log).

## Auth

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness: `{ ok, service, time }` (no auth) |
| GET | `/api/auth/status` | `{ mode: 'development'\|'google', googleConfigured, authenticated, user: {id,name,email}\|null }` — also ensures the workspace exists for a valid session |
| GET | `/api/auth/google` | Redirect to Google OAuth consent (503 text if credentials missing) |
| GET | `/api/auth/google/callback` | OAuth callback; exchanges code, upserts user, sets session cookie, redirects to `WEB_URL` |
| POST | `/api/auth/dev-session` | Creates a signed dev session for the current (dev-mode) identity |
| POST | `/api/auth/logout` | Clears session + sets a logged-out cookie |
| GET | `/api/me` | Current user record |

Auth internals: `DOCS/server/auth.md`.

## Dashboard & workflows

| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/catalog` | The whole workspace snapshot for the UI: stats, connections, runs (+jobs), assets (+urls), templates (+previewUrl), promptTemplates, listings |
| GET | `/api/workflows` | `{ workflows, userId }` — workflows for the workspace |

## Runs

### `POST /api/workflows/runs` — create & queue a run
Request body (Zod `createRunSchema`):

```ts
{
  name: string        // 1–160
  prompt: string      // 1–2000 (collection theme)
  source?: 'ai' | 'upload'        // default 'ai'
  style?: ImageStyle              // default 'illustration'
  includeText?: boolean           // default false
  negativePrompt?: string         // max 2000
  count: number                   // int 1–100 (AI designs)
  products: string[]              // ≥1 ProductType ids
  destinations?: string[]         // default ['download']
  provider?: 'fal'|'openrouter'|'huggingface'|'ollama'|'mock'
  model?: string                  // max 160
  assetIds?: string[]             // UUIDs, when source = upload
  templates?: MockupTemplateSelection[]   // { id, name, kind, productType, quantity(1–20), config? }
}
```

Validation/guards:
- provider must be enabled in `workspace_connections`, configured server-side, and the model in
  the allowlist;
- `assetIds` must all belong to the workspace;
- reuses a workflow with the same `(workspaceId, name)` or creates one from `defaultWorkflow`.

Returns `202 { run }` (run id + `status: 'queued'`). The actual work happens in the worker.

### Read endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/runs` | Latest 25 runs for the workspace (raw rows) |
| GET | `/api/runs/:id` | Full detail: `{ run, assets(+url), mockups(+url, storagePath), jobs, listings }` — ownership-checked |
| GET | `/api/runs/:id/listings` | `{ listings }` for the run |
| GET | `/api/runs/:id/export.zip` | Structured ZIP (see listings feature) — `application/zip` attachment |

## Prompt templates (AI prompt library)

| Method | Path | Description |
|---|---|---|
| POST | `/api/prompt-templates` | Create — body `{ name(1-160), prompt(1-4000), provider, model?, description? }`; model must be in provider allowlist. Returns `201 { template }` |
| PUT | `/api/prompt-templates/:id` | Update (ownership-scoped). `200 { template }` / 404 |
| DELETE | `/api/prompt-templates/:id` | Delete (ownership-scoped). `200 { ok }` / 404 |

## Connections

| Method | Path | Description |
|---|---|---|
| PUT | `/api/connections/:provider` | Update `{ defaultModel(1-160), enabled(boolean) }`; model allowlist-validated; upserts `workspace_connections`. Returns `{ connection }` |
| POST | `/api/connections/test` | Live connectivity check. Body `{ provider, model? }`. Returns `{ ok, provider, model, message }` (400 with message on failure). See `DOCS/features/connections.md` |

## Assets

| Method | Path | Description |
|---|---|---|
| POST | `/api/assets/upload` | Multipart `file` upload → `201 { id, name, path, url }` (see `DOCS/features/assets-and-storage.md` §3) |

## Static (non-API) routes

| Method | Path | Description |
|---|---|---|
| GET | `/uploads/*` | Serve stored assets through the active `StorageProvider` (immutable cache) |
| GET | `/mockup-assets/:category/:file` | Serve downloaded template photos from `download_mockups/` — category must be in `tshirts, hoodies, posters, canvas, phone` and filename must match `^[a-zA-Z0-9._-]+$` |

## Error format

```
{ "error": "Authentication required" }        // 401
{ "error": { "fieldErrors": {...}, "formErrors": [...] } }   // 400 — Zod flatten
{ "error": "…" }                               // 404 / 400 / 503 / 502
{ "error": "Internal server error" }           // 500
```

## Client bindings

`src/client/api.ts` mirrors every endpoint as a typed function (`getDashboardCatalog`,
`createRun`, `getRun`, `uploadAsset`, `createPromptTemplate`, `updateConnection`,
`testConnection`, …) and normalizes errors to `Error(message)`. Use these functions in the UI —
don't hand-roll `fetch` calls.
