# Feature: Listings & Destinations

The final stage of a run turns product variants into **marketplace listings** per chosen
destination, and offers a **structured ZIP export** as the universal fallback.

## 1. Destinations

A run carries `destinations: string[]`. The wizard offers four; the worker treats them uniformly:

| id | Label (UI) | Listing status created |
|---|---|---|
| `etsy` | Etsy | `draft` |
| `tpublic` | TeePublic | `draft` |
| `drive` | Google Drive | `draft` |
| `download` | Structured download | `ready` |

**Important:** today destinations are **placeholders** — no live marketplace adapter is wired up
(yet). Selecting Etsy creates `marketplace_listings` rows with `status: 'draft'` and generated
metadata; the real upload/publish flow is the future `MarketplaceAdapter` implementation (see
`DOCS/interfaces/providers.md` §6). The `download` destination is fully functional: it produces
`ready` listings and enables the ZIP export button.

## 2. Listing generation (worker)

In `src/server/workflow-runner.ts`, per variant × destination:

```ts
await db.insert(marketplaceListings).values({
  productVariantId: variant.id,
  marketplace: destination,
  status: destination === 'download' ? 'ready' : 'draft',
  metadata: {
    title: `${prompt.slice(0, 65)} · ${productType}`,
    tags: ['print on demand', productType, 'original design'],
  },
})
```

So every design × product × destination gets a listing row. Titles/tags are deterministic today —
AI metadata generation is a future step (the workflow graph already has a `metadata` node type).

## 3. Viewing listings

- **Run monitor**: the listings panel (`liveListings`) renders cards from `GET /api/runs/:id`
  with title, type, tags, status badge.
- **API**: `GET /api/runs/:id/listings` returns the raw rows.
- Dashboard catalog aggregates recent listings with statuses `ready`/`draft` counted as "Ready to
  publish".

## 4. ZIP export

`GET /api/runs/:id/export.zip` → `exportRunZip(runId)` in `src/server/zip.ts`:

- Uses `archiver` (zip, level 9) streaming into a buffer.
- **`manifest.json`** — the full structured payload: `{ run, assets, variants, mockups,
  listings }` serialized with 2-space indent. This is the machine-readable provenance record.
- **Designs**: `source-designs/{safe-name}.{ext}` for `type: 'uploaded-design'` assets,
  `generated-designs/{safe-name}.{ext}` for `type: 'design'`.
- **Mockups**: `mockups/mockup-{NNN}.{ext}` in insertion order.
- Filenames are sanitized (`safeName` strips non `[a-zA-Z0-9._-]`); extensions derived from the
  storage path or content type.

The UI exposes the download as an anchor when the run is `completed`:

```
<a href={`/api/runs/${runId}/export.zip`} download>Download structured ZIP ↓</a>
```

## 5. The future `MarketplaceAdapter` shape

When live integrations land, each adapter will:

- `authenticate(credentials)` — OAuth/token flows,
- `getRequirements()` — declare max title length + required image dimensions (so the pipeline can
  derive transformations automatically — the "marketplace requirements drive processing" principle
  from `conversation.md`),
- `createDraftListing(payload)` — upload images + metadata as a draft,
- `publishListing(externalListingId)` — flip to live.

The `MarketplaceListingPayload` interface (`title`, `description`, `tags`, `price`,
`mainImageBuffer`, `mockupImageBuffers`, `sku?`, `category?`) is the universal product shape each
adapter converts to its marketplace-specific representation.

## Related docs

- Marketplace interface contract: `DOCS/interfaces/providers.md` §6
- Run execution producing listings: `DOCS/architecture/pipeline.md`
- Extending with a real marketplace: `DOCS/development/extending.md` §2
