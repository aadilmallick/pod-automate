export type ImageStyle = 'illustration' | 'watercolor' | 'editorial' | 'vintage' | 'flat-vector' | '3d-render' | 'photorealistic' | 'anime'

export interface ImageStyleOption {
  id: ImageStyle
  label: string
  description: string
  prompt: string
}

export const imageStyleOptions: ImageStyleOption[] = [
  { id: 'illustration', label: 'Illustration', description: 'Expressive, polished artwork with a hand-drawn character.', prompt: 'refined contemporary illustration, confident linework, purposeful shapes, subtle texture, polished commercial artwork' },
  { id: 'watercolor', label: 'Watercolor', description: 'Soft pigment, paper grain, and organic color transitions.', prompt: 'delicate watercolor painting, translucent layered pigments, visible cold-pressed paper grain, organic edges, nuanced washes' },
  { id: 'editorial', label: 'Editorial', description: 'Art-directed composition with a premium print feel.', prompt: 'premium editorial art direction, sophisticated visual hierarchy, restrained details, art-book composition, fashion-magazine sensibility' },
  { id: 'vintage', label: 'Vintage poster', description: 'Aged print character with intentional retro color.', prompt: 'vintage screen-print poster aesthetic, limited ink palette, authentic halftone texture, subtle paper wear, era-appropriate graphic design' },
  { id: 'flat-vector', label: 'Flat vector', description: 'Crisp shapes and clean silhouettes that reproduce well.', prompt: 'clean flat vector artwork, bold geometric silhouettes, controlled outlines, minimal gradients, screen-print friendly separation' },
  { id: '3d-render', label: '3D render', description: 'Playful dimensional forms with studio-quality shading.', prompt: 'high-end stylized 3D render, precise materials, smooth dimensional forms, carefully controlled highlights, premium product-visualization quality' },
  { id: 'photorealistic', label: 'Photorealistic', description: 'Natural detail, believable light, and photographic depth.', prompt: 'photorealistic image, physically believable materials, natural fine detail, realistic optics, authentic surface texture' },
  { id: 'anime', label: 'Anime', description: 'Cinematic cel shading and expressive visual language.', prompt: 'polished anime-inspired artwork, expressive cel shading, intentional silhouette design, cinematic framing, clean production finish' },
]

const commonNegativePrompt = 'blurry, low resolution, muddy details, weak contrast, awkward tangents, cluttered composition, cropped subject, accidental border, watermark, logo, signature, malformed anatomy, duplicate elements, plastic-looking texture, oversaturated colors, harsh artifacts'
const noTextNegativePrompt = 'visible words, letters, typography, captions, slogans, labels, logos, watermark, signature, gibberish text, misspelled text, random symbols'

function styleFor(style: ImageStyle) {
  return imageStyleOptions.find((option) => option.id === style) ?? imageStyleOptions[0]
}

function detectSubjectType(prompt: string) {
  const normalized = prompt.toLowerCase()
  if (/\b(person|people|woman|man|child|girl|boy|portrait|character|cat|dog|animal)\b/.test(normalized)) return 'character or living subject'
  if (/\b(landscape|mountain|forest|beach|city|building|room|interior|street|scene)\b/.test(normalized)) return 'environment or scene'
  if (/\b(pattern|abstract|geometric|shape|symbol|cosmic|dream)\b/.test(normalized)) return 'abstract visual concept'
  return 'designed object or subject'
}

export function defaultNegativePrompt(includeText: boolean, customNegativePrompt = '') {
  const layers = [commonNegativePrompt]
  if (!includeText) layers.push(noTextNegativePrompt)
  if (customNegativePrompt.trim()) layers.push(customNegativePrompt.trim())
  return [...new Set(layers.join(', ').split(',').map((item) => item.trim()).filter(Boolean))].join(', ')
}

export function buildDesignPrompt({ prompt, style, includeText, negativePrompt, width = 1024, height = 1024 }: { prompt: string; style: ImageStyle; includeText: boolean; negativePrompt?: string; width?: number; height?: number }) {
  const selectedStyle = styleFor(style)
  const subjectType = detectSubjectType(prompt)
  const textDirection = includeText
    ? 'If the concept calls for lettering, use only the exact requested wording, with clean intentional typography and ample breathing room; do not invent extra copy.'
    : 'Do not include any readable text or lettering; communicate the idea through imagery, silhouette, color, and visual metaphor only.'
  const negative = defaultNegativePrompt(includeText, negativePrompt)
  return [
    `Subject: ${prompt.trim()}. Treat this as a ${subjectType} and make the central idea immediately readable.`,
    `Style: ${selectedStyle.prompt}.`,
    `Composition: centered hero subject, clear silhouette, balanced negative space, strong focal point, cohesive shapes, intentional visual hierarchy, artwork suitable for premium print-on-demand products.`,
    `Camera and detail: square ${width}x${height} composition, front-facing or gently three-quarter view where appropriate, controlled perspective, crisp edges, selectively refined details, no accidental cropping.`,
    `Lighting and color: soft directional studio light with gentle contact shadows, harmonious ${selectedStyle.id === 'vintage' ? 'limited retro' : 'cohesive'} color palette, deliberate contrast, nuanced highlights and shadows.`,
    `Mood and finish: memorable, commercially polished, tactile, visually coherent, high-quality final artwork. ${textDirection}`,
    `Avoid: ${negative}.`,
  ].join(' ')
}

export function buildMockupPrompt({ templateName, productType, designPrompt, style, includeText, negativePrompt }: { templateName: string; productType: string; designPrompt: string; style: ImageStyle; includeText: boolean; negativePrompt?: string }) {
  const selectedStyle = styleFor(style)
  const negative = defaultNegativePrompt(includeText, negativePrompt)
  const textDirection = includeText
    ? 'Preserve any intentional artwork lettering exactly and keep it sharp and correctly oriented.'
    : 'The artwork contains no text; do not add labels, slogans, logos, or random lettering anywhere in the scene.'
  return [
    `Create a photorealistic ${productType} product mockup for the artwork concept: ${designPrompt.trim()}.`,
    `Use the “${templateName}” scene as tasteful art direction while keeping the product as the hero. The printed artwork must remain the exact central design, front-facing, correctly scaled, undistorted, fully visible, and naturally integrated into the product surface.`,
    `Material realism: believable fabric or product texture, accurate seams and folds, subtle ink absorption, physically correct occlusion, natural contact shadows, realistic highlights, premium commercial product photography.`,
    `Composition and camera: square ecommerce-ready frame, eye-level or gently three-quarter product view, 50mm lens, shallow but useful depth of field, clean subject separation, no distracting props, generous breathing room.`,
    `Lighting and environment: soft large-source window or studio lighting, gentle directional shadows, realistic reflections where appropriate, calm styled background that supports the ${selectedStyle.label.toLowerCase()} artwork without competing with it.`,
    `${textDirection} Do not redesign, replace, mirror, stretch, crop, or obscure the artwork.`,
    `Avoid: ${negative}, warped garment, floating product, impossible folds, extra products, mannequin anatomy, hands covering the artwork, unreadable or invented branding.`,
  ].join(' ')
}
