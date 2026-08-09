# Feature: The Production Wizard

The wizard is the main "create a run" experience. It's a single modal (`WizardModal` in
`src/App.tsx`) with six steps; it collects configuration and calls
`POST /api/workflows/runs` on launch.

## Step flow

| # | id | Label | Purpose |
|---|---|---|---|
| 1 | `start` | Start | Choose "Start from scratch" (only option implemented; "Use an existing workflow" is a UI stub) |
| 2 | `source` | Design source | AI theme + style + count, **or** file upload |
| 3 | `review` | Review designs | Approval checkpoint — select/deselect uploaded designs |
| 4 | `products` | Products & mockups | Pick product types and mockup templates |
| 5 | `destinations` | Destinations | Etsy / TeePublic / Google Drive / structured download |
| 6 | `summary` | Review & run | Full production plan + launch |

`wizardSteps` in `src/App.tsx` drives the sidebar numbering. `canContinue` gates the Continue
button per step (e.g. review requires ≥1 selected design; products requires ≥1 product **and**
≥1 template; destinations requires ≥1 destination).

## Step details

### 1. start
Static intro. The "Start from scratch" card is pre-selected; the "existing workflow" card is
presentational only.

### 2. source
A `source-toggle` switches between:

- **Generate with AI**
  - Collection theme textarea (`prompt`)
  - Style picker grid (all 8 `imageStyleOptions` — see `DOCS/interfaces/prompting.md`)
  - "Allow text in artwork" toggle → `includeText`
  - Optional negative prompt textarea (shown when `includeText` is off)
  - Number of designs stepper (1–100)
  - Provider `<select>` (enabled+configured connections, plus always-available `mock`) and model
    input/select (fixed list when the provider declares models, free text otherwise)
- **Upload existing**
  - Drag-zone + hidden file input (`image/png,image/jpeg,image/webp`, multiple).
  - Files go through `uploadAsset` → `POST /api/assets/upload`, become `assets` rows (type
    `uploaded-design`), and are selected by default for the run.

### 3. review
Approval checkpoint. Shows the uploaded designs as a grid with select/deselect, "Select all /
Deselect all", and a live selected-count. For AI source, this step is a placeholder message (the
designs don't exist yet — generation happens at run time).

### 4. products
- Product selector: the five `productOptions` (T-shirt, Hoodie, Sweatshirt, Phone case, Wall art).
- Live estimate card: `estimateProducts` (product variants) and `estimateMockups` (mockup
  outputs).
- Mockup template list: `catalog.templates` filtered to selected product types; each row toggles
  inclusion and shows its quantity. Requires ≥1 product and ≥1 template to continue.

### 5. destinations
Destination toggles: Etsy, TeePublic, Google Drive, Structured download. `DestinationRow` shows a
badge (Connected / Coming soon / Included). This state becomes `runs.config.destinations` and
drives the `marketplace_listings` rows created per variant.

### 6. summary
Production plan: design source & provider, fan-out counts, mockup counts, destinations, prompt
direction, and the "Design review checkpoint is enabled" approval note. The **Launch workflow**
button calls `launchWorkflow`:

```ts
createRun({
  name: 'Funny cat collection',
  prompt, source, style, includeText, negativePrompt,
  count: source === 'ai' ? designCount : selectedDesigns.length,
  products: selectedProducts,
  destinations,
  provider: selectedProvider,
  model: selectedModel || connection default for provider,
  templates: selectedTemplates,
  assetIds: source === 'upload' ? selectedDesigns : [],
})
```

On success the modal closes, the app navigates to the **Run monitor** view, and a "Workflow
launched" toast shows. Errors surface in a toast and the user can retry.

## State owner

All wizard state lives at the top of `App` (React `useState`), not in a store:

```
source, selectedProvider, selectedModel, selectedStyle, includeText, negativePrompt,
prompt, designCount, selectedDesigns, selectedProducts, selectedTemplates, destinations
```

`WizardModal` receives state + setters as props and renders per-step subcomponents
(`SourceStep`, `ReviewStep`, `ProductsStep`, `DestinationsStep`, `SummaryStep`).

## Related docs

- API contract: `DOCS/api/endpoints.md` (`POST /api/workflows/runs`)
- Execution after launch: `DOCS/architecture/pipeline.md`
- Templates & connections UIs: `DOCS/features/connections.md`
