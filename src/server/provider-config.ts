export type ProviderCapability = 'design' | 'mockup'

export function hasGenerativeTemplates(templates: Array<{ kind: string }>) {
  return templates.some((template) => template.kind === 'generative')
}

export function mockupProviderConfigured(provider: string, geminiApiKey?: string) {
  return provider === 'gemini' && Boolean(geminiApiKey)
}

export function providerCapability(provider: string): ProviderCapability {
  return provider === 'gemini' ? 'mockup' : 'design'
}
