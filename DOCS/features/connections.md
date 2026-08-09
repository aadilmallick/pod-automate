# Feature: Connections

Connections are the workspace's provider registry. They keep provider configuration **out of
workflow logic** — a workflow references a connection by id, and the connection holds the default
model and an enabled flag.

## What counts as a connection

The dashboard catalog (`src/server/catalog.ts`) reports five entries:

| id | Name | Detail | Config source |
|---|---|---|---|
| `openrouter` | OpenRouter | Image generation · credits required | `OPENROUTER_API_KEY` |
| `fal` | Fal.ai | Image generation · Flux Schnell | `FAL_API_KEY` |
| `huggingface` | Hugging Face | Inference API · text to image | `HUGGINGFACE_TOKEN` |
| `ollama` | Ollama | Local inference · test connection before running | `OLLAMA_BASE_URL` presence |
| `storage` | Local/S3 storage | Asset persistence | `STORAGE_DRIVER` (never shows in the Connections UI) |

A connection has:

- `configured` — whether server-side credentials exist (env-based; the client only ever sees this
  boolean, never the key),
- `enabled` — per-workspace on/off flag stored in `workspace_connections` (persisted, toggleable),
- `defaultModel` — per-workspace default model (also in `workspace_connections`; falls back to the
  env default),
- `models` — the model allowlist exposed to the UI (fixed per provider, from env + hardcoded
  extras like `FLUX.2-klein-9B` and `x/flux2-klein:9b`).

## Persistence

`workspace_connections` table: `(workspaceId, provider, defaultModel, enabled)`.

- Seeded for every workspace by `ensureWorkspace` in `src/server/auth.ts` (one row per image
  provider with env defaults).
- Updated via `PUT /api/connections/:provider` (Zod: `{ defaultModel: string, enabled: boolean }`,
  with `validProviderModel` validation against the allowlist).
- Reads happen in `dashboardCatalog` (enabled/defaultModel resolution).

## The Connections UI

The `connections` view (`Connections` in `src/App.tsx`) renders one card per provider with status
(Connected / Not connected), detail text, and default model. The **Manage** button opens
`ConnectionModal`, which lets you:

- pick the default model (dropdown when `models` is non-empty, free-text otherwise),
- toggle "Available for workflows" (`enabled`),
- **Test connection** — calls `POST /api/connections/test`, which performs a live check:
  - `mock` → always ok,
  - `ollama` → `GET {OLLAMA_BASE_URL}/api/tags`, reports whether the model is installed,
  - `huggingface` → `GET https://huggingface.co/api/whoami-v2` with the token,
  - `fal` → `GET https://api.fal.ai/v1/models?limit=1` with `Key` auth,
  - `openrouter` → `GET https://openrouter.ai/api/v1/key` with `Bearer` auth.

The status message (ok / rejected / not reachable / model missing) is displayed inline.

## How connections gate runs

`POST /api/workflows/runs` enforces connection state before enqueueing:

1. If the run names a provider, its `workspace_connections.enabled` must be `'true'`.
2. The provider must be configured (credentials present / Ollama reachable at config time).
3. The chosen model must be in the provider's allowlist.

The wizard only offers **enabled + configured** providers (plus `mock`), so users can't launch a
run against a broken connection.

## Related docs

- Auth/workspace seeding: `DOCS/server/auth.md`
- Provider adapter details: `DOCS/server/ai-providers.md`
- Extending with new providers: `DOCS/development/extending.md`
