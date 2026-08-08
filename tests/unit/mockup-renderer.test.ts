import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { renderDeterministicMockup } from '../../src/server/mockup-renderer'
import { mockupAssetRoot, resolveMockupAssetPath } from '../../src/server/mockup-library'

async function solidDesign(color: { r: number; g: number; b: number; alpha?: number }) {
  return sharp({ create: { width: 120, height: 120, channels: 4, background: { ...color, alpha: color.alpha ?? 1 } } }).png().toBuffer()
}

describe('deterministic photographic mockups', () => {
  it('renders a deterministic WebP using a downloaded template', async () => {
    const output = await renderDeterministicMockup(await solidDesign({ r: 215, g: 45, b: 75 }), {
      productType: 'tshirt',
      templateName: 'Photo · Simple white t-shirt mockup',
    })
    const metadata = await sharp(output).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(750)
    expect(metadata.height).toBe(750)
  })

  it('keeps transparent artwork from painting the whole apparel placement rectangle', async () => {
    const output = await renderDeterministicMockup(await solidDesign({ r: 215, g: 45, b: 75, alpha: 0.5 }), {
      productType: 'tshirt',
      templateName: 'Photo · Simple white t-shirt mockup',
      templateConfig: { boundingBox: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
    })
    const metadata = await sharp(output).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(750)
    expect(metadata.height).toBe(750)
  })

  it('does not resolve template paths outside the downloaded asset root', () => {
    expect(resolveMockupAssetPath({ assetPath: `${mockupAssetRoot}/../secret.webp` }, 'tshirt', 'missing')).toBeUndefined()
    expect(resolveMockupAssetPath({ assetPath: '/tmp/secret.webp' }, 'tshirt', 'missing')).toBeUndefined()
  })
})
