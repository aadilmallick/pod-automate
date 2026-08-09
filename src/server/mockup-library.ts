import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProductType } from '../core/interfaces/providers'

export type MockupCategory = 'tshirts' | 'hoodies' | 'posters' | 'canvas' | 'phone'

export interface DownloadedMockupTemplate {
  id: string
  category: MockupCategory
  productType: ProductType
  title: string
  assetPath: string
  assetFile: string
  sourceUrl: string
  sourceKey: string
}

export interface DeterministicTemplateConfig {
  assetPath?: string
  sourceKey?: string
  sourceTitle?: string
  quantity?: number
  boundingBox?: { x: number; y: number; width: number; height: number; rotateDeg?: number }
  blend?: 'over' | 'multiply' | 'screen' | 'soft-light'
  designOpacity?: number
  renderVersion?: 1 | 2
  quality?: 'legacy-flat' | 'draft' | 'verified' | 'generative-only'
  targetQuad?: { topLeft: [number, number]; topRight: [number, number]; bottomRight: [number, number]; bottomLeft: [number, number]; coordinateSpace?: 'normalized' | 'pixels' }
  printMaskPath?: string
  occlusionMaskPath?: string
  shading?: { enabled?: boolean; strength?: number; highlightStrength?: number }
}

export const mockupAssetRoot = resolve(fileURLToPath(new URL('../../download_mockups/', import.meta.url)))

const categoryProductTypes: Record<MockupCategory, ProductType> = {
  tshirts: 'tshirt',
  hoodies: 'hoodie',
  posters: 'wall-art',
  canvas: 'wall-art',
  phone: 'phone-case',
}

function slugify(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function titleTokens(value: string) {
  return new Set(slugify(value).split('-').filter((token) => token.length > 2 && !['the', 'with', 'and', 'for', 'from'].includes(token)))
}

function assetScore(title: string, file: string) {
  const wanted = titleTokens(title)
  const candidate = titleTokens(file.replace(/\.[^.]+$/, ''))
  if (!wanted.size || !candidate.size) return 0
  let overlap = 0
  for (const token of wanted) if (candidate.has(token)) overlap += 1
  return overlap / Math.max(wanted.size, candidate.size)
}

function localAssetForTitle(category: MockupCategory, title: string, used: Set<string>) {
  const files = readdirSync(join(mockupAssetRoot, category)).filter((file) => /\.(webp|png|jpe?g)$/i.test(file)).sort()
  const exact = `${slugify(title)}.webp`
  const exactFile = files.find((file) => file === exact && !used.has(file))
  if (exactFile) return exactFile

  // Titles are human-friendly while local files were renamed during download.
  // Use a stable token score, never the first unrelated unused photo.
  const scored = files
    .filter((file) => !used.has(file))
    .map((file) => ({ file, score: assetScore(title, file) }))
    .filter((entry) => entry.score >= 0.28)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  return scored[0]?.file
}

function readCategory(category: MockupCategory): DownloadedMockupTemplate[] {
  const jsonPath = resolve(fileURLToPath(new URL(`../../mockup_image_templates/${category}.json`, import.meta.url)))
  if (!existsSync(jsonPath)) return []
  const source = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{ title?: string; src?: string }>
  const used = new Set<string>()
  return source.flatMap((entry, index) => {
    const title = entry.title?.trim() || `${category} mockup ${index + 1}`
    const assetFile = localAssetForTitle(category, title, used)
    if (!assetFile) return []
    used.add(assetFile)
    return [{ id: `downloaded-${category}-${index + 1}`, category, productType: categoryProductTypes[category], title, assetPath: join('download_mockups', category, assetFile), assetFile, sourceUrl: entry.src ?? '', sourceKey: `${category}:${index + 1}` }]
  })
}

let cachedLibrary: DownloadedMockupTemplate[] | undefined

export function downloadedMockupTemplates() {
  if (!cachedLibrary) cachedLibrary = (['tshirts', 'hoodies', 'posters', 'canvas', 'phone'] as MockupCategory[]).flatMap(readCategory)
  return cachedLibrary
}

export function mockupTemplatePreviewPath(config: unknown) {
  const value = (config && typeof config === 'object' ? config : {}) as DeterministicTemplateConfig
  if (!value.assetPath) return undefined
  const parts = value.assetPath.replace(/\\/g, '/').split('/')
  if (parts[0] !== 'download_mockups' || parts.length !== 3) return undefined
  return `/mockup-assets/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`
}

export function defaultMockupTemplate(productType: string, title = '') {
  const normalizedProductType = productType === 'sweatshirt' ? 'tshirt' : productType
  const templates = downloadedMockupTemplates().filter((template) => template.productType === normalizedProductType)
  const normalizedTitle = title.toLowerCase()
  const preferred = templates.find((template) => normalizedTitle && (template.title.toLowerCase().includes(normalizedTitle) || normalizedTitle.includes(template.title.toLowerCase())))
  return preferred ?? templates[0]
}

function placementProfile(template: DownloadedMockupTemplate) {
  const title = template.title.toLowerCase()
  if (template.productType === 'phone-case') return { x: 0.3, y: 0.18, width: 0.4, height: 0.64 }
  if (template.productType === 'wall-art') return { x: 0.24, y: 0.16, width: 0.52, height: 0.58 }
  if (/flat|folded|hanging|rack|mannequin|front view/.test(title)) return { x: 0.24, y: 0.2, width: 0.52, height: 0.52 }
  return template.productType === 'hoodie' ? { x: 0.18, y: 0.2, width: 0.64, height: 0.52 } : { x: 0.2, y: 0.23, width: 0.6, height: 0.48 }
}

export function configForDownloadedTemplate(template: DownloadedMockupTemplate): DeterministicTemplateConfig {
  return { assetPath: template.assetPath, sourceKey: template.sourceKey, sourceTitle: template.title, boundingBox: placementProfile(template), quantity: 1, renderVersion: 1, quality: 'legacy-flat' }
}

export function parseTemplateConfig(value: unknown): DeterministicTemplateConfig {
  return value && typeof value === 'object' ? value as DeterministicTemplateConfig : {}
}

export function resolveMockupAssetPath(config: unknown, productType: string, title: string) {
  const parsed = parseTemplateConfig(config)
  if (parsed.assetPath) {
    const normalized = parsed.assetPath.replace(/\\/g, '/')
    if (!normalized.startsWith('download_mockups/')) return undefined
    const candidate = resolve(mockupAssetRoot, normalized.slice('download_mockups/'.length))
    const relativePath = relative(mockupAssetRoot, candidate)
    if (!relativePath.startsWith('..') && !isAbsolute(relativePath) && existsSync(candidate)) return candidate
    return undefined
  }
  const fallback = defaultMockupTemplate(productType, title)
  return fallback ? resolve(mockupAssetRoot, fallback.assetPath.replace(/^download_mockups[\\/]/, '')) : undefined
}

export function assetCategoryForProduct(productType: string) {
  return Object.entries(categoryProductTypes).find(([, value]) => value === productType)?.[0] as MockupCategory | undefined
}

export function assetFileName(path: string) {
  return basename(path, extname(path))
}
