import { Buffer } from 'node:buffer'
import type { ImageGenerationProvider, ImageGenerationRequest } from '../core/interfaces/providers'
import { config } from './config'

function svgDataUrl(label: string, hue: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="${hue}"/><circle cx="512" cy="430" r="210" fill="#ffffff" opacity=".32"/><text x="512" y="530" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700" font-size="42">${label.slice(0, 28)}</text><text x="512" y="590" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="22">POD AUTOMATOR</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export class MockImageProvider implements ImageGenerationProvider {
  readonly id = 'mock'
  async generateImages(request: ImageGenerationRequest) { return { urls: Array.from({ length: request.count }, (_, index) => svgDataUrl(`${request.prompt} ${index + 1}`, ['#7869db', '#e1a15c', '#5aa982', '#cf7188'][index % 4])), rawResponse: { mock: true } } }
}

export class OpenRouterImageProvider implements ImageGenerationProvider {
  readonly id = 'openrouter'
  async generateImages(request: ImageGenerationRequest) {
    if (!config.OPENROUTER_API_KEY) return new MockImageProvider().generateImages(request)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': config.WEB_URL, 'X-Title': 'POD Automator' }, body: JSON.stringify({ model: request.model ?? config.OPENROUTER_IMAGE_MODEL, modalities: ['text', 'image'], messages: [{ role: 'user', content: request.prompt }], n: request.count }) })
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`)
    const data = await response.json() as { choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }> }
    const urls = data.choices?.flatMap((choice) => choice.message?.images?.map((image) => image.image_url?.url).filter((url): url is string => Boolean(url)) ?? []) ?? []
    if (!urls.length) throw new Error('OpenRouter returned no image URLs')
    return { urls, rawResponse: data }
  }
}

export class FalImageProvider implements ImageGenerationProvider {
  readonly id = 'fal'
  async generateImages(request: ImageGenerationRequest) {
    if (!config.FAL_API_KEY) return new MockImageProvider().generateImages(request)
    const response = await fetch(`https://fal.run/${request.model ?? config.FAL_IMAGE_MODEL}`, { method: 'POST', headers: { Authorization: `Key ${config.FAL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: request.prompt, num_images: request.count, image_size: { width: request.width, height: request.height } }) })
    if (!response.ok) throw new Error(`Fal.ai request failed (${response.status})`)
    const data = await response.json() as { images?: Array<{ url?: string }> }
    const urls = data.images?.map((image) => image.url).filter((url): url is string => Boolean(url)) ?? []
    if (!urls.length) throw new Error('Fal.ai returned no image URLs')
    return { urls, rawResponse: data }
  }
}

export function imageProvider(id: string = config.AI_PROVIDER): ImageGenerationProvider { return id === 'fal' ? new FalImageProvider() : id === 'mock' ? new MockImageProvider() : new OpenRouterImageProvider() }
