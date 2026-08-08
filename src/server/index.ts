import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { config } from './config'
import { db } from './db/client'
import { assets, jobs, marketplaceListings, mockups, productVariants, promptTemplates, runs, users, workflows, workspaces, workspaceConnections } from './db/schema'
import { authStatus, clearSession, createDevSession, currentUser, finishGoogleAuth, startGoogleAuth, workspaceForUser } from './auth'
import { dashboardCatalog } from './catalog'
import { defaultWorkflow } from '../core/workflow'
import { workflowQueue } from './queue'
import { storage } from './storage'
import { mkdir, writeFile } from 'node:fs/promises'
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
    const contentType = key.endsWith('.svg') ? 'image/svg+xml' : key.endsWith('.png') ? 'image/png' : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream'
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

const createRunSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(2000), count: z.number().int().min(1).max(100), products: z.array(z.string()).min(1), destinations: z.array(z.string()).default(['download']), provider: z.string().optional(), model: z.string().max(160).optional(), assetIds: z.array(z.string().uuid()).default([]), templates: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['deterministic', 'generative']), productType: z.string(), quantity: z.number().int().min(1).max(20) })).default([]) })
const promptTemplateSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(4000), provider: z.enum(['fal', 'openrouter', 'mock']), model: z.string().max(160).optional(), description: z.string().max(255).optional() })
const connectionSchema = z.object({ defaultModel: z.string().min(1).max(160), enabled: z.boolean() })

app.get('/api/dashboard/catalog', async (c) => { const user = await currentUser(c); return c.json(await dashboardCatalog(user.id)) })
app.get('/api/workflows', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ workflows: [], userId: user.id }); const rows = await db.select().from(workflows).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(workflows.createdAt)); return c.json({ workflows: rows, userId: user.id }) })
app.post('/api/prompt-templates', async (c) => { const parsed = promptTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const [template] = await db.insert(promptTemplates).values({ workspaceId: workspace.id, ...parsed.data, model: parsed.data.model || null, description: parsed.data.description || null }).returning(); return c.json({ template }, 201) })
app.put('/api/prompt-templates/:id', async (c) => { const parsed = promptTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [template] = workspace ? await db.update(promptTemplates).set({ ...parsed.data, model: parsed.data.model || null, description: parsed.data.description || null, updatedAt: new Date() }).where(and(eq(promptTemplates.id, c.req.param('id')), eq(promptTemplates.workspaceId, workspace.id))).returning() : []; if (!template) return c.json({ error: 'Prompt template not found' }, 404); return c.json({ template }) })
app.delete('/api/prompt-templates/:id', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const deleted = await db.delete(promptTemplates).where(and(eq(promptTemplates.id, c.req.param('id')), eq(promptTemplates.workspaceId, workspace.id))).returning({ id: promptTemplates.id }); if (!deleted.length) return c.json({ error: 'Prompt template not found' }, 404); return c.json({ ok: true }) })
app.put('/api/connections/:provider', async (c) => { const parsed = connectionSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const provider = c.req.param('provider'); const existing = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, provider))).limit(1); const [connection] = existing.length ? await db.update(workspaceConnections).set({ defaultModel: parsed.data.defaultModel, enabled: String(parsed.data.enabled), updatedAt: new Date() }).where(eq(workspaceConnections.id, existing[0].id)).returning() : await db.insert(workspaceConnections).values({ workspaceId: workspace.id, provider, defaultModel: parsed.data.defaultModel, enabled: String(parsed.data.enabled) }).returning(); return c.json({ connection }) })
app.post('/api/connections/test', async (c) => { const input = await c.req.json().catch(() => ({})); const provider = z.string().parse(input.provider); const model = z.string().parse(input.model); await currentUser(c); if (provider === 'mock') return c.json({ ok: true, provider, model, message: 'Local mock provider is ready.' }); const endpoint = provider === 'fal' ? 'https://api.fal.ai/v1/models?limit=1' : 'https://openrouter.ai/api/v1/key'; const headers = provider === 'fal' ? { Authorization: `Key ${config.FAL_API_KEY ?? ''}` } : { Authorization: `Bearer ${config.OPENROUTER_API_KEY ?? ''}` }; if (!(provider === 'fal' ? config.FAL_API_KEY : config.OPENROUTER_API_KEY)) return c.json({ ok: false, provider, model, message: `${provider} is not configured. Add its API key to .env.` }, 400); const response = await fetch(endpoint, { headers }); if (!response.ok) return c.json({ ok: false, provider, model, message: `${provider} rejected the connection test (${response.status}).` }, 400); return c.json({ ok: true, provider, model, message: `${provider} connection is valid.` }) })
app.post('/api/workflows/runs', async (c) => {
  const parsed = createRunSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const user = await currentUser(c)
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id)).limit(1)
  if (!workspace) return c.json({ error: 'Workspace not found' }, 500)
  if (parsed.data.provider) {
    const [connection] = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, parsed.data.provider))).limit(1)
    if (connection?.enabled === 'false') return c.json({ error: `${parsed.data.provider} is disabled in connection settings` }, 400)
  }
  const [workspaceWorkflow] = await db.select().from(workflows).where(and(eq(workflows.workspaceId, workspace.id), eq(workflows.name, parsed.data.name))).limit(1)
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
