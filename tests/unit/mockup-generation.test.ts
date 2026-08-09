import { describe, expect, it, vi } from 'vitest'
import { generateMockupImage } from '../../src/server/mockup-generation'

describe('generateMockupImage', () => {
  it('uses Gemini with the original design bytes independently of design generation', async () => {
    const generator = vi.fn(async () => ({ buffer: Buffer.from('mockup'), contentType: 'image/png', rawResponse: {} }))
    const design = Buffer.from('exact-design')

    const result = await generateMockupImage({ designBuffer: design, designContentType: 'image/webp', templateName: 'City street', productType: 'hoodie', includeText: false }, { provider: 'gemini', model: 'gemini-3-pro-image', generator })

    expect(result).toMatchObject({ contentType: 'image/png', provider: 'gemini', model: 'gemini-3-pro-image' })
    expect(generator.mock.calls[0][0].image.equals(design)).toBe(true)
    expect(generator.mock.calls[0][0].mimeType).toBe('image/webp')
    expect(generator.mock.calls[0][0].prompt).toContain('hoodie')
  })

  it('rejects unsupported mockup providers', async () => {
    await expect(generateMockupImage({ designBuffer: Buffer.from('x'), designContentType: 'image/png', templateName: 'x', productType: 'shirt', includeText: false }, { provider: 'other' as 'gemini' })).rejects.toThrow('Unsupported mockup provider')
  })
})
