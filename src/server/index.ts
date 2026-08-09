import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { config } from './config'
import { db } from './db/client'
import { assets, jobs, marketplaceListings, mockups, mockupTemplates, productVariants, promptTemplates, runs, users, workflows, workspaces, workspaceConnections } from './db/schema'
import { authStatus, clearSession, createDevSession, currentUser, finishGoogleAuth, startGoogleAuth, workspaceForUser } from './auth'
import { dashboardCatalog } from './catalog'
import { defaultWorkflow } from '../core/workflow'
import { defaultModelForProvider } from './ai'
import { discoverOllamaImageModels, ollamaModelIsInstalled } from './ollama'
import type { ImageStyle } from '../core/prompting'
import { isConvexQuad, type Quad } from '../core/perspective'
import { workflowQueue } from './queue'
import { storage } from './storage'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { exportRunZip } from './zip'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = new Hono()
app.onError((error, c) => { if (error.message === 'Authentication required') return c.json({ error: 'Authentication required' }, 401); console.error('[api]', error); return c.json({ error: 'Internal server error' }, 500) })
app.use('/api/*', cors({ origin: config.WEB_URL, credentials: true }))
app.get('/uploads/*', async (c) => {
  const key = c.req.path.replace(/^\/uploads\//, '')
  try {
    const body = await storage.get(key)
    const contentType = key.endsWith('.svg') ? 'image/svg+xml' : key.endsWith('.png') ? 'image/png' : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : key.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' } })
  } catch { return c.notFound() }
})

app.get('/mockup-assets/:category/:file', async (c) => {
  const category = c.req.param('category')
  const file = c.req.param('file')
  if (!['tshirts', 'hoodies', 'posters', 'canvas', 'phone'].includes(category) || !/^[a-zA-Z0-9._-]+$/.test(file)) return c.notFound()
  try {
    const body = await readFile(join(resolve(fileURLToPath(new URL('../../download_mockups/', import.meta.url))), category, file))
    const contentType = file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/webp'
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' } })
  } catch { return c.notFound() }
})

app.get('/api/health', (c) => c.json({ ok: true, service: 'pod-automator-api', time: new Date().toISOString() }))
app.get('/api/auth/status', async (c) => { const status = authStatus(); const user = await (async () => { try { return await currentUser(c, false) } catch { return undefined } })(); return c.json({ ...status, authenticated: Boolean(user), user: user ? { id: user.id, name: user.name, email: user.email } : null }) })
app.get('/api/auth/google', (c) => startGoogleAuth(c))
app.get('/api/auth/google/callback', (c) => finishGoogleAuth(c))
app.post('/api/auth/dev-session', async (c) => { const user = await currentUser(c, true, true); createDevSession(c, user.id); return c.json({ user: { id: user.id, name: user.name, email: user.email } }) })
app.post('/api/auth/logout', (c) => { clearSession(c); return c.json({ ok: true }) })
app.get('/api/me', async (c) => { const user = await currentUser(c); return c.json({ user }) })

const providerSchema = z.enum(['fal', 'openrouter', 'huggingface', 'ollama', 'mock'])
const styleSchema = z.enum(['illustration', 'watercolor', 'editorial', 'vintage', 'flat-vector', '3d-render', 'photorealistic', 'anime'])
const sourceSchema = z.enum(['ai', 'upload'])
const createRunSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(2000), source: sourceSchema.default('ai'), style: styleSchema.default('illustration'), includeText: z.boolean().default(false), negativePrompt: z.string().max(2000).optional(), count: z.number().int().min(1).max(100), products: z.array(z.string()).min(1), destinations: z.array(z.string()).default(['download']), provider: providerSchema.optional(), model: z.string().max(160).optional(), assetIds: z.array(z.string().uuid()).default([]), templates: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['deterministic', 'generative']), productType: z.string(), quantity: z.number().int().min(1).max(20), config: z.record(z.unknown()).optional() })).default([]) })
const mockupTemplateSchema = z.object({ name: z.string().min(1).max(160), type: z.enum(['deterministic', 'generative']), productType: z.string().min(1).max(40), quantity: z.number().int().min(1).max(20), config: z.record(z.unknown()) })
const promptTemplateSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(4000), provider: z.enum(['fal', 'openrouter', 'huggingface', 'ollama', 'mock']), model: z.string().max(160).optional(), description: z.string().max(255).optional() })
const providerModels: Record<string, string[]> = { fal: [config.FAL_IMAGE_MODEL], openrouter: [config.OPENROUTER_IMAGE_MODEL], huggingface: [config.HUGGINGFACE_IMAGE_MODEL, 'black-forest-labs/FLUX.2-klein-9B'], mock: ['local-mock'] }
const connectionSchema = z.object({ defaultModel: z.string().min(1).max(160), enabled: z.boolean() })
function validTemplateQuad(config: Record<string, unknown> | undefined) {
  const candidate = (config ?? {}).targetQuad as { topLeft?: unknown; topRight?: unknown; bottomRight?: unknown; bottomLeft?: unknown; coordinateSpace?: unknown } | undefined
  if (!candidate) return true
  const points = [candidate.topLeft, candidate.topRight, candidate.bottomRight, candidate.bottomLeft]
  return candidate.coordinateSpace === 'normalized' && points.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) && isConvexQuad(points as Quad)
}
async function modelsForProvider(provider: string) {
  if (provider === 'ollama') return (await discoverOllamaImageModels()).models.map((model) => model.name)
  return providerModels[provider] ?? []
}
async function validProviderModel(provider: string, model: string) {
  const models = await modelsForProvider(provider)
  return provider === 'ollama' ? ollamaModelIsInstalled(models.map((name) => ({ name })), model) : models.includes(model)
}
async function providerConfigured(provider: string) {
  if (provider === 'mock') return true
  if (provider === 'ollama') {
    const status = await discoverOllamaImageModels()
    return status.reachable && status.models.length > 0
  }
  return provider === 'fal' ? Boolean(config.FAL_API_KEY) : provider === 'openrouter' ? Boolean(config.OPENROUTER_API_KEY) : provider === 'huggingface' ? Boolean(config.HUGGINGFACE_TOKEN) : false
}

app.get('/api/dashboard/catalog', async (c) => { const user = await currentUser(c); return c.json(await dashboardCatalog(user.id)) })
app.get('/api/workflows', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ workflows: [], userId: user.id }); const rows = await db.select().from(workflows).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(workflows.createdAt)); return c.json({ workflows: rows, userId: user.id }) })
app.post('/api/prompt-templates', async (c) => { const parsed = promptTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); if (parsed.data.model && !(await validProviderModel(parsed.data.provider, parsed.data.model))) return c.json({ error: `Unsupported model for ${parsed.data.provider}` }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const [template] = await db.insert(promptTemplates).values({ workspaceId: workspace.id, ...parsed.data, model: parsed.data.model || null, description: parsed.data.description || null }).returning(); return c.json({ template }, 201) })
app.put('/api/prompt-templates/:id', async (c) => { const parsed = promptTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); if (parsed.data.model && !(await validProviderModel(parsed.data.provider, parsed.data.model))) return c.json({ error: `Unsupported model for ${parsed.data.provider}` }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [template] = workspace ? await db.update(promptTemplates).set({ ...parsed.data, model: parsed.data.model || null, description: parsed.data.description || null, updatedAt: new Date() }).where(and(eq(promptTemplates.id, c.req.param('id')), eq(promptTemplates.workspaceId, workspace.id))).returning() : []; if (!template) return c.json({ error: 'Prompt template not found' }, 404); return c.json({ template }) })
app.delete('/api/prompt-templates/:id', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const deleted = await db.delete(promptTemplates).where(and(eq(promptTemplates.id, c.req.param('id')), eq(promptTemplates.workspaceId, workspace.id))).returning({ id: promptTemplates.id }); if (!deleted.length) return c.json({ error: 'Prompt template not found' }, 404); return c.json({ ok: true }) })
app.put('/api/mockup-templates/:id', async (c) => { const parsed = mockupTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);  const configValue = parsed.data.config as { assetPath?: unknown; targetQuad?: unknown; quality?: unknown };
  if (parsed.data.type === 'deterministic' && typeof configValue.assetPath !== 'string') return c.json({ error: 'Deterministic templates require an assetPath' }, 400);
  if (parsed.data.type === 'deterministic' && configValue.targetQuad) {
    const candidate = configValue.targetQuad as { topLeft?: unknown; topRight?: unknown; bottomRight?: unknown; bottomLeft?: unknown; coordinateSpace?: unknown }
    const points = [candidate.topLeft, candidate.topRight, candidate.bottomRight, candidate.bottomLeft]
    if (candidate.coordinateSpace !== 'normalized' || points.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) || !isConvexQuad(points as Quad)) return c.json({ error: 'The printable area must be four points forming a convex normalized quadrilateral.' }, 400)
  } const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [template] = workspace ? await db.update(mockupTemplates).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(mockupTemplates.id, c.req.param('id')), eq(mockupTemplates.workspaceId, workspace.id))).returning() : []; if (!template) return c.json({ error: 'Mockup template not found' }, 404); return c.json({ template }) })
app.put('/api/connections/:provider', async (c) => { const parsed = connectionSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const provider = providerSchema.parse(c.req.param('provider')); if (!(await validProviderModel(provider, parsed.data.defaultModel))) return c.json({ error: `Unsupported model for ${provider}` }, 400); const existing = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, provider))).limit(1); const [connection] = existing.length ? await db.update(workspaceConnections).set({ defaultModel: parsed.data.defaultModel, enabled: String(parsed.data.enabled), updatedAt: new Date() }).where(eq(workspaceConnections.id, existing[0].id)).returning() : await db.insert(workspaceConnections).values({ workspaceId: workspace.id, provider, defaultModel: parsed.data.defaultModel, enabled: String(parsed.data.enabled) }).returning(); return c.json({ connection }) })
app.post('/api/connections/test', async (c) => {
  const input = await c.req.json().catch(() => ({}))
  const provider = providerSchema.parse(input.provider)
  const model = z.string().default(defaultModelForProvider(provider)).parse(input.model)
  await currentUser(c)
  if (provider === 'mock') return c.json({ ok: true, provider, model, message: 'Local mock provider is ready.' })
  if (provider === 'ollama') {
    const status = await discoverOllamaImageModels()
    if (!status.reachable) return c.json({ ok: false, provider, model, models: [], message: `Ollama is not reachable at ${status.baseUrl}. Start Ollama or update OLLAMA_BASE_URL.` })
    if (!status.models.length) return c.json({ ok: false, provider, model, models: [], message: 'Ollama is reachable, but no installed image models were found. Pull an x/ model such as x/flux2-klein.' })
    const installed = ollamaModelIsInstalled(status.models, model)
    return c.json({ ok: installed, provider, model, models: status.models.map((item) => item.name), message: installed ? `Ollama is reachable and ${model} is installed.` : `Ollama is reachable, but ${model} is not installed. Pull it with "ollama pull ${model}".` })
  }
  if (provider === 'huggingface') {
    if (!config.HUGGINGFACE_TOKEN) return c.json({ ok: false, provider, model, message: 'Hugging Face is not configured. Add HUGGINGFACE_TOKEN to .env.' }, 400)
    const response = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${config.HUGGINGFACE_TOKEN}` } })
    if (!response.ok) return c.json({ ok: false, provider, model, message: `Hugging Face rejected the connection test (${response.status}).` }, 400)
    return c.json({ ok: true, provider, model, message: 'Hugging Face token is valid.' })
  }
  const endpoint = provider === 'fal' ? 'https://api.fal.ai/v1/models?limit=1' : 'https://openrouter.ai/api/v1/key'
  const configured = provider === 'fal' ? config.FAL_API_KEY : config.OPENROUTER_API_KEY
  const headers = provider === 'fal' ? { Authorization: `Key ${config.FAL_API_KEY ?? ''}` } : { Authorization: `Bearer ${config.OPENROUTER_API_KEY ?? ''}` }
  if (!configured) return c.json({ ok: false, provider, model, message: `${provider} is not configured. Add its API key to .env.` }, 400)
  const response = await fetch(endpoint, { headers })
  if (!response.ok) return c.json({ ok: false, provider, model, message: `${provider} rejected the connection test (${response.status}).` }, 400)
  return c.json({ ok: true, provider, model, message: `${provider} connection is valid.` })
})
app.post('/api/workflows/runs', async (c) => {
  const parsed = createRunSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const user = await currentUser(c)
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id)).limit(1)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 500)
  if (parsed.data.provider) {
    const [connection] = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, parsed.data.provider))).limit(1)
    if (connection?.enabled === 'false') return c.json({ error: `${parsed.data.provider} is disabled in connection settings` }, 400)
    if (!(await providerConfigured(parsed.data.provider))) {
      const message = parsed.data.provider === 'ollama'
        ? `Ollama is not reachable at ${config.OLLAMA_BASE_URL} or has no installed x/ image models. Start Ollama and pull x/flux2-klein.`
        : `${parsed.data.provider} is not configured. Add its credentials or start its local service first.`
      return c.json({ error: message }, 400)
    }
    if (parsed.data.model && !(await validProviderModel(parsed.data.provider, parsed.data.model))) return c.json({ error: `Unsupported model for ${parsed.data.provider}. Refresh the provider models and choose an installed model.` }, 400)
  }
  const [workspaceWorkflow] = await db.select().from(workflows).where(and(eq(workflows.workspaceId, workspace.id), eq(workflows.name, parsed.data.name))).limit(1)
  const invalidTemplate = parsed.data.templates.find((template) => template.kind === 'deterministic' && !validTemplateQuad(template.config))
  if (invalidTemplate) return c.json({ error: `Template "${invalidTemplate.name}" has an invalid printable-area quad. Reopen it in Templates and calibrate it again.` }, 400)
  if (parsed.data.assetIds.length) {
    const ownedAssets = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.workspaceId, workspace.id), inArray(assets.id, parsed.data.assetIds)))
    if (ownedAssets.length !== parsed.data.assetIds.length) return c.json({ error: 'One or more selected assets do not belong to this workspace' }, 400)
  }
  const workflow = workspaceWorkflow ?? (await db.insert(workflows).values({ workspaceId: workspace.id, name: parsed.data.name, definitionGraph: defaultWorkflow }).returning())[0]
  const [run] = await db.insert(runs).values({ workflowId: workflow.id, status: 'queued', config: parsed.data }).returning()
  await db.insert(jobs).values({ runId: run.id, stepName: 'workflow:start', status: 'queued' })
  await workflowQueue.add('run', { runId: run.id, workspaceId: workspace.id, ...parsed.data }, { jobId: run.id, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 })
  return c.json({ run }, 202)
})
app.get('/api/runs', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ runs: [] }); const rows = await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(runs.createdAt)).limit(25); return c.json({ runs: rows.map((row) => row.run) }) })
app.get('/api/runs/:id', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [run] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!run) return c.json({ error: 'Run not found' }, 404); const runRecord = run.run; const runAssets = await db.select().from(assets).where(eq(assets.runId, runRecord.id)); const runJobs = await db.select().from(jobs).where(eq(jobs.runId, runRecord.id)); const variants = await db.select().from(productVariants).where(eq(productVariants.runId, runRecord.id)); const runListings = []; for (const variant of variants) runListings.push(...await db.select().from(marketplaceListings).where(eq(marketplaceListings.productVariantId, variant.id))); const runMockups = []; for (const variant of variants) runMockups.push(...await db.select().from(mockups).where(eq(mockups.productVariantId, variant.id))); return c.json({ run: runRecord, assets: await Promise.all(runAssets.map(async (asset) => ({ ...asset, url: await storage.getPublicUrl(asset.storagePath) }))), mockups: await Promise.all(runMockups.filter((mockup) => Boolean(mockup.storagePath)).map(async (mockup) => ({ ...mockup, url: await storage.getPublicUrl(mockup.storagePath!) }))), jobs: runJobs, listings: runListings }) })
app.get('/api/runs/:id/listings', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [ownedRun] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!ownedRun) return c.json({ error: 'Run not found' }, 404); const runVariants = await db.select().from(productVariants).where(eq(productVariants.runId, c.req.param('id'))); const listings = []; for (const variant of runVariants) listings.push(...await db.select().from(marketplaceListings).where(eq(marketplaceListings.productVariantId, variant.id))); return c.json({ listings }) })
app.get('/api/runs/:id/export.zip', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [ownedRun] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!ownedRun) return c.json({ error: 'Run not found' }, 404); const archive = await exportRunZip(c.req.param('id')); return new Response(new Uint8Array(archive), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="pod-run-${c.req.param('id')}.zip"` } }) })
app.post('/api/assets/upload', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const body = await c.req.parseBody(); const file = body.file; if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const key = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const bytes = Buffer.from(await file.arrayBuffer()); if (config.STORAGE_DRIVER === 'local') { const target = join(config.STORAGE_DIR, key); await mkdir(join(config.STORAGE_DIR, 'uploads'), { recursive: true }); await writeFile(target, bytes) } else await storage.put(key, bytes, file.type); const [asset] = await db.insert(assets).values({ workspaceId: workspace.id, type: 'uploaded-design', name: file.name, storagePath: key, contentType: file.type || 'application/octet-stream', metadata: { source: 'upload' } }).returning(); return c.json({ id: asset.id, name: asset.name, path: key, url: await storage.getPublicUrl(key) }, 201) })

export default app
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => console.log(`POD Automator API listening on ${config.APP_URL}`))
