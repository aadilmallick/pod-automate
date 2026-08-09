# Gemini Nano Banana Pro Mockup Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate all `generative` template mockups with Gemini Nano Banana Pro while preserving the original design and leaving design-generation and deterministic-mockup paths unchanged.

**Architecture:** Add a focused Gemini mockup adapter that accepts image bytes rather than a public reference URL. Route only generative templates through it, expose Gemini as a mockup-only connection, and validate credentials before queueing affected runs.

**Tech Stack:** TypeScript, Hono, Zod, Vitest, native `fetch`, Gemini Interactions REST API, React.

## Global Constraints

- `GEMINI_API_KEY` remains server-side and is never stored or sent to the browser.
- `GEMINI_MOCKUP_MODEL` defaults to exactly `gemini-3-pro-image`.
- Gemini is mockup-only and must not appear in design-provider or prompt-template selectors.
- Gemini requests use one inline base64 design image and request one `1:1`, `2K` image.
- Deterministic templates must work without Gemini credentials.
- Do not modify unrelated existing worktree changes.

---

### Task 1: Preservation-First Mockup Prompt

**Files:**
- Modify: `src/core/prompting.ts`
- Test: `tests/unit/prompting.test.ts`

**Interfaces:**
- Produces: `buildGeminiMockupPrompt(input: { templateName: string; productType: string; includeText: boolean }): string`

- [ ] Write failing tests proving the prompt identifies the input as immutable print artwork, forbids redesign/recolor/crop/mirror/substitution, limits changes to physical integration, preserves or prohibits text based on `includeText`, and includes literal product/template direction.
- [ ] Run `npm test -- tests/unit/prompting.test.ts` and confirm the new tests fail because `buildGeminiMockupPrompt` is missing.
- [ ] Implement the pure prompt builder with preservation instructions and no dependence on the original text prompt or visual style.
- [ ] Run the focused test and confirm it passes.

### Task 2: Gemini REST Adapter

**Files:**
- Create: `src/server/gemini-mockup.ts`
- Create: `tests/unit/gemini-mockup.test.ts`
- Modify: `src/server/config.ts`

**Interfaces:**
- Produces: `generateGeminiMockup(request: { prompt: string; image: Buffer; mimeType: string; model?: string }, fetcher?: typeof fetch): Promise<{ buffer: Buffer; contentType: string; rawResponse: unknown }>`

- [ ] Write failing tests with a dependency-injected fake fetch. Assert observable adapter output and inspect the captured request for the `x-goog-api-key` header, model, text input, complete base64 image, MIME type, and `{ type: 'image', aspect_ratio: '1:1', image_size: '2K' }` response format.
- [ ] Add failing cases for an absent key, non-2xx response, and a successful response containing no output image.
- [ ] Run `npm test -- tests/unit/gemini-mockup.test.ts` and confirm failures are caused by the missing adapter/config fields.
- [ ] Add optional `GEMINI_API_KEY`, `GEMINI_MOCKUP_MODEL` defaulting to `gemini-3-pro-image`, and `MOCKUP_AI_PROVIDER` defaulting to `gemini` in config.
- [ ] Implement the Interactions API adapter, bounded provider errors, output-image extraction from convenience and step-based response shapes, and MIME validation.
- [ ] Run the focused adapter tests and confirm all pass.

### Task 3: Route Generative Mockups Independently

**Files:**
- Modify: `src/server/workflow-runner.ts`
- Create: `src/server/mockup-generation.ts`
- Create: `tests/unit/mockup-generation.test.ts`

**Interfaces:**
- Consumes: `buildGeminiMockupPrompt`, `generateGeminiMockup`, `config.MOCKUP_AI_PROVIDER`.
- Produces: `generateMockupImage(input: { designBuffer: Buffer; designContentType: string; templateName: string; productType: string; includeText: boolean }): Promise<{ buffer: Buffer; contentType: string; provider: string; model: string }>`

- [ ] Write failing tests that generate a mockup through an injected Gemini generator and prove the design provider is not an input; add a rejection test for an unsupported mockup provider.
- [ ] Run `npm test -- tests/unit/mockup-generation.test.ts` and confirm the module is missing.
- [ ] Implement the mockup-generation coordinator and route only the runner's `generative` branch through it using the already-loaded original design bytes/content type.
- [ ] Keep the deterministic `renderDeterministicMockup` branch byte-for-byte independent from Gemini.
- [ ] Run focused mockup-generation, prompting, and existing mockup-renderer tests.

### Task 4: Configuration Validation and Connection UI

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/catalog.ts`
- Modify: `src/server/auth.ts`
- Modify: `src/App.tsx`
- Create: `src/server/provider-config.ts`
- Create: `tests/unit/provider-config.test.ts`

**Interfaces:**
- Produces: pure helpers for `hasGenerativeTemplates(templates)`, `mockupProviderConfigured()`, and provider model/configuration metadata used by routes and catalog.

- [ ] Write failing tests that prove generative templates require Gemini configuration, deterministic-only templates do not, and Gemini is classified as mockup-only.
- [ ] Run `npm test -- tests/unit/provider-config.test.ts` and confirm failure from the missing helpers.
- [ ] Implement the helpers, add Gemini to connection validation/models and workspace seeding, and reject affected run creation with `Gemini Nano Banana Pro is not configured. Add GEMINI_API_KEY to .env.`
- [ ] Add the Gemini connection card with mockup-only detail and styling. Filter connections with a mockup-only capability out of the SourceStep design-provider select rather than relying on provider IDs.
- [ ] Test Gemini connection validity with a lightweight authenticated Gemini models endpoint request and actionable errors.
- [ ] Run focused provider-config tests and `npm run build`.

### Task 5: Environment Documentation and Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `DOCS/reference/env-vars.md`
- Modify: `DOCS/server/ai-providers.md`

**Interfaces:**
- Documents: `GEMINI_API_KEY`, `GEMINI_MOCKUP_MODEL`, `MOCKUP_AI_PROVIDER` and the mockup-only behavior.

- [ ] Add exact environment examples and explain that the API key is required only when a run selects a generative template.
- [ ] Run `rg -n "GEMINI_API_KEY|GEMINI_MOCKUP_MODEL|MOCKUP_AI_PROVIDER" .env.example DOCS src` and inspect all references for consistent names/defaults.
- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Review `git diff --check` and the scoped diff for accidental unrelated edits.
- [ ] Prompt the user to add `GEMINI_API_KEY` to `.env`; do not request the secret in chat.
