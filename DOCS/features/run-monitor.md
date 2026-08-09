# Feature: Run Monitor

The run monitor (`RunMonitor` in `src/App.tsx`) is the live execution dashboard shown after
launching a workflow. It's the `run` view of the app, keyed by a `runId`.

## What it shows

1. **Run hero** — overall progress bar + status line:
   - "Processing in the background." while running
   - "Completed and ready for review." on success
   - "The worker reported an error. Review the pipeline below." on failure
2. **Pipeline progress panel** — the run's `jobs` rows (design stage, per-variant mockup jobs)
   rendered with state icons (✓ complete / ⋯ processing / ! failed / numbered queued) and error
   text. Retry buttons are present in the UI for running jobs (currently non-functional wiring).
3. **Listing drafts panel** — `marketplace_listings` for the run, mapped to cards with
   title/type/tags/status badges.
4. **Generated assets** — the run's `assets` (designs) + `mockups`, shown as a thumbnail grid.
   When the run is complete, a **Download structured ZIP** link appears:
   `GET /api/runs/:id/export.zip`.

## Data flow: polling, not websockets

```ts
useEffect(() => { …poll every 2500ms… }, [runId])
```

Every 2.5 seconds the component fetches **in parallel**:

- `getRun(runId)` → `GET /api/runs/:id` (run record, assets+urls, mockups+urls, jobs, listings)
- `getDashboardCatalog()` → `GET /api/dashboard/catalog` (for run meta + latest status)

Polling stops when the component unmounts (cleanup clears the interval and flips an `active`
flag). The UI explicitly tells the user: "You can leave this page and come back anytime" — the
run is persisted and processing happens in the worker, so the dashboard can be closed.

## States handled

| Run status | UI treatment |
|---|---|
| `queued` | hero shows queued jobs, progress 0 |
| `running` | live progress from `progressPercent`, animated list |
| `completed` | 100%, download button enabled |
| `failed` | error guidance, failed job rows show `errorLog` |

While the API is still starting (first paint), errors are swallowed (`/* API may still be
starting */`) so the dashboard doesn't flash error states during a cold boot.

## Related docs

- Worker execution that produces this data: `DOCS/architecture/pipeline.md`
- ZIP export format: `DOCS/features/listings-and-destinations.md` §4
- API shapes: `DOCS/api/endpoints.md` (`GET /api/runs/:id`)
