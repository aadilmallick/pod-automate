export type ImageFormat = 'png' | 'jpeg' | 'webp'
export type ProductType = 'tshirt' | 'hoodie' | 'sweatshirt' | 'phone-case' | 'wall-art'

export interface ImageGenerationRequest {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  count: number
  referenceImageUrls?: string[]
  model?: string
}

export interface ImageGenerationProvider {
  readonly id: string
  generateImages(request: ImageGenerationRequest): Promise<{
    urls: string[]
    rawResponse: unknown
  }>
}

export interface StorageProvider {
  put(path: string, buffer: Buffer, contentType: string): Promise<string>
  get(path: string): Promise<Buffer>
  delete(path: string): Promise<void>
  getPublicUrl(path: string): Promise<string>
}

export interface TransformationProvider {
  removeBackground(imageBuffer: Buffer): Promise<Buffer>
  upscale(imageBuffer: Buffer, scaleFactor: number): Promise<Buffer>
  resize(imageBuffer: Buffer, width: number, height: number, fit?: 'cover' | 'contain' | 'fill'): Promise<Buffer>
  convertFormat(imageBuffer: Buffer, format: ImageFormat): Promise<Buffer>
}

export interface DeterministicMockupSpec {
  baseImageBuffer: Buffer
  designBuffer: Buffer
  overlayBuffer?: Buffer
  boundingBox: { x: number; y: number; width: number; height: number; rotateDeg?: number }
}

export interface MockupProvider {
  renderDeterministic(spec: DeterministicMockupSpec): Promise<Buffer>
  renderGenerative(templatePrompt: string, designUrl: string, options: Record<string, unknown>): Promise<Buffer>
}

export interface MarketplaceListingPayload {
  title: string
  description: string
  tags: string[]
  price: number
  mainImageBuffer: Buffer
  mockupImageBuffers: Buffer[]
  sku?: string
  category?: string
}

export interface MarketplaceAdapter {
  readonly id: string
  authenticate(credentials: Record<string, string>): Promise<boolean>
  getRequirements(): { maxTitleLength: number; requiredImageDimensions: { width: number; height: number } }
  createDraftListing(payload: MarketplaceListingPayload): Promise<{ externalListingId: string; draftUrl: string }>
  publishListing(externalListingId: string): Promise<{ success: boolean; url: string }>
}
