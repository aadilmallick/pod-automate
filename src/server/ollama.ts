import { Ollama, type ModelResponse } from 'ollama'
import { config } from './config'

export interface OllamaModelInfo {
  name: string
  parameterSize?: string
  family?: string
  size?: number
}

export interface OllamaModelDiscovery {
  reachable: boolean
  baseUrl: string
  models: OllamaModelInfo[]
  error?: string
}

function client() {
  return new Ollama({ host: config.OLLAMA_BASE_URL.replace(/\/$/, '') })
}

function imageModel(model: ModelResponse) {
  return model.name.startsWith(config.OLLAMA_IMAGE_MODEL_PREFIX)
}

export async function discoverOllamaImageModels(): Promise<OllamaModelDiscovery> {
  try {
    const response = await client().list()
    const models = response.models
      .filter(imageModel)
      .map((model) => ({
        name: model.name,
        parameterSize: model.details?.parameter_size,
        family: model.details?.family,
        size: model.size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { reachable: true, baseUrl: config.OLLAMA_BASE_URL, models }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Ollama error'
    return { reachable: false, baseUrl: config.OLLAMA_BASE_URL, models: [], error: message.slice(0, 300) }
  }
}

export function chooseInstalledOllamaModel(models: OllamaModelInfo[], preferred = config.OLLAMA_IMAGE_MODEL) {
  if (!models.length) return preferred
  const preferredIsTagged = preferred.includes(':')
  const preferredBase = preferred.split(':')[0]
  return models.find((model) => model.name === preferred)?.name
    ?? (!preferredIsTagged ? models.find((model) => model.name === `${preferredBase}:latest`)?.name : undefined)
    ?? models[0].name
}

export function ollamaModelIsInstalled(models: OllamaModelInfo[], model: string) {
  if (model.includes(':')) return models.some((installed) => installed.name === model)
  const requestedBase = model.split(':')[0]
  return models.some((installed) => installed.name === requestedBase || installed.name === `${requestedBase}:latest`)
}

export function ollamaClient() {
  return client()
}
