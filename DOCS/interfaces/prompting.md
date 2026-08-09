# Prompting System (Layered Image Prompts)

> **Source of truth:** `src/core/prompting.ts`
> **Inspiration:** `DOCS/image_generation/tips.md` (the layered-prompting guide that started it all)

The prompting engine implements **layered prompting**: instead of a single blob of text, prompts
are composed from explicit layers — subject, style, composition, camera/detail, lighting/color,
mood/finish — plus a negative-prompt layer. This produces dramatically more consistent output from
image models.

## 1. Styles (`ImageStyle`)

```ts
type ImageStyle = 'illustration' | 'watercolor' | 'editorial' | 'vintage' | 'flat-vector'
               | '3d-render' | 'photorealistic' | 'anime'
```

`imageStyleOptions` maps each style id to a label, a human description (used in the wizard UI) and
a **prompt fragment** used when building prompts:

| id | label | prompt fragment |
|---|---|---|
| `illustration` | Illustration | refined contemporary illustration, confident linework, purposeful shapes, subtle texture, polished commercial artwork |
| `watercolor` | Watercolor | delicate watercolor painting, translucent layered pigments, visible cold-pressed paper grain, organic edges, nuanced washes |
| `editorial` | Editorial | premium editorial art direction, sophisticated visual hierarchy, restrained details, art-book composition, fashion-magazine sensibility |
| `vintage` | Vintage poster | vintage screen-print poster aesthetic, limited ink palette, authentic halftone texture, subtle paper wear, era-appropriate graphic design |
| `flat-vector` | Flat vector | clean flat vector artwork, bold geometric silhouettes, controlled outlines, minimal gradients, screen-print friendly separation |
| `3d-render` | 3D render | high-end stylized 3D render, precise materials, smooth dimensional forms, carefully controlled highlights, premium product-visualization quality |
| `photorealistic` | Photorealistic | photorealistic image, physically believable materials, natural fine detail, realistic optics, authentic surface texture |
| `anime` | Anime | polished anime-inspired artwork, expressive cel shading, intentional silhouette design, cinematic framing, clean production finish |

## 2. Subject detection

`detectSubjectType(prompt)` heuristically classifies the subject so the right layers activate:

| Keywords | Subject type |
|---|---|
| person, people, woman, man, child, girl, boy, portrait, character, cat, dog, animal | character or living subject |
| landscape, mountain, forest, beach, city, building, room, interior, street, scene | environment or scene |
| pattern, abstract, geometric, shape, symbol, cosmic, dream | abstract visual concept |
| (fallback) | designed object or subject |

This mirrors the "subject-aware layers" idea from `DOCS/image_generation/tips.md`.

## 3. Negative prompts

`defaultNegativePrompt(includeText, customNegativePrompt?)` composes:

1. `commonNegativePrompt` — always: blurry, low resolution, muddy details, weak contrast,
   awkward tangents, cluttered composition, cropped subject, accidental border, watermark, logo,
   signature, malformed anatomy, duplicate elements, plastic-looking texture, oversaturated
   colors, harsh artifacts.
2. `noTextNegativePrompt` — only when `includeText === false`: visible words, letters,
   typography, captions, slogans, labels, logos, watermark, signature, gibberish text, misspelled
   text, random symbols.
3. User-supplied custom negative prompt (optional).

Terms are deduplicated (Set) and joined with `, `.

## 4. `buildDesignPrompt` (design generation)

Input: `{ prompt, style, includeText, negativePrompt?, width = 1024, height = 1024 }`

Output: a single paragraph with explicit layers:

1. **Subject** — `Subject: {prompt}. Treat this as a {subjectType} and make the central idea
   immediately readable.`
2. **Style** — `Style: {styleFragment}.`
3. **Composition** — centered hero subject, clear silhouette, balanced negative space, strong
   focal point, cohesive shapes, intentional visual hierarchy, premium print-on-demand suitability.
4. **Camera and detail** — square `{width}x{height}`, front-facing or gently three-quarter view,
   controlled perspective, crisp edges, selectively refined details, no accidental cropping.
5. **Lighting and color** — soft directional studio light, gentle contact shadows, cohesive
   palette (vintage gets "limited retro"), deliberate contrast, nuanced highlights/shadows.
6. **Mood and finish** — memorable, commercially polished, tactile, visually coherent; plus a
   text direction:
   - `includeText: true` → "If the concept calls for lettering, use only the exact requested
     wording, with clean intentional typography and ample breathing room; do not invent extra copy."
   - `includeText: false` → "Do not include any readable text or lettering; communicate the idea
     through imagery, silhouette, color, and visual metaphor only."
7. **Avoid** — the composed negative prompt.

## 5. `buildMockupPrompt` (generative mockups)

Input: `{ templateName, productType, designPrompt, style, includeText, negativePrompt? }`

Output layers:

1. **Subject** — "Create a photorealistic {productType} product mockup for the artwork concept:
   {designPrompt}."
2. **Artwork integrity** — use the `{templateName}` scene as tasteful art direction while keeping
   the product as hero; the printed artwork must remain the exact central design, front-facing,
   correctly scaled, undistorted, fully visible, naturally integrated. **Never redesign, replace,
   mirror, stretch, crop, or obscure the artwork.**
3. **Material realism** — believable fabric/product texture, accurate seams and folds, subtle ink
   absorption, physically correct occlusion, natural contact shadows, realistic highlights,
   premium commercial product photography.
4. **Composition and camera** — square ecommerce-ready frame, eye-level or gently three-quarter
   view, 50mm lens, shallow but useful depth of field, clean subject separation, no distracting
   props, generous breathing room.
5. **Lighting and environment** — soft large-source window/studio lighting, gentle directional
   shadows, realistic reflections, calm styled background supporting the style label without
   competing.
6. **Text direction** — preserve intentional lettering exactly, or don't add any (mirrors
   `includeText`).
7. **Avoid** — negative prompt plus mockup-specific terms: warped garment, floating product,
   impossible folds, extra products, mannequin anatomy, hands covering the artwork, unreadable or
   invented branding.

## 6. Where it's used

| Call site | Function |
|---|---|
| `src/server/workflow-runner.ts` design stage | `buildDesignPrompt` (1024×1024) |
| `src/server/workflow-runner.ts` generative mockups | `buildMockupPrompt` (provider called at 1600×1600) |
| `src/server/prompt-builder.ts` | re-exports core functions for the server layer |
| Frontend wizard | style selection (labels/descriptions only; prompts built server-side) |

The negative prompt is built **once** per run (`defaultNegativePrompt`) and reused for both design
and mockup generation, so a user's "additional things to avoid" applies everywhere.

## 7. Tests

`tests/unit/prompting.test.ts` pins the behavior:
- style + subject-aware + no-text guidance present in output,
- intentional lettering (`includeText: true`) does **not** include the text negative layer,
- mockup prompts contain artwork-preservation + material-realism directives,
- custom negative prompts are merged in.

**Extending:** to add a style, add an entry to `imageStyleOptions` — no other code changes needed
(the wizard renders the catalog dynamically). To add layers, keep `buildDesignPrompt` /
`buildMockupPrompt` returning a single joined paragraph (providers receive one `prompt` string).
