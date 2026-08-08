import sharp from 'sharp'
import { existsSync } from 'node:fs'
import type { DeterministicMockupSpec, ProductType } from '../core/interfaces/providers'
import { parseTemplateConfig, resolveMockupAssetPath, type DeterministicTemplateConfig } from './mockup-library'

export interface DeterministicRenderOptions {
  productType: ProductType | string
  templateName: string
  templateConfig?: unknown
  outputWidth?: number
  outputHeight?: number
}

interface Placement { x: number; y: number; width: number; height: number; rotateDeg?: number }

const defaultPlacements: Record<string, Placement> = {
  tshirt: { x: 0.2, y: 0.23, width: 0.6, height: 0.48 },
  hoodie: { x: 0.18, y: 0.2, width: 0.64, height: 0.52 },
  sweatshirt: { x: 0.19, y: 0.21, width: 0.62, height: 0.5 },
  'phone-case': { x: 0.29, y: 0.2, width: 0.42, height: 0.6 },
  'wall-art': { x: 0.24, y: 0.16, width: 0.52, height: 0.58 },
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function placementFor(productType: string, config: DeterministicTemplateConfig, width: number, height: number): Placement {
  const defaults = defaultPlacements[productType] ?? defaultPlacements['wall-art']
  const box = config.boundingBox
  const x = numberOr(box?.x, defaults.x)
  const y = numberOr(box?.y, defaults.y)
  const boxWidth = numberOr(box?.width, defaults.width)
  const boxHeight = numberOr(box?.height, defaults.height)
  const normalized = [x, y, boxWidth, boxHeight].every((value) => value >= 0 && value <= 1)
  return {
    x: Math.round(normalized ? x * width : x),
    y: Math.round(normalized ? y * height : y),
    width: Math.max(1, Math.round(normalized ? boxWidth * width : boxWidth)),
    height: Math.max(1, Math.round(normalized ? boxHeight * height : boxHeight)),
    rotateDeg: numberOr(box?.rotateDeg, 0),
  }
}

function clampPlacement(placement: Placement, width: number, height: number): Placement {
  const x = Math.max(0, Math.min(placement.x, width - 1))
  const y = Math.max(0, Math.min(placement.y, height - 1))
  return { ...placement, x, y, width: Math.max(1, Math.min(placement.width, width - x)), height: Math.max(1, Math.min(placement.height, height - y)) }
}

function blendFor(productType: string, config: DeterministicTemplateConfig) {
  if (config.blend) return config.blend
  return productType === 'wall-art' || productType === 'phone-case' ? 'over' : 'multiply'
}

async function prepareArtwork(designBuffer: Buffer, placement: Placement, productType: string, configuredOpacity?: number) {
  const resized = await sharp(designBuffer)
    .rotate(numberOr(placement.rotateDeg, 0), { background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .resize({ width: placement.width, height: placement.height, fit: 'contain', position: 'centre', background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // AI images are often opaque squares. For apparel, remove only near-white canvas
  // pixels so the print is transparent around its artwork; other products retain it.
  if (productType === 'tshirt' || productType === 'hoodie' || productType === 'sweatshirt') {
    for (let offset = 0; offset < resized.data.length; offset += resized.info.channels) {
      const red = resized.data[offset]
      const green = resized.data[offset + 1]
      const blue = resized.data[offset + 2]
      if (red > 238 && green > 238 && blue > 238) resized.data[offset + 3] = 0
      else if (red > 220 && green > 220 && blue > 220) resized.data[offset + 3] = Math.round(((238 - Math.max(red, green, blue)) / 18) * 255)
    }
  }

  const opacity = Math.max(0, Math.min(1, numberOr(configuredOpacity, 1)))
  if (opacity < 1) {
    for (let offset = 3; offset < resized.data.length; offset += resized.info.channels) resized.data[offset] = Math.round(resized.data[offset] * opacity)
  }

  return sharp(resized.data, { raw: resized.info }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
}

/** Render a design into one of the downloaded photographic mockup templates. */
export async function renderDeterministicMockup(designBuffer: Buffer, options: DeterministicRenderOptions) {
  const config = parseTemplateConfig(options.templateConfig)
  const assetPath = resolveMockupAssetPath(config, options.productType, options.templateName)
  if (!assetPath || !existsSync(assetPath)) throw new Error(`Deterministic mockup asset is unavailable for ${options.templateName || options.productType}`)

  const base = sharp(assetPath).rotate()
  const metadata = await base.metadata()
  const outputWidth = options.outputWidth ?? metadata.width ?? 750
  const outputHeight = options.outputHeight ?? metadata.height ?? 750
  const placement = clampPlacement(placementFor(options.productType, config, outputWidth, outputHeight), outputWidth, outputHeight)
  const artwork = await prepareArtwork(designBuffer, placement, options.productType, config.designOpacity)

  return sharp(assetPath)
    .rotate()
    .resize({ width: outputWidth, height: outputHeight, fit: 'fill', kernel: 'lanczos3' })
    .composite([{ input: artwork, left: placement.x, top: placement.y, blend: blendFor(options.productType, config) }])
    .webp({ quality: 94, effort: 4 })
    .toBuffer()
}

export async function renderDeterministicFromSpec(spec: DeterministicMockupSpec, outputFormat: 'webp' | 'png' = 'webp') {
  const base = sharp(spec.baseImageBuffer).rotate()
  const metadata = await base.metadata()
  const width = metadata.width ?? 750
  const height = metadata.height ?? 750
  const placement = clampPlacement(spec.boundingBox, width, height)
  const input = await sharp(spec.designBuffer).rotate().resize({ width: placement.width, height: placement.height, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: 'lanczos3' }).ensureAlpha().png().toBuffer()
  const pipeline = base.composite([{ input, left: placement.x, top: placement.y, blend: 'over' }])
  return outputFormat === 'png' ? pipeline.png({ compressionLevel: 9 }).toBuffer() : pipeline.webp({ quality: 94, effort: 4 }).toBuffer()
}
