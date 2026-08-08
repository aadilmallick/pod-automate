import { Buffer } from 'node:buffer'
import { InferenceClient } from '@huggingface/inference'
import type { ImageGenerationProvider, ImageGenerationRequest } from '../core/interfaces/providers'
import { config } from './config'

function svgDataUrl(label: string, hue: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="${hue}"/><circle cx="512" cy="430" r="210" fill="#ffffff" opacity=".32"/><text x="512" y="530" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700" font-size="42">${label.slice(0, 28)}</text><text x="512" y="590" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="22">POD AUTOMATOR</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function dataUrl(value: string, mediaType = 'image/png') {
  return value.startsWith('data:') ? value : `data:${mediaType};base64,${value}`
}

function collectImageUrls(value: unknown, output: string[] = [], imageHint = false): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.startsWith('http://') || value.startsWith('https://')) output.push(value)
    else if (imageHint && value.length > 100) output.push(dataUrl(value))
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, output, imageHint)
    return output
  }
  if (!value || typeof value !== 'object') return output
  const record = value as Record<string, unknown>
  const contentType = typeof record.content_type === 'string' ? record.content_type : typeof record.media_type === 'string' ? record.media_type : undefined
  const isImage = imageHint || Boolean(contentType?.startsWith('image/'))
  if (typeof record.b64_json === 'string') output.push(dataUrl(record.b64_json, contentType ?? 'image/png'))
  if (typeof record.url === 'string' && (isImage || record.url.startsWith('data:image/'))) output.push(record.url)
  if (typeof record.image_url === 'string') output.push(record.image_url)
  if (record.image_url && typeof record.image_url === 'object') collectImageUrls(record.image_url, output, true)
  if (record.inline_data && typeof record.inline_data === 'object') {
    const inline = record.inline_data as Record<string, unknown>
    if (typeof inline.data === 'string') output.push(dataUrl(inline.data, typeof inline.mime_type === 'string' ? inline.mime_type : 'image/png'))
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'image_url' && key !== 'inline_data') collectImageUrls(child, output, isImage || ['images', 'image', 'content', 'parts', 'output', 'response', 'generated_image'].includes(key))
  }
  return output
}

async function responseError(response: Response, provider: string) {
  const body = await response.text().catch(() => '')
  let detail = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message ?? detail
  } catch { /* keep text */ }
  return new Error(`${provider} request failed (${response.status}): ${detail || response.statusText}`)
}

export function defaultModelForProvider(provider: string) {
  if (provider === 'fal') return config.FAL_IMAGE_MODEL
  if (provider === 'openrouter') return config.OPENROUTER_IMAGE_MODEL
  if (provider === 'huggingface') return config.HUGGINGFACE_IMAGE_MODEL
  if (provider === 'ollama') return config.OLLAMA_IMAGE_MODEL
  return 'local-mock'
}

export class MockImageProvider implements ImageGenerationProvider {
  readonly id = 'mock'
  async generateImages(request: ImageGenerationRequest) { return { urls: Array.from({ length: request.count }, (_, index) => svgDataUrl(`${request.prompt} ${index + 1}`, ['#7869db', '#e1a15c', '#5aa982', '#cf7188'][index % 4])), rawResponse: { mock: true } } }
}

export class OpenRouterImageProvider implements ImageGenerationProvider {
  readonly id = 'openrouter'
  async generateImages(request: ImageGenerationRequest) {
    if (!config.OPENROUTER_API_KEY) throw new Error('OpenRouter is not configured. Add OPENROUTER_API_KEY to .env.')
    const response = await fetch('https://openrouter.ai/api/v1/images', { method: 'POST', headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': config.WEB_URL, 'X-Title': 'POD Automator' }, body: JSON.stringify({ model: request.model ?? config.OPENROUTER_IMAGE_MODEL, prompt: request.prompt, negative_prompt: request.negativePrompt, n: request.count, resolution: '1K', aspect_ratio: '1:1', ...(request.referenceImageUrls?.length ? { input_references: request.referenceImageUrls.map((url) => ({ type: 'image_url', image_url: { url } })) } : {}) }) })
    if (!response.ok) throw await responseError(response, 'OpenRouter')
    const data = await response.json() as unknown
    const urls = [...new Set(collectImageUrls(data))]
    if (!urls.length) throw new Error('OpenRouter returned no image data. Check that the selected model supports image generation.')
    return { urls, rawResponse: data }
  }
}

export class FalImageProvider implements ImageGenerationProvider {
  readonly id = 'fal'
  async generateImages(request: ImageGenerationRequest) {
    if (!config.FAL_API_KEY) throw new Error('Fal.ai is not configured. Add FAL_API_KEY to .env.')
    const response = await fetch(`https://fal.run/${request.model ?? config.FAL_IMAGE_MODEL}`, { method: 'POST', headers: { Authorization: `Key ${config.FAL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: request.prompt, negative_prompt: request.negativePrompt, num_images: request.count, image_size: { width: request.width, height: request.height }, output_format: 'png', ...(request.referenceImageUrls?.[0] ? { reference_image_url: request.referenceImageUrls[0] } : {}) }) })
    if (!response.ok) throw await responseError(response, 'Fal.ai')
    const data = await response.json() as unknown
    const urls = [...new Set(collectImageUrls(data))]
    if (!urls.length) throw new Error('Fal.ai returned no image URLs. Check the selected model and API key.')
    return { urls, rawResponse: data }
  }
}

export class HuggingFaceImageProvider implements ImageGenerationProvider {
  readonly id = 'huggingface'
  private readonly client: InferenceClient

  constructor() {
    if (!config.HUGGINGFACE_TOKEN) throw new Error('Hugging Face is not configured. Add HUGGINGFACE_TOKEN to .env.')
    this.client = new InferenceClient(config.HUGGINGFACE_TOKEN)
  }

  async generateImages(request: ImageGenerationRequest) {
    const image = await this.client.textToImage({
      model: request.model ?? config.HUGGINGFACE_IMAGE_MODEL,
      inputs: request.prompt,
      parameters: { width: request.width, height: request.height, negative_prompt: request.negativePrompt },
    }, { outputType: 'blob' })
    const buffer = Buffer.from(await image.arrayBuffer())
    return { urls: [dataUrl(buffer.toString('base64'), image.type || 'image/png')], rawResponse: { provider: 'huggingface', model: request.model ?? config.HUGGINGFACE_IMAGE_MODEL, contentType: image.type || 'image/png' } }
  }
}

function collectOllamaImageUrls(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectOllamaImageUrls(item, output)
    return output
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) output.push(dataUrl(value))
    return output
  }
  const record = value as Record<string, unknown>
  for (const key of ['image', 'images', 'base64', 'b64_json', 'data', 'response', 'output', 'generated_image']) {
    if (key in record) collectOllamaImageUrls(record[key], output)
  }
  return output
}

export class OllamaImageProvider implements ImageGenerationProvider {
  readonly id = 'ollama'

  async generateImages(request: ImageGenerationRequest) {
    const baseUrl = config.OLLAMA_BASE_URL.replace(/\/$/, '')
    const model = request.model ?? config.OLLAMA_IMAGE_MODEL
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: `${request.prompt}${request.negativePrompt ? ` Avoid: ${request.negativePrompt}.` : ''}`, stream: false, options: { width: request.width, height: request.height } }),
    })
    if (!response.ok) throw await responseError(response, 'Ollama')
    const data = await response.json() as unknown
    const urls = [...new Set(collectOllamaImageUrls(data))]
    if (!urls.length) throw new Error(`Ollama returned no image data for ${model}. Pull the model first with \"ollama pull ${model}\" and confirm image generation is supported on this host.`)
    return { urls, rawResponse: data }
  }
}

export function imageProvider(id: string = config.AI_PROVIDER): ImageGenerationProvider {
  if (id === 'fal') return new FalImageProvider()
  if (id === 'huggingface') return new HuggingFaceImageProvider()
  if (id === 'ollama') return new OllamaImageProvider()
  return id === 'mock' ? new MockImageProvider() : new OpenRouterImageProvider()
}

export async function generateImages(provider: ImageGenerationProvider, request: ImageGenerationRequest) {
  const urls: string[] = []
  const responses: unknown[] = []
  while (urls.length < request.count) {
    const remaining = request.count - urls.length
    const result = await provider.generateImages({ ...request, count: Math.min(remaining, 4) })
    urls.push(...result.urls)
    responses.push(result.rawResponse)
    if (!result.urls.length) break
  }
  return { urls: urls.slice(0, request.count), rawResponse: responses }
}
