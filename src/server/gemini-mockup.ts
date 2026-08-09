import { Buffer } from 'node:buffer'
import { config } from './config'

type GeminiOptions = { apiKey?: string; model?: string; fetcher?: typeof fetch }

function findImage(value: unknown): { data: string; mimeType: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.data === 'string' && (typeof record.mime_type === 'string' || typeof record.media_type === 'string')) {
    return { data: record.data, mimeType: String(record.mime_type ?? record.media_type) }
  }
  for (const key of ['output_image', 'steps', 'content']) {
    const child = record[key]
    if (Array.isArray(child)) {
      for (const item of child) { const found = findImage(item); if (found) return found }
    } else {
      const found = findImage(child)
      if (found) return found
    }
  }
  return undefined
}

export async function generateGeminiMockup(request: { prompt: string; image: Buffer; mimeType: string; model?: string }, options: GeminiOptions = {}) {
  const apiKey = options.apiKey ?? config.GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini Nano Banana Pro is not configured. Add GEMINI_API_KEY to .env.')
  const model = request.model ?? options.model ?? config.GEMINI_MOCKUP_MODEL
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        { type: 'text', text: request.prompt },
        { type: 'image', mime_type: request.mimeType, data: request.image.toString('base64') },
      ],
      response_format: { type: 'image', aspect_ratio: '1:1', image_size: '2K' },
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let detail = body.slice(0, 500)
    try { const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }; detail = parsed.error?.message ?? parsed.message ?? detail } catch { /* retain text */ }
    throw new Error(`Gemini Nano Banana Pro request failed (${response.status}): ${detail || response.statusText}`)
  }
  const rawResponse = await response.json() as unknown
  const image = findImage(rawResponse)
  if (!image || !image.mimeType.startsWith('image/')) throw new Error('Gemini Nano Banana Pro returned no image data.')
  return { buffer: Buffer.from(image.data, 'base64'), contentType: image.mimeType, rawResponse }
}
