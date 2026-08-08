import { describe, expect, it } from 'vitest'
import { estimateMockups, estimateProducts } from '../../src/core/workflow'

describe('production fan-out', () => {
  const config = {
    designs: 4,
    products: ['tshirt', 'hoodie'] as const,
    templates: [
      { id: 'studio', name: 'Studio', kind: 'deterministic' as const, productType: 'tshirt' as const, quantity: 1 },
      { id: 'street', name: 'Street', kind: 'generative' as const, productType: 'tshirt' as const, quantity: 2 },
      { id: 'hoodie', name: 'Hoodie', kind: 'deterministic' as const, productType: 'hoodie' as const, quantity: 1 },
    ],
    destinations: ['download'],
  }

  it('fans one design into each selected product variant', () => {
    expect(estimateProducts(config)).toBe(8)
  })

  it('counts template quantities per product and design', () => {
    expect(estimateMockups(config)).toBe(16)
  })
})
