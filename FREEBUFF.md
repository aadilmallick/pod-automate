Below is a single, self-contained, highly structured prompt optimized for one-shot execution by coding agents like freebuff, Cursor, or Aider.

The tech stack selected for maximum performance, simplicity, type safety, and developer ergonomics is **Node.js/Bun runtime, Hono, TypeScript, Zod, React + Vite, Tailwind CSS, shadcn/ui, PostgreSQL + Drizzle ORM, and BullMQ + Redis**.

---

### ONE-SHOT CODING AGENT PROMPT

```markdown
# MISSION BRIEF: BUILD "POD-AUTOMATOR" (AI PRINT-ON-DEMAND PRODUCTION PIPELINE)

## 1. CORE PHILOSOPHY & ARCHITECTURE PRINCIPLES
- **Domain-Driven & Interface-First Design:** Program strictly to interfaces, never to concrete infrastructure or vendor SDKs. Abstract all external services (AI generation, image transformations, storage providers, marketplace destinations) behind capability interfaces.
- **Workflow & Job Graph:** The backend is a general-purpose, directed-acyclic-graph (DAG) execution engine executed as background jobs. The initial V1 UI is a streamlined multi-step POD wizard that produces valid workflow graphs.
- **Data Model Hierarchy:**
  `Workspace -> Project -> Workflow (Versioned) -> Run -> Batch -> Design Asset -> Product Variant -> Mockup Asset -> Marketplace Listing -> Job`
- **Dual Deployment Architecture:** Environment variables drive execution context. Support both Cloud (S3, Neon Postgres, Upstash/Redis, External APIs) and Self-Hosted/Local (Local Filesystem, Local Postgres, Local Redis, ComfyUI / RMBG).

---

## 2. TECH STACK SPECIFICATION

### Runtime & Server Framework
- **Runtime:** Node.js (v20+) or Bun.
- **Server Framework:** Hono (API routes, lightweight, ultra-fast).
- **Language:** TypeScript (Strict mode enabled across monorepo/codebase).

### Database, ORM & Validation
- **Database:** PostgreSQL (Compatible with local Postgres & Neon Serverless).
- **ORM:** Drizzle ORM.
- **Validation:** Zod for all environment configurations, API route parameters, and domain DTOs.

### Background Job Engine & Queues
- **Queue System:** BullMQ + Redis.
- **Job Capabilities:** Idempotent job execution, retry logic with exponential backoff, status tracking, and event emission.

### Frontend
- **Framework:** React 18+ (Vite builder).
- **Styling & UI Components:** Tailwind CSS, shadcn/ui components, Lucide icons, Framer Motion for step wizard transitions.
- **State Management & Data Fetching:** TanStack Query (React Query) for API synchronization, Zustand for local wizard state.

### Image Processing & AI Libraries
- **Deterministic Composition & Local Transformations:** Sharp, FFmpeg.
- **AI SDK Interfaces:** OpenRouter API client, Fal.ai API client, Google Gemini/Nano Banana API client, Local ComfyUI client.

---

## 3. ABSTRACTION & INTERFACE CONTRACTS

Implement the following interfaces in `/src/core/interfaces/`:

```typescript
// --- 1. STORAGE PROVIDER ---
export interface StorageProvider {
  put(path: string, buffer: Buffer, contentType: string): Promise<string>; // returns storage key
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getPublicUrl(path: string): Promise<string>;
}

// --- 2. IMAGE GENERATION PROVIDER ---
export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  count: number;
  referenceImageUrls?: string[];
  model?: string;
}

export interface ImageGenerationProvider {
  id: string;
  generateImages(request: ImageGenerationRequest): Promise<{ urls: string[]; rawResponse: unknown }>;
}

// --- 3. IMAGE EDITING & TRANSFORMATION PROVIDER ---
export interface TransformationProvider {
  removeBackground(imageBuffer: Buffer): Promise<Buffer>;
  upscale(imageBuffer: Buffer, scaleFactor: number): Promise<Buffer>;
  resize(imageBuffer: Buffer, width: number, height: number, fit?: 'cover' | 'contain' | 'fill'): Promise<Buffer>;
  convertFormat(imageBuffer: Buffer, format: 'png' | 'jpeg' | 'webp'): Promise<Buffer>;
}

// --- 4. MOCKUP PROVIDER ---
export interface DeterministicMockupSpec {
  baseImageBuffer: Buffer;
  designBuffer: Buffer;
  overlayBuffer?: Buffer;
  boundingBox: { x: number; y: number; width: number; height: number; rotateDeg?: number };
}

export interface MockupProvider {
  renderDeterministic(spec: DeterministicMockupSpec): Promise<Buffer>;
  renderGenerative(templatePrompt: string, designUrl: string, options: Record<string, unknown>): Promise<Buffer>;
}

// --- 5. MARKETPLACE PROVIDER ADAPTER ---
export interface MarketplaceListingPayload {
  title: string;
  description: string;
  tags: string[];
  price: number;
  mainImageBuffer: Buffer;
  mockupImageBuffers: Buffer[];
  sku?: string;
  category?: string;
}

export interface MarketplaceAdapter {
  id: string;
  authenticate(credentials: Record<string, string>): Promise<boolean>;
  getRequirements(): { maxTitleLength: number; requiredImageDimensions: { width: number; height: number } };
  createDraftListing(payload: MarketplaceListingPayload): Promise<{ externalListingId: string; draftUrl: string }>;
  publishListing(externalListingId: string): Promise<{ success: boolean; url: string }>;
}

```

---

## 4. DATABASE SCHEMA (Drizzle Schema)

Implement PostgreSQL schema in `/src/db/schema.ts`:

1. **`users`**: `id`, `email`, `googleId`, `createdAt`.
2. **`workspaces`**: `id`, `ownerId`, `name`, `createdAt`.
3. **`projects`**: `id`, `workspaceId`, `name`, `createdAt`.
4. **`workflows`**: `id`, `projectId`, `name`, `version`, `definitionGraph` (JSONB), `createdAt`.
5. **`runs`**: `id`, `workflowId`, `status` (`pending`, `running`, `completed`, `failed`), `progressPercent`, `createdAt`.
6. **`assets`**: `id`, `runId`, `type` (`design`, `processed_design`, `mockup`), `storagePath`, `metadata` (JSONB - includes prompt, model, provider provenance), `createdAt`.
7. **`product_variants`**: `id`, `runId`, `designAssetId`, `productType` (`tshirt`, `hoodie`, `sweatshirt`, `wall_art`), `status`, `createdAt`.
8. **`mockup_templates`**: `id`, `workspaceId`, `name`, `type` (`deterministic`, `generative`), `productType`, `config` (JSONB), `createdAt`.
9. **`marketplace_listings`**: `id`, `productVariantId`, `marketplace` (`etsy`, `tpublic`), `externalId`, `status` (`draft`, `published`), `metadata` (JSONB), `createdAt`.
10. **`jobs`**: `id`, `runId`, `stepName`, `status` (`queued`, `processing`, `completed`, `failed`), `errorLog`, `retryCount`, `createdAt`.

---

## 5. PIPELINE & WORKFLOW ENGINE EXECUTION FLOW

Implement the job execution engine using BullMQ queues:

```text
  [1. Design Creation Job] (AI Generation / Uploads)
             │
             ▼
  [2. Approval Checkpoint / Design Selection]
             │
             ▼
  [3. Transformation Processing Job] (Background Removal, Resizing, PNG Conversion)
             │
             ▼
  [4. Product Variant Creation & Fan-Out] (1 Design -> N Variants e.g., T-Shirt, Hoodie)
             │
             ▼
  [5. Mockup Generation Jobs] (Deterministic Composition / AI Generative Templates)
             │
             ▼
  [6. Marketplace Metadata Generation Job] (AI Title, Description, Tag Generation)
             │
             ▼
  [7. Listing Creation & Storage Sync] (Publish/Draft to Etsy, Backup to Google Drive/S3)

```

---

## 6. FRONTEND USER EXPERIENCE & ROUTES

### Key UI Routes

1. `/dashboard` - Overview of workflows, recent runs, connected integrations, asset counter.
2. `/workflows/new` - Step-by-Step POD Wizard:
* **Step 1: Initiation** - Start from scratch or select existing workflow.
* **Step 2: Design Source** - Choose AI Prompt Collection (prompt, count, reference images) or Bulk File Upload.
* **Step 3: Interactive Review Checkpoint** - Grid preview of generated/uploaded designs with select/deselect/delete/regenerate options.
* **Step 4: Product Fan-out & Mockup Templates** - Select target products (T-Shirts, Hoodies) and assign deterministic/AI mockup templates per product.
* **Step 5: Image Processing & Provider Override** - Toggle background removal, upscaling, select providers (Sharp, Fal.ai, OpenRouter).
* **Step 6: Destination & Storage Configuration** - Select Target Marketplaces (Etsy, Google Drive, Local ZIP download).
* **Step 7: Production Summary & Estimate** - Review total product counts, mockup output totals, launch execution.


3. `/runs/:runId` - Real-time job execution dashboard:
* Overall progress bar.
* Breakdown of queued, running, completed, and failed jobs.
* One-click retry button for failed jobs (or retry with alternate provider).


4. `/runs/:runId/listings` - Marketplace Listing Preview:
* Etsy-styled listing cards (main photo carousel, AI-generated title, description, tags, pricing).
* "Publish as Draft", "Publish Live", or "Bulk Draft All" action buttons.
* Export structured ZIP file (`designs/`, `products/`, `mockups/`, `manifest.json`).



---

## 7. AUTOMATED COMPREHENSIVE TESTING REQUIREMENT

Write an extensive test suite covering unit, integration, and end-to-end capabilities using **Vitest** and **Supertest**.

### 1. Unit Tests (`/tests/unit/`)

* **Providers:** Mock external API calls and test OpenRouter, Fal.ai, Sharp deterministic compositor, and S3/Local Storage implementations.
* **Transformations:** Verify Sharp correctly resizes, crops, converts formats, and layers PNG transparent designs onto deterministic mockups.

### 2. Integration Tests (`/tests/integration/`)

* **Workflow Engine:** Mock BullMQ queue processing to test job execution DAG from Design Generation -> Processing -> Mockups -> Metadata Generation -> Draft Listing.
* **API Endpoints:** Test Hono route handlers, Zod schema validation failures, and authorization headers.
* **Database Operations:** Verify database schema transactions, entity relational hierarchy, and run state transitions via Drizzle.

### 3. E2E Workflow Test (`/tests/e2e/workflow.test.ts`)

* Simulate a complete automated run:
1. Trigger workflow creation via API payload.
2. Process a mock design asset.
3. Perform deterministic mockup rendering using Sharp.
4. Generate simulated Etsy draft listing metadata.
5. Generate a structured ZIP archive export and verify its contents against `manifest.json`.



---

## 8. INSTRUCTIONS FOR THE AGENT

1. **Scaffold Project:** Initialize a clean monorepo or standard modular project directory (`/src/server`, `/src/client`, `/src/core`, `/src/db`, `/tests`).
2. **Implement Interfaces First:** Write all capability interfaces in `/src/core/interfaces/`.
3. **Database Setup:** Define Drizzle schemas and create migrations.
4. **Implement Adapters:** Build concrete implementations (Local Storage, S3 Storage, Sharp Mockup Provider, OpenRouter Provider, Fal.ai Provider, Etsy Adapter Stub/API Client).
5. **Implement Job Engine:** Setup Hono server routes, BullMQ queues, and job handlers.
6. **Implement Frontend:** Build the React + Vite frontend using Tailwind CSS, shadcn UI components, and wizard step state machines.
7. **Write Tests & Execute:** Run `npm test` or `vitest run` to ensure all unit, integration, and E2E workflow tests pass with 100% accuracy.

Build the application completely, robustly, and with zero placeholders.

```

```
