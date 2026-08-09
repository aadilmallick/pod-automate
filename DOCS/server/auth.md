# Authentication & Workspace Seeding

> **Source of truth:** `src/server/auth.ts`

## 1. Modes

`AUTH_MODE` (Zod-validated in `src/server/config.ts`) selects the identity strategy:

| Mode | Behavior |
|---|---|
| `development` | Signed local session created automatically on first request; no external provider needed |
| `google` | Google OAuth 2.0 flow (authorization code + PKCE-less state cookie) |

**Production guard:** `config.ts` throws at startup if `NODE_ENV === 'production'` and
`AUTH_MODE !== 'google'` — dev identity is deliberately unsafe in production.

## 2. Session cookies

| Cookie | Purpose |
|---|---|
| `pod_session` | `{userId}.{hmac-sha256(userId, AUTH_SECRET)}` — HMAC-signed, validated with `timingSafeEqual` |
| `pod_logged_out` | Set on logout; `currentUser` rejects requests carrying it until a new session is created |
| `pod_oauth_state` | Random 24-byte hex state for the Google flow (maxAge 600s, httpOnly) |

Cookies are `httpOnly`, `sameSite: 'Lax'`, `secure` in production, 30-day maxAge for sessions.

## 3. Dev-mode identity

- `currentUser(c)` first checks the session cookie; then (dev mode only) falls back to the
  `x-dev-user-email` header or the default `owner@local.test`.
- Unknown dev emails are auto-provisioned as users ("Local Owner" for the default).
- `POST /api/auth/dev-session` creates the signed session cookie; the frontend calls it
  automatically when `mode === 'development'` and unauthenticated.
- `requireUser` is a non-throwing variant (used by `/api/auth/status`).

## 4. Google OAuth flow

1. `GET /api/auth/google` → validates credentials exist (503 otherwise), sets the state cookie,
   redirects to
   `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`
   (`GOOGLE_REDIRECT_URI`, default `${APP_URL}/api/auth/google/callback`), `response_type: code`,
   `scope: openid email profile`, `state`, `access_type: offline`, `prompt: select_account`.
2. `GET /api/auth/google/callback` →
   - verifies `code` + `state` matches the cookie (400 otherwise),
   - exchanges the code at `https://oauth2.googleapis.com/token`,
   - fetches the profile at `https://openidconnect.googleapis.com/v1/userinfo`,
   - **upserts the user** by email (existing rows get `googleId` + name updated),
   - clears the logged-out cookie, sets the session cookie, redirects to `WEB_URL`.

## 5. Workspace seeding (`ensureWorkspace`)

Every user gets a workspace on first access (lazily — called from `currentUser` and OAuth
completion). Seeding is idempotent and includes:

1. **Workspace row** — `"{name}'s studio"`.
2. **Default mockup templates** (`ensureDefaultTemplates`):
   - 8 built-in templates (deterministic + generative per product type),
   - up to 10 downloaded photo templates (deduped by `assetPath`),
   - backfill for existing deterministic templates missing photo assets.
3. **Default prompt templates** (3):
   - "Funny cat collection" (fal),
   - "Minimal botanical set" (fal),
   - "Flux Klein typography" (ollama).
4. **Default workspace connections** — one per image provider
   (`fal`, `openrouter`, `huggingface`, `ollama`) with env default models; missing rows inserted.

## 6. Auth-related API surface

| Endpoint | Implementation |
|---|---|
| `GET /api/auth/status` | `authStatus()` + optional session user |
| `GET /api/auth/google` | `startGoogleAuth(c)` |
| `GET /api/auth/google/callback` | `finishGoogleAuth(c)` |
| `POST /api/auth/dev-session` | `currentUser(c, true, true)` + `createDevSession` |
| `POST /api/auth/logout` | `clearSession` |
| `GET /api/me` | `currentUser` → `{ user }` |

## 7. Security notes

- `AUTH_SECRET` must be ≥ 16 chars (Zod `min(16)`); a dev fallback exists but is for local use
  only.
- Session signature comparison uses `timingSafeEqual` to avoid timing attacks.
- `state` prevents CSRF on the OAuth callback; the state cookie is `httpOnly`.
- Provider credentials are read **only server-side** (`.env` via `config.ts`); the client sees
  only `configured` booleans.
- All run/asset/template operations are scoped to the authenticated user's workspace (drizzle
  `where` clauses + explicit ownership checks).

## Related docs

- Env vars (OAuth settings): `DOCS/reference/env-vars.md`
- Deployment (redirect URI setup): `DOCS/architecture/deployment.md` §7
