import { describe, expect, it } from 'vitest'
import { hasGenerativeTemplates, mockupProviderConfigured, providerCapability } from '../../src/server/provider-config'

describe('mockup provider configuration', () => {
  it('requires credentials only for generative templates', () => {
    expect(hasGenerativeTemplates([{ kind: 'deterministic' }])).toBe(false)
    expect(hasGenerativeTemplates([{ kind: 'generative' }])).toBe(true)
    expect(mockupProviderConfigured('gemini', '')).toBe(false)
    expect(mockupProviderConfigured('gemini', 'key')).toBe(true)
  })

  it('classifies Gemini as mockup-only', () => {
    expect(providerCapability('gemini')).toBe('mockup')
    expect(providerCapability('fal')).toBe('design')
  })
})
