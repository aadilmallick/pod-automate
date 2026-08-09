# Testing

> Test runner: **Vitest** (`npm test` → `vitest run`). Tests live in `tests/unit/`.

## 1. Suite overview

| File | Covers |
|---|---|
| `tests/unit/prompting.test.ts` | Layered prompt engine: style + subject-aware composition, negative-prompt composition, text-on/off behavior, mockup prompt directives |
| `tests/unit/workflow.test.ts` | Fan-out math: `estimateProducts` / `estimateMockups` |
| `tests/unit/mockup-renderer.test.ts` | Deterministic Sharp rendering: WebP output, transparent-artwork handling, template path-traversal protection |

There are no integration or E2E suites yet — the pipeline (worker, Drizzle, API) is exercised
manually (see `DOCS/development/setup.md` §7 for a curl-based smoke run). Building them out is a
natural next step (see §4).

## 2. Running

```bash
npm test            # single run
npx vitest          # watch mode
npx vitest run tests/unit/prompting.test.ts   # single file
```

## 3. Key test fixtures/patterns

**Solid design buffers** (`mockup-renderer.test.ts`):

```ts
async function solidDesign(color) {
  return sharp({ create: { width: 120, height: 120, channels: 4, background: { ...color } } }).png().toBuffer()
}
```

Tests assert on rendered output via `sharp(output).metadata()` (format + dimensions).

**Deterministic render must find a real template** — tests reference
`'Photo · Simple white t-shirt mockup'`, which requires `download_mockups/tshirts/` to be
populated. If templates are missing, tests fail with "Deterministic mockup asset is unavailable".

**Path traversal** — asserts `resolveMockupAssetPath` returns `undefined` for
`{assetPath: '<root>/../secret.webp'}` and absolute `/tmp/…` paths.

## 4. Adding tests — guidance

- **Core functions are pure and cheap to test** (prompting, workflow math). Prefer these.
- For server modules, construct inputs manually (buffers via Sharp) and assert on outputs;
  avoid hitting real Postgres/Redis in unit tests.
- If you add a provider, test it with a mocked `fetch` (Vitest `vi.stubGlobal('fetch', …)`) and
  fixture responses; verify `collectImageUrls` normalization.
- If you add estimation/template logic, keep pure helpers in `src/core` so they stay testable.
- Integration tests (future): mock BullMQ `Worker` processing, call Hono routes via `app.request`,
  and use a throwaway Postgres (or `pg-mem`-style harness) — but note `drizzle-orm` queries here
  rely on real pg semantics.

## 5. Type checking

`npm run build` runs `tsc -b` (strict mode, per `tsconfig.app.json`/`tsconfig.node.json`) before
`vite build`. Keep the build green — it catches type drift between core, server, and client
(e.g. shared `ProductType` / `ImageStyle` enums).
