import { describe, expect, it, vi } from 'vitest'
import { generateGeminiMockup } from '../../src/server/gemini-mockup'

describe('generateGeminiMockup', () => {
  it('sends the complete design inline and returns the generated image', async () => {
    const output = Buffer.from('generated-image')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ output_image: { data: output.toString('base64'), mime_type: 'image/png' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await generateGeminiMockup({ prompt: 'Preserve this design', image: Buffer.from('source-image'), mimeType: 'image/webp' }, { apiKey: 'secret-key', model: 'gemini-3-pro-image', fetcher })

    expect(result.buffer.equals(output)).toBe(true)
    expect(result.contentType).toBe('image/png')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret-key')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      model: 'gemini-3-pro-image',
      input: [
        { type: 'text', text: 'Preserve this design' },
        { type: 'image', mime_type: 'image/webp', data: Buffer.from('source-image').toString('base64') },
      ],
      response_format: { type: 'image', aspect_ratio: '1:1', image_size: '2K' },
    })
  })

  it('rejects missing credentials before making a request', async () => {
    const fetcher = vi.fn()
    await expect(generateGeminiMockup({ prompt: 'x', image: Buffer.from('x'), mimeType: 'image/png' }, { apiKey: '', model: 'gemini-3-pro-image', fetcher })).rejects.toThrow('Add GEMINI_API_KEY to .env')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports bounded Gemini API errors', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }))
    await expect(generateGeminiMockup({ prompt: 'x', image: Buffer.from('x'), mimeType: 'image/png' }, { apiKey: 'key', model: 'gemini-3-pro-image', fetcher })).rejects.toThrow('Gemini Nano Banana Pro request failed (400): bad request')
  })

  it('rejects responses without an image', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ steps: [] }), { status: 200 }))
    await expect(generateGeminiMockup({ prompt: 'x', image: Buffer.from('x'), mimeType: 'image/png' }, { apiKey: 'key', model: 'gemini-3-pro-image', fetcher })).rejects.toThrow('returned no image data')
  })
})
