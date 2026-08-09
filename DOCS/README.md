# Pod Automator — Documentation

This folder is the canonical engineering documentation for the **Pod Automator** codebase. It
complements (and goes deeper than) the root `AGENTS.md` and `README.md`.

## How to navigate

```
DOCS/
├── README.md                       ← you are here (the map)
├── ARCHITECTURE.md                 ← system overview, principles, module map
│
├── architecture/
│   ├── data-model.md               ← PostgreSQL schema, entity relationships, lifecycle
│   ├── pipeline.md                 ← production pipeline, job graph, run lifecycle
│   └── deployment.md               ← cloud vs self-hosted, Docker Compose, process model
│
├── interfaces/
│   ├── providers.md                ← ★ the capability interfaces (Storage, AI, Transform, Mockup, Marketplace)
│   ├── prompting.md                ← layered prompt engine (design + mockup prompts)
│   └── workflow.md                 ← workflow graph model, policies, estimates
│
├── features/
│   ├── wizard.md                   ← multi-step production wizard (the main UI flow)
│   ├── run-monitor.md              ← run execution dashboard & live polling
│   ├── connections.md              ← provider connections & connection testing
│   ├── mockups.md                  ← deterministic vs generative mockup templates
│   ├── listings-and-destinations.md← marketplace listings, destinations, ZIP export
│   └── assets-and-storage.md       ← asset library, uploads, storage drivers
│
├── api/
│   └── endpoints.md                ← full REST endpoint reference + Zod schemas
│
├── server/
│   ├── ai-providers.md             ← mock / OpenRouter / Fal.ai / Hugging Face / Ollama
│   ├── workflow-runner.md          ← how the BullMQ worker executes a run
│   ├── mockup-rendering.md         ← Sharp deterministic compositing details
│   ├── mockup-library.md           ← downloaded template registry & path resolution
│   └── auth.md                     ← dev identity + Google OAuth + workspace seeding
│
├── development/
│   ├── setup.md                    ← full local setup, Docker, three-process dev loop
│   ├── testing.md                  ← test suite structure and how to add tests
│   └── extending.md                ← how to add providers, marketplaces, template categories
│
├── image_generation/
│   └── tips.md                     ← layered prompting guide (original reference)
│
└── reference/
    ├── env-vars.md                 ← every environment variable, defaults, validation
    ├── commands.md                 ← npm scripts, Docker, Bun tooling
    └── glossary.md                 ← domain vocabulary (workspace, run, variant, …)
```

## Best reading order for new contributors

1. **ARCHITECTURE.md** — what the system is and the principles it follows
2. **interfaces/providers.md** — the contracts everything is built against
3. **architecture/data-model.md** — how state is persisted
4. **architecture/pipeline.md** — how a run actually executes
5. **api/endpoints.md** — what the frontend talks to
6. **development/extending.md** — before you add anything new

## Conventions used in these docs

- `src/...` paths are relative to the repository root.
- Code snippets are drawn from the current implementation; if a snippet drifts from the code, the
  code is the source of truth.
- ★ marks "read this first" items.
