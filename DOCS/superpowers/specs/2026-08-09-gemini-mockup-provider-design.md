# Gemini Nano Banana Pro Mockup Provider Design

## Goal

Add Gemini Nano Banana Pro as a dedicated provider for AI-generated product mockups. Design generation remains on the workflow's selected image provider. Deterministic mockup templates remain unchanged.

## Scope

The feature applies only to templates whose kind is `generative`. For those templates, the pipeline sends the original design image and textual scene direction to Gemini. Gemini creates the product, material interaction, camera, lighting, and environment around the artwork.

The feature does not place artwork into an existing mockup photograph. Existing deterministic templates already cover that workflow.

## Architecture

The server gains a Gemini adapter dedicated to the mockup capability. It uses the existing provider boundary where practical, but it is selected independently from the workflow's design-generation provider.

Configuration is server-side and environment-driven:

- `GEMINI_API_KEY` holds the secret.
- `GEMINI_MOCKUP_MODEL` defaults to `gemini-3-pro-image`, the Gemini API model ID for Nano Banana Pro.
- `MOCKUP_AI_PROVIDER` defaults to `gemini` and leaves room for additional generative-mockup providers without changing workflow logic.

The workflow snapshot continues to record the design provider and model. Generated mockup metadata or job context records the mockup provider and model so outputs remain traceable.

## Data Flow

1. The workflow creates or loads the original design asset using the existing design path.
2. A deterministic template continues through Sharp compositing with no Gemini dependency.
3. A generative template selects the configured mockup provider, independent of the design provider.
4. The server reads the original design bytes and determines their MIME type.
5. The Gemini adapter sends a Gemini Interactions API request containing the preservation-first prompt and the design as inline base64 image data.
6. The request asks for one square, 2K image from `gemini-3-pro-image` by default.
7. The adapter extracts the returned image bytes, and the existing storage path persists the mockup.

Remote design URLs are not exposed to Gemini. The server fetches or reads the asset and sends inline bytes, which also supports local storage URLs that Gemini cannot access.

## Prompt Contract

The mockup prompt treats the input as immutable source artwork, not loose inspiration. It must:

- Identify the input image as the exact print artwork.
- Preserve every visible shape, line, color, proportion, composition, edge, texture, and intentional character.
- Preserve intentional text exactly when present and add no text when absent.
- Forbid redesigning, redrawing, restyling, simplifying, extending, mirroring, cropping, recoloring, or substituting the artwork.
- Permit only perspective warping, occlusion, lighting, shadows, highlights, texture response, and print/material interaction required to place the unchanged artwork naturally on the product.
- Keep the entire artwork readable and make the product the photographic hero.
- Use the product type and generative template name as scene direction.
- Request premium, believable ecommerce photography without invented branding or distracting props.

Prompt construction remains a pure function so preservation language and template-specific direction can be unit tested without calling Gemini.

## API Integration

The adapter calls the Gemini Interactions API using an `x-goog-api-key` header. Its input contains a text block and one image block with MIME type and base64 data. The response format requests an image with a `1:1` aspect ratio and `2K` size.

The adapter accepts dependency-injected `fetch` behavior or an equivalent test seam. Tests validate the real request payload and response parsing without making paid network calls.

## Configuration and UI

Gemini appears in the Connections page as `Gemini · Nano Banana Pro`, including configured status, default mockup model, enable/disable state, and connection testing. It does not appear in the design-provider selector or prompt-template provider selector because it is mockup-only.

The Gemini API key remains in `.env` and never enters the database or browser bundle. `.env.example` and provider documentation describe how to configure it.

The API rejects a workflow that includes generative templates when Gemini is enabled as the mockup provider but `GEMINI_API_KEY` is absent. The response explicitly asks for `GEMINI_API_KEY`. Workflows containing only deterministic templates do not require Gemini credentials.

## Error Handling

- Missing key: fail before queueing a generative-mockup run with an actionable configuration error.
- Gemini HTTP error: include provider name, status, and a bounded response detail without exposing the API key.
- No returned image: fail the affected mockup job with a specific empty-image error.
- Unsupported response data: reject it rather than storing an invalid file.
- Existing job retry behavior handles transient provider failures.

## Testing

Unit tests will cover:

- Preservation-first prompt requirements and product/template direction.
- Gemini request model, inline image, MIME type, response format, and API-key header.
- Gemini image extraction and malformed/empty response handling.
- Missing-key behavior.
- Generative templates choosing Gemini independently of the design provider.
- Deterministic templates never requiring or calling Gemini.
- Provider catalogs and validation exposing Gemini only as a mockup connection.

The final verification includes the focused tests, the full unit suite, and the production build.

## Credential Handoff

Implementation and unit testing do not require a real Gemini key. After the adapter, configuration, tests, and UI wiring are complete, the user will be prompted to add `GEMINI_API_KEY` to `.env`. The key will not be requested in chat. Once configured, a live connection test can verify access to Nano Banana Pro.
