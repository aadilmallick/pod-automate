export interface RunInput {
  name: string
  prompt: string
  count: number
  products: string[]
  destinations: string[]
  provider?: string
  templates?: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: string; quantity: number }>
}

export interface ApiRun {
  id: string
  status: string
  progressPercent: number
  config: RunInput
  createdAt: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) } })
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export interface SessionUser { id: string; name: string; email: string }
import type { ProductType } from '../core/interfaces/providers'

export interface DashboardCatalog {
  stats: { workflows: number; assets: number; readyListings: number }
  runs: Array<{ id: string; name: string; detail: string; status: string; progress: number; date: string; jobs: Array<{ id: string; stepName: string; status: string }> }>
  assets: Array<{ id: string; name: string; type: string; contentType: string; url: string; background: string; accent: string; icon: string; createdAt: string }>
  templates: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: ProductType; quantity: number; background: string; accent: string; icon: string }>
  listings: Array<{ id: string; title: string; type: string; status: string; tags: string[]; background: string; accent: string; icon: string }>
}
export function getAuthStatus() { return request<{ mode: 'development' | 'google'; googleConfigured: boolean; authenticated: boolean; user: SessionUser | null }>('/api/auth/status') }
export function createDevSession() { return request<{ user: SessionUser }>('/api/auth/dev-session', { method: 'POST' }) }
export function logout() { return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }) }
export function getDashboardCatalog() { return request<DashboardCatalog>('/api/dashboard/catalog') }
export function createRun(input: RunInput) { return request<{ run: ApiRun }>('/api/workflows/runs', { method: 'POST', body: JSON.stringify(input) }) }
export function getRun(id: string) { return request<{ run: ApiRun; assets: Array<{ id: string; name: string; url: string }> }>(`/api/runs/${id}`) }
export function getRunListings(id: string) { return request<{ listings: Array<Record<string, unknown>> }>(`/api/runs/${id}/listings`) }
