import sharp from 'sharp'
import { existsSync } from 'node:fs'
import type { DeterministicMockupSpec, ProductType } from '../core/interfaces/providers'
import { computeHomography, invertHomography, isConvexQuad, project, type Point, type Quad } from '../core/perspective'
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

function numberOr(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }

function placementFor(productType: string, config: DeterministicTemplateConfig, width: number, height: number): Placement {
  const defaults = defaultPlacements[productType] ?? defaultPlacements['wall-art']
  const box = config.boundingBox
  const x = numberOr(box?.x, defaults.x); const y = numberOr(box?.y, defaults.y)
  const boxWidth = numberOr(box?.width, defaults.width); const boxHeight = numberOr(box?.height, defaults.height)
  const normalized = [x, y, boxWidth, boxHeight].every((value) => value >= 0 && value <= 1)
  return { x: Math.round(normalized ? x * width : x), y: Math.round(normalized ? y * height : y), width: Math.max(1, Math.round(normalized ? boxWidth * width : boxWidth)), height: Math.max(1, Math.round(normalized ? boxHeight * height : boxHeight)), rotateDeg: numberOr(box?.rotateDeg, 0) }
}

function clampPlacement(placement: Placement, width: number, height: number): Placement {
  const x = Math.max(0, Math.min(placement.x, width - 1)); const y = Math.max(0, Math.min(placement.y, height - 1))
  return { ...placement, x, y, width: Math.max(1, Math.min(placement.width, width - x)), height: Math.max(1, Math.min(placement.height, height - y)) }
}

function blendFor(productType: string, config: DeterministicTemplateConfig) {
  if (config.blend) return config.blend
  return productType === 'wall-art' || productType === 'phone-case' ? 'over' : 'soft-light'
}

function normalizedQuad(config: DeterministicTemplateConfig, width: number, height: number): Quad | undefined {
  const quad = config.targetQuad
  if (!quad) return undefined
  const points: Point[] = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return undefined
  const destination = points.map(([x, y]) => quad.coordinateSpace === 'pixels' ? [x, y] : [x * width, y * height]) as Quad
  return isConvexQuad(destination) ? destination : undefined
}

async function prepareArtwork(designBuffer: Buffer, placement: Placement, productType: string, configuredOpacity?: number) {
  const resized = await sharp(designBuffer).rotate(numberOr(placement.rotateDeg, 0), { background: { r: 255, g: 255, b: 255, alpha: 0 } }).resize({ width: placement.width, height: placement.height, fit: 'contain', position: 'centre', background: { r: 255, g: 255, b: 0, alpha: 0 }, kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (productType === 'tshirt' || productType === 'hoodie' || productType === 'sweatshirt') {
    for (let offset = 0; offset < resized.data.length; offset += resized.info.channels) {
      const red = resized.data[offset]; const green = resized.data[offset + 1]; const blue = resized.data[offset + 2]
      if (red > 248 && green > 248 && blue > 248) resized.data[offset + 3] = 0
      else if (red > 235 && green > 235 && blue > 235) resized.data[offset + 3] = Math.round(((248 - Math.max(red, green, blue)) / 13) * resized.data[offset + 3])
    }
  }
  const opacity = Math.max(0, Math.min(1, numberOr(configuredOpacity, 1)))
  if (opacity < 1) for (let offset = 3; offset < resized.data.length; offset += resized.info.channels) resized.data[offset] = Math.round(resized.data[offset] * opacity)
  return sharp(resized.data, { raw: resized.info }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
}

async function perspectiveArtwork(designBuffer: Buffer, destination: Quad, outputWidth: number, outputHeight: number, productType: string, opacity?: number) {
  const source = await sharp(designBuffer).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (productType === 'tshirt' || productType === 'hoodie' || productType === 'sweatshirt') {
    for (let offset = 0; offset < source.data.length; offset += source.info.channels) {
      const red = source.data[offset]; const green = source.data[offset + 1]; const blue = source.data[offset + 2]
      if (red > 248 && green > 248 && blue > 248) source.data[offset + 3] = 0
      else if (red > 235 && green > 235 && blue > 235) source.data[offset + 3] = Math.round(((248 - Math.max(red, green, blue)) / 13) * source.data[offset + 3])
    }
  }
  const sourceQuad: Quad = [[0, 0], [source.info.width - 1, 0], [source.info.width - 1, source.info.height - 1], [0, source.info.height - 1]]
  const inverse = invertHomography(computeHomography(sourceQuad, destination))
  const output = Buffer.alloc(outputWidth * outputHeight * 4)
  const minX = Math.max(0, Math.floor(Math.min(...destination.map((point) => point[0])))); const maxX = Math.min(outputWidth - 1, Math.ceil(Math.max(...destination.map((point) => point[0]))))
  const minY = Math.max(0, Math.floor(Math.min(...destination.map((point) => point[1])))); const maxY = Math.min(outputHeight - 1, Math.ceil(Math.max(...destination.map((point) => point[1]))))
  const opacityValue = Math.max(0, Math.min(1, numberOr(opacity, 1)))
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const [sourceX, sourceY] = project(inverse, [x + 0.5, y + 0.5])
    if (sourceX < 0 || sourceY < 0 || sourceX > source.info.width - 1 || sourceY > source.info.height - 1) continue
    const x0 = Math.floor(sourceX); const y0 = Math.floor(sourceY); const x1 = Math.min(source.info.width - 1, x0 + 1); const y1 = Math.min(source.info.height - 1, y0 + 1); const fx = sourceX - x0; const fy = sourceY - y0
    const out = (y * outputWidth + x) * 4
    for (let channel = 0; channel < 4; channel += 1) {
      const top = source.data[(y0 * source.info.width + x0) * 4 + channel] * (1 - fx) + source.data[(y0 * source.info.width + x1) * 4 + channel] * fx
      const bottom = source.data[(y1 * source.info.width + x0) * 4 + channel] * (1 - fx) + source.data[(y1 * source.info.width + x1) * 4 + channel] * fx
      output[out + channel] = Math.round((top * (1 - fy) + bottom * fy) * (channel === 3 ? opacityValue : 1))
    }
  }
  return sharp(output, { raw: { width: outputWidth, height: outputHeight, channels: 4 } }).png().toBuffer()
}

async function applyMask(layer: Buffer, maskPath: string | undefined, width: number, height: number) {
  if (!maskPath || !existsSync(maskPath)) return layer
  const mask = await sharp(maskPath).resize({ width, height, fit: 'fill' }).ensureAlpha().png().toBuffer()
  return sharp(layer).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

/** Render a design into a downloaded template. Verified templates use a projective quad; old templates retain flat rendering. */
export async function renderDeterministicMockup(designBuffer: Buffer, options: DeterministicRenderOptions) {
  const config = parseTemplateConfig(options.templateConfig)
  const assetPath = resolveMockupAssetPath(config, options.productType, options.templateName)
  if (!assetPath || !existsSync(assetPath)) throw new Error(`Deterministic mockup asset is unavailable for ${options.templateName || options.productType}`)
  const base = sharp(assetPath).rotate(); const metadata = await base.metadata()
  const outputWidth = options.outputWidth ?? metadata.width ?? 750; const outputHeight = options.outputHeight ?? metadata.height ?? 750
  const destination = normalizedQuad(config, outputWidth, outputHeight)
  let artwork: Buffer
  if (destination) artwork = await perspectiveArtwork(designBuffer, destination, outputWidth, outputHeight, options.productType, config.designOpacity)
  else {
    const placement = clampPlacement(placementFor(options.productType, config, outputWidth, outputHeight), outputWidth, outputHeight)
    artwork = await prepareArtwork(designBuffer, placement, options.productType, config.designOpacity)
  }
  const maskPath = config.printMaskPath && resolveMockupAssetPath({ assetPath: config.printMaskPath }, options.productType, options.templateName)
  artwork = await applyMask(artwork, maskPath, outputWidth, outputHeight)
  let composite = sharp(assetPath).rotate().resize({ width: outputWidth, height: outputHeight, fit: 'fill', kernel: 'lanczos3' }).composite([{ input: artwork, left: 0, top: 0, blend: blendFor(options.productType, config) }])
  if (config.occlusionMaskPath) {
    const occlusionPath = resolveMockupAssetPath({ assetPath: config.occlusionMaskPath }, options.productType, options.templateName)
    if (occlusionPath && existsSync(occlusionPath)) composite = composite.composite([{ input: occlusionPath, left: 0, top: 0, blend: 'over' }])
  }
  return composite.webp({ quality: 94, effort: 4 }).toBuffer()
}

export async function renderDeterministicFromSpec(spec: DeterministicMockupSpec, outputFormat: 'webp' | 'png' = 'webp') {
  const base = sharp(spec.baseImageBuffer).rotate(); const metadata = await base.metadata(); const width = metadata.width ?? 750; const height = metadata.height ?? 750
  const placement = clampPlacement(spec.boundingBox, width, height)
  const input = await sharp(spec.designBuffer).rotate().resize({ width: placement.width, height: placement.height, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: 'lanczos3' }).ensureAlpha().png().toBuffer()
  const pipeline = base.composite([{ input, left: placement.x, top: placement.y, blend: 'over' }])
  return outputFormat === 'png' ? pipeline.png({ compressionLevel: 9 }).toBuffer() : pipeline.webp({ quality: 94, effort: 4 }).toBuffer()
}
