import { describe, expect, it } from 'vitest'
import { buildDesignPrompt, buildGeminiMockupPrompt, buildMockupPrompt, defaultNegativePrompt } from '../../src/core/prompting'

describe('layered image prompting', () => {
  it('adds style, subject-aware composition, and no-text guidance', () => {
    const prompt = buildDesignPrompt({
      prompt: 'A sleepy cat curled up on a crescent moon',
      style: 'watercolor',
      includeText: false,
    })

    expect(prompt).toContain('watercolor painting')
    expect(prompt).toContain('character or living subject')
    expect(prompt).toContain('Do not include any readable text')
    expect(prompt).toContain('watermark')
    expect(prompt).toContain('gibberish text')
  })

  it('allows intentional lettering without adding a text negative layer', () => {
    const negative = defaultNegativePrompt(true)
    const prompt = buildDesignPrompt({ prompt: 'A poster that says GOOD VIBES', style: 'vintage', includeText: true })

    expect(prompt).toContain('exact requested wording')
    expect(negative).not.toContain('gibberish text')
    expect(prompt).toContain('limited retro')
  })

  it('directs mockups to preserve artwork and render realistic materials', () => {
    const prompt = buildMockupPrompt({
      templateName: 'Coffee shop',
      productType: 'hoodie',
      designPrompt: 'A botanical tiger',
      style: 'illustration',
      includeText: false,
      negativePrompt: 'neon pink',
    })

    expect(prompt).toContain('photorealistic hoodie product mockup')
    expect(prompt).toContain('exact central design')
    expect(prompt).toContain('physically correct occlusion')
    expect(prompt).toContain('neon pink')
    expect(prompt).toContain('do not add labels')
  })
})

describe('buildGeminiMockupPrompt', () => {
  it('preserves the supplied artwork while directing the product scene', () => {
    const prompt = buildGeminiMockupPrompt({ templateName: 'Sunlit city street', productType: 't-shirt', includeText: true })

    expect(prompt).toContain('immutable source artwork')
    expect(prompt).toContain('t-shirt')
    expect(prompt).toContain('Sunlit city street')
    expect(prompt).toContain('Do not redesign, redraw, restyle, simplify, extend, mirror, crop, recolor, or substitute')
    expect(prompt).toContain('Preserve every intentional word and character exactly')
    expect(prompt).toContain('perspective warping, physical occlusion, lighting, shadows, highlights, and material texture response')
  })

  it('forbids invented lettering when the design has no text', () => {
    const prompt = buildGeminiMockupPrompt({ templateName: 'Studio hero', productType: 'phone case', includeText: false })

    expect(prompt).toContain('Do not add any words, letters, logos, labels, or branding')
  })
})
