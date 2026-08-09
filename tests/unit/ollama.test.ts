import { describe, expect, it } from 'vitest'
import { chooseInstalledOllamaModel, ollamaModelIsInstalled } from '../../src/server/ollama'

describe('Ollama image model discovery', () => {
  const models = [
    { name: 'x/flux2-klein:latest' },
    { name: 'x/z-image-turbo:latest' },
  ]

  it('matches a requested base model to an installed latest tag', () => {
    expect(ollamaModelIsInstalled(models, 'x/flux2-klein')).toBe(true)
    expect(ollamaModelIsInstalled(models, 'x/flux2-klein:9b')).toBe(false)
  })

  it('prefers the configured model, then its tag variant, then the first image model', () => {
    expect(chooseInstalledOllamaModel(models, 'x/flux2-klein')).toBe('x/flux2-klein:latest')
    expect(chooseInstalledOllamaModel(models, 'x/flux2-klein:9b')).toBe('x/flux2-klein:latest')
    expect(chooseInstalledOllamaModel(models, 'x/unknown')).toBe('x/flux2-klein:latest')
  })

  it('falls back to the configured model when Ollama has no installed image models', () => {
    expect(chooseInstalledOllamaModel([], 'x/flux2-klein')).toBe('x/flux2-klein')
  })
})
