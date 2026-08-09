import type { MarketplaceAdapter, MarketplaceContext, MarketplaceListingPayload } from '../../core/interfaces/providers'

export class EtsyApiError extends Error {
  constructor(message: string, public status: number, public retryable: boolean, public retryAfter?: number) { super(message) }
}

export class EtsyAdapter implements MarketplaceAdapter {
  readonly id = 'etsy'
  private readonly fetcher: typeof fetch
  constructor(private options: { keystring: string; sharedSecret: string; fetch?: typeof fetch; baseUrl?: string }) { this.fetcher = options.fetch ?? fetch }
  getRequirements() { return { maxTitleLength: 140, maxTags: 13, maxImages: 10 } }

  private async request(context: MarketplaceContext, path: string, init: RequestInit) {
    const response = await this.fetcher(`${this.options.baseUrl ?? 'https://openapi.etsy.com/v3'}${path}`, { ...init, headers: { 'x-api-key': `${this.options.keystring}:${this.options.sharedSecret}`, Authorization: `Bearer ${context.accessToken}`, ...init.headers } })
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) { const retryAfter = Number(response.headers.get('retry-after')) || undefined; throw new EtsyApiError(String(body.error ?? body.message ?? `Etsy request failed (${response.status})`).slice(0, 1000), response.status, response.status === 429 || response.status >= 500, retryAfter) }
    return body
  }

  private form(payload: MarketplaceListingPayload) { return new URLSearchParams({ quantity: String(payload.quantity), title: payload.title, description: payload.description, price: payload.price.toFixed(2), who_made: payload.whoMade, when_made: payload.whenMade, taxonomy_id: String(payload.taxonomyId), shipping_profile_id: String(payload.shippingProfileId), readiness_state_id: String(payload.readinessStateId), is_supply: String(payload.isSupply), should_auto_renew: 'false', tags: payload.tags.join(','), sku: payload.sku }) }
  private result(body: Record<string, unknown>, id?: string) { const externalListingId = String(body.listing_id ?? id ?? ''); if (!externalListingId) throw new EtsyApiError('Etsy returned a malformed listing response', 502, true); return { externalListingId, draftUrl: String(body.url ?? `https://www.etsy.com/listing/${externalListingId}`), raw: body } }
  async createDraftListing(context: MarketplaceContext, payload: MarketplaceListingPayload) { const body = await this.request(context, `/application/shops/${context.shopId}/listings`, { method: 'POST', body: this.form(payload) }); return this.result(body) }
  async updateDraftListing(context: MarketplaceContext, externalId: string, payload: MarketplaceListingPayload) { const body = await this.request(context, `/application/shops/${context.shopId}/listings/${externalId}`, { method: 'PATCH', body: this.form(payload) }); return this.result(body, externalId) }
  async publishListing(context: MarketplaceContext, externalId: string) { const body = await this.request(context, `/application/shops/${context.shopId}/listings/${externalId}`, { method: 'PATCH', body: new URLSearchParams({ state: 'active' }) }); return { success: true, url: String(body.url ?? `https://www.etsy.com/listing/${externalId}`), raw: body } }
  async uploadListingImage(context: MarketplaceContext, externalId: string, image: { buffer: Buffer; contentType: string; filename: string }, rank: number) { const form = new FormData(); form.set('rank', String(rank)); form.set('image', new Blob([new Uint8Array(image.buffer)], { type: image.contentType }), image.filename); return this.request(context, `/application/shops/${context.shopId}/listings/${externalId}/images`, { method: 'POST', body: form }) }
  async deleteListingImage(context: MarketplaceContext, externalId: string, imageId: string) { return this.request(context, `/application/shops/${context.shopId}/listings/${externalId}/images/${imageId}`, { method: 'DELETE' }) }
  async getShippingProfiles(context: MarketplaceContext) { return this.request(context, `/application/shops/${context.shopId}/shipping-profiles`, { method: 'GET' }) }
  async getReadinessProfiles(context: MarketplaceContext) { return this.request(context, `/application/shops/${context.shopId}/readiness-state-definitions`, { method: 'GET' }) }
  async getTaxonomy(context: MarketplaceContext) { return this.request(context, '/application/seller-taxonomy/nodes', { method: 'GET' }) }
}
