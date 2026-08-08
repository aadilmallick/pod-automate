# POD Automator

A provider-agnostic production pipeline for turning design ideas into POD products, mockups, and marketplace-ready listings.

## Local development

1. Copy `.env.example` to `.env` and keep provider keys server-side.
2. Start self-hosted dependencies:

```bash
docker compose up -d postgres redis minio
npm install
npm run db:bootstrap
```

3. Start the API and worker in separate terminals:

```bash
npm run dev:api
npm run dev:worker
```

4. Start the Vite app:

```bash
npm run dev
```

Open `${WEB_URL}` (default: `http://${WEB_HOST}:${WEB_PORT}`).

## Full Docker Compose

```bash
docker compose up --build
```

- Web UI: `${WEB_URL}` (defaults to `http://${WEB_HOST}:${WEB_PORT}`)
- Hono API: `${APP_URL}` (defaults to `http://${PUBLIC_HOST}:${API_PUBLIC_PORT}`)
- MinIO console: host port `9001` by default; change the Compose port mapping if needed.

Generated assets use the local filesystem by default (`./data/uploads`). Set `STORAGE_DRIVER=s3` to use the included MinIO S3-compatible service.

## Providers

`OPENROUTER_API_KEY`, `FAL_API_KEY`, and `HUGGINGFACE_TOKEN` are read only by the server/worker. Choose the active provider with `AI_PROVIDER=openrouter`, `fal`, `huggingface`, `ollama`, or `mock`. The wizard also lets you select a provider and model per run.

- Hugging Face uses `@huggingface/inference` and `HUGGINGFACE_IMAGE_MODEL` (default: `black-forest-labs/FLUX.2-klein-9B`). Add `HUGGINGFACE_TOKEN` to `.env` before testing or launching a Hugging Face workflow.
- Ollama uses its local HTTP API at `OLLAMA_BASE_URL` (default: `http://localhost:11434`). The default model is `x/flux2-klein`; `x/flux2-klein:9b` is also available. Pull a model first with `ollama pull x/flux2-klein` or `ollama pull x/flux2-klein:9b`. The Compose Ollama service is behind the optional `ollama` profile; start it with `docker compose --profile ollama up -d ollama`, then set `OLLAMA_BASE_URL=http://ollama:11434` in `.env`.
- The Ollama image-generation model is experimental and currently has host/runtime limitations documented by Ollama. The app reports a clear connection/model status instead of silently falling back.

The `mock` provider is useful for local smoke tests without inference cost.

## Authentication

Development mode creates a signed local session automatically. For Google OAuth:

- Set `AUTH_MODE=google`.
- Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Register `${GOOGLE_REDIRECT_URI}` as an authorized redirect URI (default: `${APP_URL}/api/auth/google/callback`). Set `API_PUBLIC_PORT` when the host port differs from the internal API port.
- Start login at `${APP_URL}/api/auth/google`.

## Architecture

- React + Vite UI
- Hono + Node API
- PostgreSQL + Drizzle schema
- Redis + BullMQ worker
- Local filesystem or MinIO/S3-compatible storage
- OpenRouter, Fal.ai, Hugging Face, Ollama, and mock image provider adapters
- Workspace → workflow → run → assets → product variants → mockups → listings

## Checks

```bash
npm run build
npm test
```
