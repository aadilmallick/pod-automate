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
  quantity: number
  taxonomyId: number
  shippingProfileId: number
  readinessStateId: number
  whoMade: 'i_did' | 'collective' | 'someone_else'
  whenMade: string
  isSupply: boolean
  sku: string
  images: Array<{ buffer: Buffer; contentType: string; filename: string }>
}

export interface MarketplaceContext { accessToken: string; shopId: string }

export interface MarketplaceAdapter {
  readonly id: string
  getRequirements(): { maxTitleLength: number; maxTags: number; maxImages: number }
  createDraftListing(context: MarketplaceContext, payload: MarketplaceListingPayload): Promise<{ externalListingId: string; draftUrl: string; raw: unknown }>
  updateDraftListing(context: MarketplaceContext, externalListingId: string, payload: MarketplaceListingPayload): Promise<{ externalListingId: string; draftUrl: string; raw: unknown }>
  publishListing(context: MarketplaceContext, externalListingId: string): Promise<{ success: boolean; url: string; raw: unknown }>
}
