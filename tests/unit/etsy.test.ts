import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, pkceChallenge } from '../../src/server/marketplaces/crypto'
import { EtsyAdapter, EtsyApiError } from '../../src/server/marketplaces/etsy-adapter'
import { buildEtsyPreview, validateEtsyListing } from '../../src/server/marketplaces/etsy-listing'

describe('Etsy OAuth crypto', () => {
  it('creates the RFC 7636 S256 challenge', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('encrypts secrets with associated workspace data and fails closed on tampering', () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    const encrypted = encryptSecret('access-token', key, 'workspace-1:etsy')
    expect(encrypted).not.toContain('access-token')
    expect(decryptSecret(encrypted, key, 'workspace-1:etsy')).toBe('access-token')
    expect(() => decryptSecret(encrypted.slice(0, -2) + 'aa', key, 'workspace-1:etsy')).toThrow()
    expect(() => decryptSecret(encrypted, key, 'workspace-2:etsy')).toThrow()
  })
})

describe('Etsy listing preparation', () => {
  it('builds deterministic product-aware copy within Etsy limits', () => {
    const preview = buildEtsyPreview({ prompt: 'A sleepy orange cat reading a mystery novel under moonlight', productType: 'tshirt', variantId: '12345678-abcd' })
    expect(preview.title.length).toBeLessThanOrEqual(140)
    expect(preview.title).toContain('T-Shirt')
    expect(preview.tags.length).toBeLessThanOrEqual(13)
    expect(preview.tags.every((tag) => tag.length <= 20)).toBe(true)
    expect(preview.sku).toBe('TSH-12345678')
  })

  it('returns actionable errors for incomplete Etsy data', () => {
    expect(validateEtsyListing({ title: '', description: '', tags: [], price: 0, quantity: 0, taxonomyId: 0, shippingProfileId: 0, readinessStateId: 0, whoMade: 'someone_else', whenMade: 'made_to_order', isSupply: false, sku: '', imageIds: [] })).toEqual([
      'Title is required', 'Description is required', 'Price must be greater than zero', 'Quantity must be at least one', 'Taxonomy is required', 'Shipping profile is required', 'Readiness profile is required', 'At least one ready mockup is required',
    ])
  })
})

describe('Etsy adapter', () => {
  it('creates a physical draft with Etsy headers and exact form fields', async () => {
    let request: Request | undefined
    const adapter = new EtsyAdapter({ keystring: 'key', sharedSecret: 'secret', fetch: async (input, init) => { request = new Request(input, init); return Response.json({ listing_id: 42, url: 'https://etsy.com/listing/42' }) } })
    const result = await adapter.createDraftListing({ accessToken: 'token', shopId: '99' }, { title: 'Cat shirt', description: 'Soft shirt', tags: ['cat gift'], price: 24.5, quantity: 3, taxonomyId: 123, shippingProfileId: 456, readinessStateId: 789, whoMade: 'someone_else', whenMade: 'made_to_order', isSupply: false, sku: 'CAT-1', images: [] })
    expect(request?.headers.get('x-api-key')).toBe('key:secret')
    expect(request?.headers.get('authorization')).toBe('Bearer token')
    expect(await request?.text()).toBe('quantity=3&title=Cat+shirt&description=Soft+shirt&price=24.50&who_made=someone_else&when_made=made_to_order&taxonomy_id=123&shipping_profile_id=456&readiness_state_id=789&is_supply=false&should_auto_renew=false&tags=cat+gift&sku=CAT-1')
    expect(result.externalListingId).toBe('42')
  })

  it('classifies validation failures as non-retryable', async () => {
    const adapter = new EtsyAdapter({ keystring: 'key', sharedSecret: 'secret', fetch: async () => Response.json({ error: 'bad taxonomy' }, { status: 400 }) })
    await expect(adapter.publishListing({ accessToken: 'token', shopId: '99' }, '42')).rejects.toMatchObject<EtsyApiError>({ status: 400, retryable: false })
  })
})
