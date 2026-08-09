# AI Providers (image generation)

> **Source of truth:** `src/server/ai.ts`

Five `ImageGenerationProvider` implementations are available. They are selected by
`AI_PROVIDER` (env default) or per-run `provider`, and each has its own model allowlist and
configuration source.

Gemini Nano Banana Pro is separate from these design providers. For a `generative` mockup template, the worker sends the original design bytes to the Gemini Interactions API with a preservation-first prompt and requests one square 2K result from `gemini-3-pro-image`. Configure `GEMINI_API_KEY`; deterministic templates do not use Gemini.

## 1. Provider matrix

| id | Class | Endpoint/SDK | Model env | Credential env | Notes |
|---|---|---|---|---|---|
| `mock` | `MockImageProvider` | none | — | — | Returns SVG data-URL placeholders (labeled squares). Zero-cost smoke tests. |
| `openrouter` | `OpenRouterImageProvider` | `POST https://openrouter.ai/api/v1/images` | `OPENROUTER_IMAGE_MODEL` (default `google/gemini-3.1-flash-image`) | `OPENROUTER_API_KEY` | Unified image API, many models; supports reference images |
| `fal` | `FalImageProvider` | `POST https://fal.run/{model}` | `FAL_IMAGE_MODEL` (default `fal-ai/flux/schnell`) | `FAL_API_KEY` | Model-specific endpoints, `num_images`, `image_size` |
| `huggingface` | `HuggingFaceImageProvider` | `@huggingface/inference` `textToImage` | `HUGGINGFACE_IMAGE_MODEL` (default `black-forest-labs/FLUX.2-klein-9B`) | `HUGGINGFACE_TOKEN` | Returns **one** image per call |
| `ollama` | `OllamaImageProvider` | `POST {OLLAMA_BASE_URL}/api/generate` | `OLLAMA_IMAGE_MODEL` (default `x/flux2-klein`; `x/flux2-klein:9b` also available) | none (local service) | Experimental image generation; reports model status clearly |

## 2. Request mapping per provider

| Field | openrouter | fal | huggingface | ollama |
|---|---|---|---|---|
| model | `model` | URL path (`fal.run/{model}`) | `model` | `model` |
| prompt | `prompt` | `prompt` | `inputs` | `prompt` |
| negative | `negative_prompt` | `negative_prompt` | `parameters.negative_prompt` | appended as `Avoid: …` |
| count | `n` | `num_images` | (1) | (1) |
| size | `resolution: '1K'`, `aspect_ratio: '1:1'` | `image_size: {width, height}` | `parameters.width/height` | `options.width/height` |
| references | `input_references: [{type:'image_url', image_url:{url}}]` | `reference_image_url` (first only) | — | — |

## 3. Response normalization

Every provider returns `{ urls: string[], rawResponse: unknown }` where urls are `http(s)` URLs
**or `data:` URIs**. Providers hand back wildly different payloads, so `collectImageUrls` (and
`collectOllamaImageUrls`) recursively walk the response and collect anything that looks like an
image:

- `data:image/…` strings and `http(s)` URLs,
- `b64_json` / `inline_data.data` → data URI,
- `image_url` (string or nested `{url}`),
- arrays and nested objects with hints from content/media type or keys like `images`, `image`,
  `content`, `parts`, `output`, `response`, `generated_image`.

URLs are deduplicated (`Set`). If nothing is found, the provider throws a descriptive error
(e.g. "OpenRouter returned no image data. Check that the selected model supports image
generation.").

## 4. The `generateImages` helper (batching)

```ts
export async function generateImages(provider, request) {
  // loops, requesting at most 4 at a time, until `count` urls collected
}
```

- Applies to all providers (Hugging Face naturally returns 1/call → many calls).
- Collects each batch's `rawResponse` into an array (provenance).
- Stops early if a provider returns zero urls.

## 5. Model allowlists & validation

`providerModels` (in `src/server/index.ts`) defines what the API accepts per provider:

```ts
fal:          [config.FAL_IMAGE_MODEL]
openrouter:   [config.OPENROUTER_IMAGE_MODEL]
huggingface:  [config.HUGGINGFACE_IMAGE_MODEL, 'black-forest-labs/FLUX.2-klein-9B']
ollama:       [config.OLLAMA_IMAGE_MODEL, config.OLLAMA_IMAGE_MODEL_9B]
mock:         ['local-mock']
```

`validProviderModel(provider, model)` gates prompt templates, connection settings, and run
creation. To support more models, extend this map (see `DOCS/development/extending.md` §1).

## 6. Error handling

`responseError(response, provider)` extracts a readable message from provider error bodies
(`error.message` / `message` / raw text, truncated to 500 chars). Credential-missing errors are
thrown proactively with actionable messages ("Add OPENROUTER_API_KEY to .env.").

## 7. Connection testing

`POST /api/connections/test` performs provider-specific liveness checks — see
`DOCS/features/connections.md`. For Ollama it also reports whether the requested model is
installed (`/api/tags`), so the UI can tell users to `ollama pull` before running.

## 8. Adding a provider

Follow `DOCS/development/extending.md` §1 — it's a small, well-contained surface:

1. Implement `ImageGenerationProvider` in `src/server/ai.ts`.
2. Add config keys to `config.ts` + `.env.example`.
3. Add to `imageProvider()` factory + `defaultModelForProvider`.
4. Add model allowlist entry + `providerConfigured` in `index.ts`.
5. (Optional) wire a connection test in `/api/connections/test`.
