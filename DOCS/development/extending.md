# Extending Pod Automator

This is the "how to add things" guide. The architecture is deliberately interface-first so most
extensions are small, contained additions. Each section gives the exact checklist of touch points.

---

## 1. Add a new image provider (e.g. Google Nano Banana, ComfyUI, Recraft)

1. **Implement the interface** — add a class to `src/server/ai.ts` implementing
   `ImageGenerationProvider` (`id`, `generateImages`). Reuse `collectImageUrls` for response
   normalization or add a collector like `collectOllamaImageUrls` if the payload is exotic.
2. **Config** — add env keys to `src/server/config.ts` (Zod) + `.env.example`; wire
   `defaultModelForProvider` in `ai.ts`.
3. **Factory** — add a branch in `imageProvider(id)`.
4. **Validation surface** (`src/server/index.ts`):
   - add the id to `providerSchema` (Zod enum),
   - add `providerModels[provider]` allowlist entry,
   - add `providerConfigured(provider)` logic,
   - add a case in `/api/connections/test` if you want live testing.
5. **Workspace connection seeding** (`src/server/auth.ts`): add the default connection in
   `ensureWorkspace`'s `defaultConnections`.
6. **UI** (`src/App.tsx`): the wizard renders connections generically from
   `catalog.connections`, but hardcoded labels exist in `SourceStep`'s info note and
   `TemplateEditor`'s provider select — add friendly labels there.
7. **Docs** — update `DOCS/server/ai-providers.md` matrix.

---

## 2. Add a real marketplace adapter (Etsy, TeePublic, Shopify, Google Drive)

1. **Implement the contract** — `MarketplaceAdapter` in `src/core/interfaces/providers.ts`:
   `authenticate`, `getRequirements`, `createDraftListing`, `publishListing` (interface exists;
   no implementations yet). Put the adapter in `src/server/` (e.g. `marketplaces/etsy.ts`).
2. **Credentials** — store secrets server-side (env or a future per-workspace encrypted store);
   expose OAuth via routes in `src/server/index.ts` following the Google OAuth pattern in
   `auth.ts` (state cookie + callback).
3. **Requirements-driven processing** (the principle from `conversation.md`): have
   `getRequirements()` declare image dimensions/title limits so a future transformation stage can
   derive the resize/convert pipeline automatically.
4. **Wiring** — destinations are free-form ids today. Add the destination id to the wizard
   (`DestinationRow` in `App.tsx`) and to `createRunSchema.destinations` if it should be
   validated. The worker already creates `marketplace_listings` rows per destination; extend
   `workflow-runner.ts` to call the adapter (create draft / upload images / publish) instead of
   just inserting rows.
5. **Store external state** — `external_id` and `metadata` on `marketplace_listings` are ready
   for `externalListingId`/draft URLs.

---

## 3. Add a new template category or template

### New category (e.g. mugs, tote bags)
1. Add `mockup_image_templates/{category}.json` (entries `{ "src", "title" }`).
2. Download: `cd download_mockup_scripts && bun install && bun run index.ts {category}`.
3. Register in `src/server/mockup-library.ts`:
   - `MockupCategory` union,
   - `categoryProductTypes` mapping (category → `ProductType`),
   - a `placementProfile` case if the generic defaults don't fit.
4. Whitelist in `GET /mockup-assets/:category/:file` (`src/server/index.ts`).
5. Optionally seed it: `downloadedDefaults` in `src/server/auth.ts` (filter + slice).
6. Add the product type to `ProductType` in `src/core/interfaces/providers.ts` + a
   `productOptions` entry in `src/data/catalog.ts` + a `defaultPlacements` entry in
   `mockup-renderer.ts` + a blend default in `blendFor` (apparel → multiply; flat → over).

### New template (within existing category)
- Built-in templates: add an entry to `templateCatalog` (`src/data/catalog.ts`) and the default
  seeding list in `ensureDefaultTemplates` (`src/server/auth.ts`).
- Photo templates: drop a file into `download_mockups/{category}/` — the registry picks it up via
  title matching (id `downloaded-{category}-{n}`). No code change required unless placement needs
  tuning (edit the JSON title or `placementProfile`).

---

## 4. Add a new product type

1. `ProductType` union in `src/core/interfaces/providers.ts` (shared everywhere).
2. `productOptions` entry (`src/data/catalog.ts`) — id, label, description, emoji, color.
3. `defaultPlacements` + blend in `src/server/mockup-renderer.ts`.
4. `categoryProductTypes`/`placementProfile` in `src/server/mockup-library.ts` (if photos exist).
5. Default templates for the product in `ensureDefaultTemplates`/`templateCatalog`.
6. UI: the wizard renders product options dynamically; check hardcoded label switches in
   `App.tsx` (`TemplateCard`, `RunMonitor` asset mapping).

---

## 5. Add a new workflow node type

1. Extend `WorkflowNodeType` in `src/core/workflow.ts`.
2. Add a default node/edge to `defaultWorkflow` if it belongs in the standard chain.
3. Implement its execution in `src/server/workflow-runner.ts` (procedural today) and surface its
   progress/job rows so the run monitor shows it.
4. If the node needs UI configuration, add a wizard step (see `DOCS/features/wizard.md`).

---

## 6. Add a transformation capability (background removal / upscaling provider)

1. The interface exists: `TransformationProvider` in `src/core/interfaces/providers.ts`.
2. Implement it (e.g. Fal.ai RMBG, remove.bg, local ComfyUI) in `src/server/`.
3. Wire it into the worker's "prepare artwork" stage (currently implicit near-white removal in
   `mockup-renderer.ts`) — call `removeBackground`/`resize`/`convertFormat` per design before
   mockup rendering, storing the result as a `processed-design` asset type.
4. Config: `AI_PROVIDER`-style env key or per-workspace connection; add to Connections UI.

---

## 7. Add an environment variable

1. `.env.example` — document with a comment.
2. `src/server/config.ts` — add to the Zod `envSchema` (type + default + optional validation).
3. Use `config.X` in server/worker code. If it affects the client (e.g. model allowlists),
   surface it through an existing API (dashboard catalog / connections).
4. If it's a URL affecting OAuth/asset URLs, check the derived values section (`APP_URL`,
   `WEB_URL`, `PUBLIC_ASSET_URL`, `GOOGLE_REDIRECT_URI`).
5. Update `DOCS/reference/env-vars.md`.

---

## 8. General rules (read before any change)

- **Core purity:** `src/core/**` must not import server/vendor code. New domain logic (estimates,
  prompt building, workflow math) goes there.
- **Interface-first:** new external integrations implement interfaces from
  `src/core/interfaces/providers.ts`; they're instantiated by id/config, never by
  `if (provider === …)` in pipeline code.
- **Provenance:** AI-generated assets store `provider/model/prompt` in `assets.metadata`; keep
  adding to it rather than dropping fields.
- **Security:** keep the path-traversal guard (`resolveMockupAssetPath`) and the
  `/mockup-assets` whitelist; keep credentials server-side.
- **Tests:** add/extend unit tests in `tests/unit/`; keep `npm run build` and `npm test` green.
- **Docs:** update the relevant `DOCS/**` page and this guide when the touch-point list changes.
