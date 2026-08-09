import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { conformToMaxDimension } from '../../src/server/transformations'

async function makeBuffer(width: number, height: number) {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
}

describe('transformations', () => {
  it('does not resize when already within max dimension', async () => {
    const original = await makeBuffer(800, 600)
    const result = await conformToMaxDimension(original, 1200)
    expect(result).toBe(original)
  })

  it('resizes preserving aspect ratio when exceeding max dimension', async () => {
    const original = await makeBuffer(2400, 1600)
    const result = await conformToMaxDimension(original, 1200)
    const metadata = await sharp(result).metadata()
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(1200)
    expect(metadata.width).toBe(1200)
    expect(metadata.height).toBe(800)
  })
})
