# Environment Variables Reference

> **Source of truth:** `src/server/config.ts` (Zod `envSchema`) and `.env.example`.

All configuration flows through a single Zod-validated object. **Any unknown/mistyped variable
fails startup** — that's intentional.

## Runtime & URLs

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. **Production requires `AUTH_MODE=google`** (startup throws otherwise) |
| `HOST` | `localhost` | API bind host (containers use `0.0.0.0`) |
| `PORT` | `3000` | API bind port |
| `API_PUBLIC_PORT` | `PORT` | Host-facing API port; used to derive `APP_URL`, OAuth redirects, CORS |
| `PUBLIC_HOST` | `localhost` | Host component of derived `APP_URL` |
| `WEB_BIND_HOST` | `localhost` | Vite dev server bind host |
| `PUBLIC_WEB_HOST` | `localhost` | Host component of derived `WEB_URL` |
| `WEB_HOST` / `WEB_PORT` | `localhost` / `5173` | Web host/port (legacy/dev) |
| `APP_URL` | `http://{PUBLIC_HOST}:{API_PUBLIC_PORT}` | Explicit full API URL override (OAuth/production) |
| `WEB_URL` | `http://{PUBLIC_WEB_HOST}:{WEB_PORT}` | Explicit full web URL override |
| `PUBLIC_SITE_URL` | — | Canonical deployed HTTPS origin; replaces `__PUBLIC_SITE_URL__` in `index.html` (Open Graph / Twitter) |
| `PUBLIC_ASSET_URL` | `${APP_URL}/uploads` | Base URL for stored asset URLs |
| `API_PROXY_HOST` / `API_PROXY_TARGET` | derived | Vite dev proxy override for `/api`, `/uploads`, `/mockup-assets` (see `vite.config.ts`) |

## Infrastructure

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://pod:pod@localhost:5432/pod_automator` | Postgres connection (Drizzle/pg Pool, max 10) |
| `REDIS_URL` | `redis://localhost:6379` | Redis for BullMQ (ioredis) |

## Auth

| Variable | Default | Description |
|---|---|---|
| `AUTH_SECRET` | `dev-only-change-this-secret` | HMAC secret for session cookies; Zod requires ≥ 16 chars |
| `AUTH_MODE` | `development` | `development` \| `google` |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `${APP_URL}/api/auth/google/callback` | Authorized redirect URI (register it in Google Cloud) |

## AI providers (server-side only)

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `openrouter` | Default image provider: `openrouter` \| `fal` \| `huggingface` \| `ollama` \| `mock` |
| `OPENROUTER_API_KEY` | — | OpenRouter key |
| `OPENROUTER_IMAGE_MODEL` | `google/gemini-3.1-flash-image` | Default OpenRouter image model |
| `FAL_API_KEY` | — | Fal.ai key |
| `FAL_IMAGE_MODEL` | `fal-ai/flux/schnell` | Default Fal.ai model (endpoint path) |
| `GEMINI_API_KEY` | — | Gemini key; required only for runs containing a generative mockup template |
| `GEMINI_MOCKUP_MODEL` | `gemini-3-pro-image` | Nano Banana Pro model used for generative mockups |
| `MOCKUP_AI_PROVIDER` | `gemini` | Mockup provider selected independently from design generation |
| `HUGGINGFACE_TOKEN` | — | Hugging Face token (https://huggingface.co/settings/tokens) |
| `HUGGINGFACE_IMAGE_MODEL` | `black-forest-labs/FLUX.2-klein-9B` | Default HF text-to-image model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama HTTP API. `OLLAMA_CONFIGURED` = presence of this var |
| `OLLAMA_IMAGE_MODEL` | `x/flux2-klein` | Default Ollama image model |
| `OLLAMA_IMAGE_MODEL_9B` | `x/flux2-klein:9b` | Secondary Ollama model offered in connections |

> Ollama is experimental for image generation. The app reports reachability + installed-model
> status via `POST /api/connections/test` instead of failing silently.

Gemini is mockup-only. It receives the original design as inline image data and creates the product scene around it. It does not appear in the design-provider selector, and deterministic mockups do not require Gemini credentials.

## Etsy marketplace

| Variable | Default | Description |
|---|---|---|
| `ETSY_KEYSTRING` | — | Etsy app keystring |
| `ETSY_SHARED_SECRET` | — | Etsy app shared secret; server-side only |
| `ETSY_REDIRECT_URI` | `${APP_URL}/api/marketplaces/etsy/oauth/callback` | Exact OAuth callback registered with Etsy |
| `MARKETPLACE_TOKEN_ENCRYPTION_KEY` | — | Exactly 32 random bytes encoded as base64 (`openssl rand -base64 32`) |

Changing `MARKETPLACE_TOKEN_ENCRYPTION_KEY` makes existing token ciphertext unreadable and requires reconnecting Etsy.

## Transform / artwork preparation

| Variable | Default | Description |
|---|---|---|
| `TRANSFORM_DRIVER` | `auto` | Artwork transform driver: `auto` \| `sharp` \| `imgly` \| `none` |
| `TRANSFORM_MODEL_CACHE_DIR` | `./data/model-cache` | Local cache dir for offline background-removal models (imgly/auto) |
| `TRANSFORM_MAX_DIMENSIONS` | `2400` | Max longest side in px before resizing artwork for mockup rendering |

`auto` prefers `@imgly/background-removal-node` when available; falls back to Sharp-only transforms if it cannot load. Use `none` to disable background removal entirely.

## Storage

| Variable | Default | Description |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` \| `s3` |
| `STORAGE_DIR` | `./data/uploads` | Local filesystem root (gitignored) |
| `S3_ENDPOINT` | `http://localhost:9000` | S3-compatible endpoint (MinIO default) |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_BUCKET` | `pod-assets` | Bucket name |
| `S3_ACCESS_KEY` | `minioadmin` | Access key |
| `S3_SECRET_KEY` | `minioadmin` | Secret key |

## Derived values & validation rules

- `API_PUBLIC_PORT ?? PORT` — used for `APP_URL`, `GOOGLE_REDIRECT_URI`, and CORS origin.
- `APP_URL ?? http://{PUBLIC_HOST}:{API_PUBLIC_PORT}`.
- `WEB_URL ?? http://{PUBLIC_WEB_HOST}:{WEB_PORT}`.
- `PUBLIC_ASSET_URL ?? {APP_URL}/uploads`.
- Startup guard: `NODE_ENV=production` requires `AUTH_MODE=google`.
- `.env` is loaded via `import 'dotenv/config'` in `config.ts` (and `vite.config.ts`,
  `drizzle.config.ts` for tooling).

## Compose-only vars

| Variable | Default | Used by |
|---|---|---|
| `OLLAMA_PORT` | `11434` | Compose Ollama port mapping |
| `WEB_PORT` | `5173` | Compose web container host port (nginx 80 inside) |
| `API_PUBLIC_PORT` | `3000` | Compose API host port |

## Adding variables

See `DOCS/development/extending.md` §7.
