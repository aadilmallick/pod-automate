import sharp from 'sharp'
import type { ImageFormat, TransformationProvider } from '../core/interfaces/providers'
import { config } from './config'

/**
 * Artwork preparation adapter implementing {@link TransformationProvider}.
 *
 * Background removal uses `@imgly/background-removal-node` (an offline ONNX model). The model
 * is downloaded and cached on first use under {@link config.TRANSFORM_MODEL_CACHE_DIR}. This
 * keeps background removal an offline, provider-agnostic capability — no API keys, no vendor
 * lock-in. If `TRANSFORM_DRIVER` is `sharp` or `none`, background removal is intentionally
 * unavailable; the pipeline's `prepare` stage should skip it accordingly.
 *
 * `resize` / `upscale` / `convertFormat` are thin Sharp wrappers used to conform designs to a
 * consistent max dimension before mockup rendering.
 */

let backgroundRemovalFn: ((input: Buffer, configArg?: Record<string, unknown>) => Promise<Blob>) | null | undefined

async function loadBackgroundRemoval() {
  if (backgroundRemovalFn !== undefined) return backgroundRemovalFn
  if (config.TRANSFORM_DRIVER === 'sharp' || config.TRANSFORM_DRIVER === 'none') {
    backgroundRemovalFn = null
    return null
  }
  try {
    const mod = await import('@imgly/background-removal-node')
    backgroundRemovalFn = typeof mod.removeBackground === 'function'
      ? async (input) => mod.removeBackground(new Uint8Array(input), { publicPath: config.TRANSFORM_MODEL_CACHE_DIR })
      : null
    return backgroundRemovalFn
  } catch (error) {
    console.warn('[transformations] @imgly/background-removal-node unavailable — background removal disabled:', error instanceof Error ? error.message : error)
    backgroundRemovalFn = null
    return null
  }
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer())
}

function transparentBackground(_w: number, _h: number) {
  return { r: 0, g: 0, b: 0, alpha: 0 }
}

export class SharpResizeProvider implements TransformationProvider {
  readonly id = 'sharp'

  async removeBackground(imageBuffer: Buffer) {
    const removeBackgroundFn = await loadBackgroundRemoval()
    if (!removeBackgroundFn) throw new Error('Background removal is unavailable. Install @imgly/background-removal-node or set TRANSFORM_DRIVER=imgly/auto.')
    const blob = await removeBackgroundFn(imageBuffer)
    return blobToBuffer(blob)
  }

  async resize(imageBuffer: Buffer, width: number, height: number, fit: 'cover' | 'contain' | 'fill' = 'contain') {
    return sharp(imageBuffer).resize({ width, height, fit, position: 'centre', background: transparentBackground(width, height), kernel: 'lanczos3' }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
  }

  async upscale(imageBuffer: Buffer, scaleFactor: number) {
    const scale = Math.max(1, scaleFactor)
    const pipeline = sharp(imageBuffer)
    const metadata = await pipeline.metadata()
    const width = metadata.width ? Math.round(metadata.width * scale) : Math.round(scale)
    const height = metadata.height ? Math.round(metadata.height * scale) : Math.round(scale)
    return pipeline.resize({ width, height, fit: 'contain', position: 'centre', background: transparentBackground(width, height), kernel: 'lanczos3' }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
  }

  async convertFormat(imageBuffer: Buffer, format: ImageFormat) {
    const pipeline = sharp(imageBuffer)
    if (format === 'png') return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    if (format === 'jpeg') return pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    return pipeline.webp({ quality: 94, effort: 4 }).toBuffer()
  }
}

/**
 * Conform a design buffer to a max bounding box (`maxDimension`), preserving aspect ratio with
 * `fit:'contain'` on a transparent canvas. Buffers already within the box are returned untouched
 * (PNG-encoded) so we don't re-encode unnecessarily — callers can short-circuit instead.
 */
export async function conformToMaxDimension(imageBuffer: Buffer, maxDimension: number, provider: TransformationProvider = new SharpResizeProvider()) {
  const metadata = await sharp(imageBuffer).metadata()
  const longest = Math.max(metadata.width ?? 1, metadata.height ?? 1)
  if (longest <= maxDimension) return imageBuffer
  const scale = maxDimension / longest
  const width = Math.max(1, Math.round((metadata.width ?? 1) * scale))
  const height = Math.max(1, Math.round((metadata.height ?? 1) * scale))
  return provider.resize(imageBuffer, width, height, 'fill')
}

export const transformationProvider = new SharpResizeProvider()

export function backgroundRemovalConfigured() {
  return config.TRANSFORM_DRIVER !== 'sharp' && config.TRANSFORM_DRIVER !== 'none'
}

export { transparentBackground }
