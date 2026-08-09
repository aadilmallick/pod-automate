# Workflow Model

> **Source of truth:** `src/core/workflow.ts`

This module defines the workflow representation — the artifact that persists in
`workflows.definition_graph` and drives the production run — plus the pure math used by the UI to
estimate output counts before a run is launched.

## 1. Approval policies

```ts
type ApprovalPolicy = 'auto' | 'review' | 'skip'
```

Every node in a workflow can require human approval (`review`), run unattended (`auto`), or be
excluded (`skip`). This is the "approval boundary" concept from the product conversation — each
stage can eventually have its own policy (AUTO / REVIEW / SKIP). The current UI exposes a design
review checkpoint; the model is already general.

## 2. Node types

```ts
type WorkflowNodeType =
  | 'design-generation'   // create or import designs
  | 'transform'           // prepare artwork (bg removal, resize, convert)
  | 'fan-out'             // one design → many product variants
  | 'mockup'              // render deterministic or generative mockups
  | 'metadata'            // generate listing title/description/tags
  | 'publish'             // export / publish to destinations
```

## 3. The graph

```ts
interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  label: string          // human-readable name shown in the UI
  provider?: string      // optional provider hint (e.g. 'OpenRouter', 'Sharp / local')
  policy: ApprovalPolicy
}

interface WorkflowDefinition {
  version: number
  nodes: WorkflowNode[]
  edges: Array<{ from: string; to: string }>   // DAG edges by node id
}
```

`WorkflowDefinition` is a **general DAG** — the engine could execute arbitrary node graphs. The V1
product deliberately exposes a linear wizard ("Model B engine, Model A UX" — see
`conversation.md`), and `defaultWorkflow` is that linear chain:

```
designs  (design-generation, OpenRouter, review)
   ↓
prepare  (transform, Sharp/local, auto)
   ↓
fanout   (fan-out, auto)
   ↓
mockups  (mockup, Template engine, review)
   ↓
metadata (metadata, OpenRouter, auto)
   ↓
publish  (publish, review)
```

`version: 1`. Runs record which workflow they used, and the full configuration lives in the run's
`config` JSONB snapshot — so a run is reproducible even if a later workflow version changes.

## 4. Production configuration & estimation

The wizard collects a `ProductionConfig`:

```ts
interface MockupTemplateSelection {
  id: string
  name: string
  kind: 'deterministic' | 'generative'
  productType: ProductType
  quantity: number            // how many renders per template
  config?: Record<string, unknown>  // e.g. boundingBox/blend for deterministic
}

interface ProductionConfig {
  designs: number
  products: ProductType[]
  templates: MockupTemplateSelection[]
  destinations: string[]
}
```

Two pure helpers compute the fan-out totals (used live in the wizard's product step and summary):

```ts
estimateProducts(config): number   // designs × products.length
estimateMockups(config): number    // designs × Σ(products) Σ(templates for that product) quantity
```

Example (from `tests/unit/workflow.test.ts`):

```
designs=4, products=[tshirt, hoodie]
tshirt: studio×1 + street×2 ; hoodie: hoodie-studio×1
→ products = 4 × 2 = 8
→ mockups  = 4 × ((1+2) + 1) = 16
```

## 5. Relationships to the rest of the system

| Concept | Where it lives |
|---|---|
| `WorkflowDefinition` | persisted in `workflows.definition_graph` (JSONB) |
| `defaultWorkflow` | used when the API creates a workflow from a new run name |
| `ProductionConfig` | equivalent fields in `createRunSchema` / `runs.config` |
| `MockupTemplateSelection` | also the shape of `mockup_templates` rows surfaced by the dashboard catalog |
| Estimation | used by `WizardModal` (`estimateProducts`, `estimateMockups`) |

## 6. Current execution status

Today the worker (`src/server/workflow-runner.ts`) executes the pipeline **procedurally** rather
than interpreting `definition_graph` node-by-node. The graph model is the contract for
persistence, versioning, and a future general-purpose engine. When building a general engine,
respect these invariants:

- Nodes are identified by string `id`; edges reference ids only.
- `version` allows migrations of the graph shape.
- A run must store enough state (in `runs.config` + the job rows) to resume/reproduce regardless
  of graph evolution.
