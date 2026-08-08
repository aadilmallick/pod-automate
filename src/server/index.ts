import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { config } from './config'
import { db } from './db/client'
import { assets, jobs, marketplaceListings, productVariants, runs, users, workflows, workspaces } from './db/schema'
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
app.get('/api/auth/status', async (c) => { const status = authStatus(); const user = await (async () => { try { return await currentUser(c) } catch { return undefined } })(); return c.json({ ...status, authenticated: Boolean(user), user: user ? { id: user.id, name: user.name, email: user.email } : null }) })
app.get('/api/auth/google', (c) => startGoogleAuth(c))
app.get('/api/auth/google/callback', (c) => finishGoogleAuth(c))
app.post('/api/auth/dev-session', async (c) => { const user = await currentUser(c); createDevSession(c, user.id); return c.json({ user: { id: user.id, name: user.name, email: user.email } }) })
app.post('/api/auth/logout', (c) => { clearSession(c); return c.json({ ok: true }) })
app.get('/api/me', async (c) => { const user = await currentUser(c); return c.json({ user }) })

const createRunSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(2000), count: z.number().int().min(1).max(100), products: z.array(z.string()).min(1), destinations: z.array(z.string()).default(['download']), provider: z.string().optional(), templates: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['deterministic', 'generative']), productType: z.string(), quantity: z.number().int().min(1).max(20) })).default([]) })

app.get('/api/dashboard/catalog', async (c) => { const user = await currentUser(c); return c.json(await dashboardCatalog(user.id)) })
app.get('/api/workflows', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ workflows: [], userId: user.id }); const rows = await db.select().from(workflows).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(workflows.createdAt)); return c.json({ workflows: rows, userId: user.id }) })
app.post('/api/workflows/runs', async (c) => {
  const parsed = createRunSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const user = await currentUser(c)
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, user.id)).limit(1)
  const [workspaceWorkflow] = workspace ? await db.select().from(workflows).where(and(eq(workflows.workspaceId, workspace.id), eq(workflows.name, parsed.data.name))).limit(1) : []
  if (!workspace) return c.json({ error: 'Workspace not found' }, 500)
  const workflow = workspaceWorkflow ?? (await db.insert(workflows).values({ workspaceId: workspace.id, name: parsed.data.name, definitionGraph: defaultWorkflow }).returning())[0]
  const [run] = await db.insert(runs).values({ workflowId: workflow.id, status: 'queued', config: parsed.data }).returning()
  await db.insert(jobs).values({ runId: run.id, stepName: 'workflow:start', status: 'queued' })
  await workflowQueue.add('run', { runId: run.id, ...parsed.data }, { jobId: run.id, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 })
  return c.json({ run }, 202)
})
app.get('/api/runs', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ runs: [] }); const rows = await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(runs.createdAt)).limit(25); return c.json({ runs: rows.map((row) => row.run) }) })
app.get('/api/runs/:id', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [run] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!run) return c.json({ error: 'Run not found' }, 404); const runRecord = run.run; const runAssets = await db.select().from(assets).where(eq(assets.runId, runRecord.id)); return c.json({ run: runRecord, assets: await Promise.all(runAssets.map(async (asset) => ({ ...asset, url: await storage.getPublicUrl(asset.storagePath) }))) }) })
app.get('/api/runs/:id/listings', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [ownedRun] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!ownedRun) return c.json({ error: 'Run not found' }, 404); const runVariants = await db.select().from(productVariants).where(eq(productVariants.runId, c.req.param('id'))); const listings = []; for (const variant of runVariants) listings.push(...await db.select().from(marketplaceListings).where(eq(marketplaceListings.productVariantId, variant.id))); return c.json({ listings }) })
app.get('/api/runs/:id/export.zip', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [ownedRun] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!ownedRun) return c.json({ error: 'Run not found' }, 404); const archive = await exportRunZip(c.req.param('id')); return new Response(new Uint8Array(archive), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="pod-run-${c.req.param('id')}.zip"` } }) })
app.post('/api/assets/upload', async (c) => { await currentUser(c); const body = await c.req.parseBody(); const file = body.file; if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400); const key = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const bytes = Buffer.from(await file.arrayBuffer()); if (config.STORAGE_DRIVER === 'local') { const target = join(config.STORAGE_DIR, key); await mkdir(join(config.STORAGE_DIR, 'uploads'), { recursive: true }); await writeFile(target, bytes) } else await storage.put(key, bytes, file.type); return c.json({ name: file.name, path: key, url: await storage.getPublicUrl(key) }, 201) })

export default app
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => console.log(`POD Automator API listening on ${config.APP_URL}`))
