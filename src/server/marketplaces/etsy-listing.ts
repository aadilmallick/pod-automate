export interface EtsyListingData { title: string; description: string; tags: string[]; price: number; quantity: number; taxonomyId: number; shippingProfileId: number; readinessStateId: number; whoMade: 'i_did' | 'collective' | 'someone_else'; whenMade: string; isSupply: boolean; sku: string; imageIds: string[] }

const names: Record<string, string> = { tshirt: 'T-Shirt', hoodie: 'Hoodie', sweatshirt: 'Sweatshirt', 'phone-case': 'Phone Case', 'wall-art': 'Wall Art' }
const prefixes: Record<string, string> = { tshirt: 'TSH', hoodie: 'HOD', sweatshirt: 'SWT', 'phone-case': 'PHN', 'wall-art': 'ART' }
const cleanTag = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 20)

export function buildEtsyPreview(input: { prompt: string; productType: string; variantId: string }) {
  const product = names[input.productType] ?? input.productType.replace('-', ' ')
  const title = `${input.prompt.trim()} | ${product} | Original Print on Demand Gift`.slice(0, 140)
  const tags = [...new Set([product, 'print on demand', 'original design', 'gift idea', ...input.prompt.split(/\s+/).filter((word) => word.length > 3)])].map(cleanTag).filter(Boolean).slice(0, 13)
  return { title, description: `${input.prompt.trim()}\n\nMade to order on a ${product.toLowerCase()}. Please review product details and sizing before ordering.`, tags, sku: `${prefixes[input.productType] ?? 'POD'}-${input.variantId.slice(0, 8).toUpperCase()}` }
}

export function validateEtsyListing(value: EtsyListingData) {
  const errors: string[] = []
  if (!value.title.trim()) errors.push('Title is required')
  if (!value.description.trim()) errors.push('Description is required')
  if (!(value.price > 0)) errors.push('Price must be greater than zero')
  if (!Number.isInteger(value.quantity) || value.quantity < 1) errors.push('Quantity must be at least one')
  if (!(value.taxonomyId > 0)) errors.push('Taxonomy is required')
  if (!(value.shippingProfileId > 0)) errors.push('Shipping profile is required')
  if (!(value.readinessStateId > 0)) errors.push('Readiness profile is required')
  if (!value.imageIds.length) errors.push('At least one ready mockup is required')
  return errors
}
