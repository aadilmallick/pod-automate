export interface RunInput {
  name: string
  prompt: string
  source?: 'ai' | 'upload'
  style?: import('../core/prompting').ImageStyle
  includeText?: boolean
  negativePrompt?: string
  count: number
  products: string[]
  destinations: string[]
  provider?: string
  model?: string
  assetIds?: string[]
  templates?: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: string; quantity: number; config?: Record<string, unknown> }>
  prepareArtwork?: { removeBackground: boolean; resize: boolean; maxDimension?: number }
}

export interface ApiRun {
  id: string
  status: string
  progressPercent: number
  config: RunInput
  createdAt: string
  errorLog?: string | null
}

export interface EtsyListingMetadata { title: string; description: string; tags: string[]; price: number; quantity: number; taxonomyId: number; shippingProfileId: number; readinessStateId: number; sku: string; whoMade: 'i_did' | 'collective' | 'someone_else'; whenMade: string; isSupply: boolean; imageIds: string[] }
export interface ApiListing { id: string; marketplace: string; externalId?: string | null; externalUrl?: string | null; status: string; metadata: EtsyListingMetadata | Record<string, unknown>; lastError?: string | null; failedStage?: string | null; syncedAt?: string | null; publishedAt?: string | null }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)
  if (!(options?.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, credentials: 'include', headers })
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export interface SessionUser { id: string; name: string; email: string }
import type { ProductType } from '../core/interfaces/providers'

export interface DashboardCatalog {
  stats: { workflows: number; assets: number; readyListings: number }
  connections: Array<{ id: string; name: string; capability?: 'design' | 'mockup' | 'transform'; configured: boolean; enabled: boolean; detail: string; defaultModel: string; models: string[] }>
  promptTemplates: Array<{ id: string; workspaceId: string; name: string; prompt: string; provider: string; model?: string | null; description?: string | null; createdAt: string; updatedAt: string }>
  runs: Array<{ id: string; name: string; detail: string; status: string; progress: number; date: string; accent: string; jobs: Array<{ id: string; stepName: string; status: string; errorLog?: string | null }> }>
  assets: Array<{ id: string; name: string; type: string; contentType: string; url: string; background: string; accent: string; icon: string; createdAt: string }>
  templates: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: ProductType; quantity: number; config?: Record<string, unknown>; previewUrl?: string; quality?: 'legacy-flat' | 'draft' | 'verified' | 'generative-only'; background: string; accent: string; icon: string }>
  listings: Array<{ id: string; title: string; type: string; status: string; tags: string[]; background: string; accent: string; icon: string }>
}
export function getAuthStatus() { return request<{ mode: 'development' | 'google'; googleConfigured: boolean; authenticated: boolean; user: SessionUser | null }>('/api/auth/status') }
export function createDevSession() { return request<{ user: SessionUser }>('/api/auth/dev-session', { method: 'POST' }) }
export function logout() { return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }) }
export function getDashboardCatalog() { return request<DashboardCatalog>('/api/dashboard/catalog') }
export function uploadAsset(file: File) { const body = new FormData(); body.append('file', file); return request<{ id: string; name: string; path: string; url: string }>('/api/assets/upload', { method: 'POST', body, headers: {} }) }
export function createRun(input: RunInput) { return request<{ run: ApiRun }>('/api/workflows/runs', { method: 'POST', body: JSON.stringify(input) }) }
export function getRun(id: string) { return request<{ run: ApiRun; assets: Array<{ id: string; name: string; url: string; type: string; contentType: string }>; mockups: Array<{ id: string; url: string; storagePath: string; status: string }>; jobs: Array<{ id: string; stepName: string; status: string; errorLog?: string | null }>; listings: ApiListing[] }>(`/api/runs/${id}`) }
export function getRunListings(id: string) { return request<{ listings: Array<Record<string, unknown>> }>(`/api/runs/${id}/listings`) }
export function createPromptTemplate(input: { name: string; prompt: string; provider: string; model?: string; description?: string }) { return request<{ template: DashboardCatalog['promptTemplates'][number] }>('/api/prompt-templates', { method: 'POST', body: JSON.stringify(input) }) }
export function updatePromptTemplate(id: string, input: { name: string; prompt: string; provider: string; model?: string; description?: string }) { return request<{ template: DashboardCatalog['promptTemplates'][number] }>(`/api/prompt-templates/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
export function deletePromptTemplate(id: string) { return request<{ ok: boolean }>(`/api/prompt-templates/${id}`, { method: 'DELETE' }) }
export function updateConnection(id: string, input: { defaultModel: string; enabled: boolean }) { return request<{ connection: { id: string; provider: string; defaultModel: string; enabled: string } }>(`/api/connections/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
export function testConnection(provider: string, model: string) { return request<{ ok: boolean; provider: string; model: string; message: string; models?: string[] }>('/api/connections/test', { method: 'POST', body: JSON.stringify({ provider, model }) }) }
export function updateMockupTemplate(id: string, input: { name: string; type: 'deterministic' | 'generative'; productType: ProductType; quantity: number; config: Record<string, unknown> }) { return request<{ template: DashboardCatalog['templates'][number] }>(`/api/mockup-templates/${id}`, { method: 'PUT', body: JSON.stringify(input) }) }
export function getEtsyConnection() { return request<{ configured: boolean; connection: null | { state: string; shopId?: string | null; shopName?: string | null; scopes: string[]; expiresAt?: string | null; settings: Record<string, unknown>; lastError?: string | null } }>('/api/marketplaces/etsy/connection') }
export function disconnectEtsy() { return request<{ ok: boolean }>('/api/marketplaces/etsy/connection', { method: 'DELETE' }) }
export function getEtsyOptions() { return request<{ shippingProfiles: { results?: Array<Record<string, unknown>> }; readinessProfiles: { results?: Array<Record<string, unknown>> }; taxonomy: { results?: Array<Record<string, unknown>> } }>('/api/marketplaces/etsy/options') }
export function updateEtsySettings(productDefaults: Record<string, { price: number; quantity: number; taxonomyId: number; shippingProfileId: number; readinessStateId: number; skuPrefix: string; whoMade: 'i_did' | 'collective' | 'someone_else'; whenMade: string; isSupply: boolean }>) { return request<{ settings: Record<string, unknown> }>('/api/marketplaces/etsy/settings', { method: 'PUT', body: JSON.stringify({ productDefaults }) }) }
export function updateListing(id: string, metadata: EtsyListingMetadata) { return request<{ listing: ApiListing }>(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify(metadata) }) }
export function syncEtsyDraft(id: string) { return request<{ listing: ApiListing }>(`/api/listings/${id}/etsy-draft`, { method: 'POST' }) }
export function publishEtsyListing(id: string) { return request<{ listing: ApiListing }>(`/api/listings/${id}/publish`, { method: 'POST', body: JSON.stringify({ confirm: true }) }) }
