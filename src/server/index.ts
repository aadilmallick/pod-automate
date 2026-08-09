import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { config } from './config'
import { db } from './db/client'
import { assets, jobs, marketplaceConnections, marketplaceListings, marketplaceOauthSessions, mockups, productVariants, promptTemplates, runs, users, workflows, workspaces, workspaceConnections } from './db/schema'
import { authStatus, clearSession, createDevSession, currentUser, finishGoogleAuth, startGoogleAuth, workspaceForUser } from './auth'
import { dashboardCatalog } from './catalog'
import { defaultWorkflow } from '../core/workflow'
import { defaultModelForProvider } from './ai'
import type { ImageStyle } from '../core/prompting'
import { marketplaceQueue, workflowQueue } from './queue'
import { storage } from './storage'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { exportRunZip } from './zip'
import { hasGenerativeTemplates, mockupProviderConfigured } from './provider-config'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOAuthState, createPkce, decryptSecret, encryptSecret, hashOAuthState } from './marketplaces/crypto'
import { storeEtsyConnection, getEtsyContext } from './marketplaces/etsy-auth'
import { EtsyAdapter } from './marketplaces/etsy-adapter'
import { validateEtsyListing } from './marketplaces/etsy-listing'

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
const connectionProviderSchema = z.enum(['fal', 'openrouter', 'huggingface', 'ollama', 'gemini', 'bg-removal', 'mock'])
const styleSchema = z.enum(['illustration', 'watercolor', 'editorial', 'vintage', 'flat-vector', '3d-render', 'photorealistic', 'anime'])
const sourceSchema = z.enum(['ai', 'upload'])
const createRunSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(2000), source: sourceSchema.default('ai'), style: styleSchema.default('illustration'), includeText: z.boolean().default(false), negativePrompt: z.string().max(2000).optional(), count: z.number().int().min(1).max(100), products: z.array(z.string()).min(1), destinations: z.array(z.string()).default(['download']), provider: providerSchema.optional(), model: z.string().max(160).optional(), assetIds: z.array(z.string().uuid()).default([]), templates: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['deterministic', 'generative']), productType: z.string(), quantity: z.number().int().min(1).max(20), config: z.record(z.unknown()).optional() })).default([]), prepareArtwork: z.object({ removeBackground: z.boolean().default(false), resize: z.boolean().default(true), maxDimension: z.number().int().min(256).max(8192).optional() }).optional() })
const promptTemplateSchema = z.object({ name: z.string().min(1).max(160), prompt: z.string().min(1).max(4000), provider: z.enum(['fal', 'openrouter', 'huggingface', 'ollama', 'mock']), model: z.string().max(160).optional(), description: z.string().max(255).optional() })
const providerModels: Record<string, string[]> = { fal: [config.FAL_IMAGE_MODEL], openrouter: [config.OPENROUTER_IMAGE_MODEL], huggingface: [config.HUGGINGFACE_IMAGE_MODEL, 'black-forest-labs/FLUX.2-klein-9B'], ollama: [config.OLLAMA_IMAGE_MODEL, config.OLLAMA_IMAGE_MODEL_9B], gemini: [config.GEMINI_MOCKUP_MODEL], 'bg-removal': ['auto', 'sharp', 'imgly', 'none'], mock: ['local-mock'] }
const connectionSchema = z.object({ defaultModel: z.string().min(1).max(160), enabled: z.boolean() })
const etsyListingSchema = z.object({ title: z.string().max(140), description: z.string().max(13000), tags: z.array(z.string().max(20)).max(13), price: z.number().positive(), quantity: z.number().int().min(1).max(999), taxonomyId: z.number().int().positive(), shippingProfileId: z.number().int().positive(), readinessStateId: z.number().int().positive(), sku: z.string().min(1).max(32), whoMade: z.enum(['i_did', 'collective', 'someone_else']).default('someone_else'), whenMade: z.string().min(1).default('made_to_order'), isSupply: z.boolean().default(false), imageIds: z.array(z.string().uuid()).min(1).max(10) })
const etsySettingsSchema = z.object({ productDefaults: z.record(z.object({ price: z.number().positive(), quantity: z.number().int().min(1), taxonomyId: z.number().int().positive(), shippingProfileId: z.number().int().positive(), readinessStateId: z.number().int().positive(), skuPrefix: z.string().min(1).max(12), whoMade: z.enum(['i_did', 'collective', 'someone_else']).default('someone_else'), whenMade: z.string().default('made_to_order'), isSupply: z.boolean().default(false) })) })
function validProviderModel(provider: string, model: string) { return providerModels[provider]?.includes(model) ?? false }
function providerConfigured(provider: string) { return provider === 'mock' || (provider === 'ollama' ? config.OLLAMA_CONFIGURED : provider === 'fal' ? Boolean(config.FAL_API_KEY) : provider === 'openrouter' ? Boolean(config.OPENROUTER_API_KEY) : provider === 'huggingface' ? Boolean(config.HUGGINGFACE_TOKEN) : false) }

async function ownedMarketplaceListing(userId: string, listingId: string) {
  const workspace = await workspaceForUser(userId)
  const [row] = workspace ? await db.select({ listing: marketplaceListings, variant: productVariants }).from(marketplaceListings).innerJoin(productVariants, eq(marketplaceListings.productVariantId, productVariants.id)).innerJoin(runs, eq(productVariants.runId, runs.id)).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(marketplaceListings.id, listingId), eq(workflows.workspaceId, workspace.id))).limit(1) : []
  return workspace && row ? { workspace, ...row } : undefined
}

app.get('/api/marketplaces/etsy/oauth/start', async (c) => {
  if (!config.ETSY_CONFIGURED || !config.MARKETPLACE_TOKEN_ENCRYPTION_KEY) return c.json({ error: 'Etsy app credentials and token encryption are not configured' }, 503)
  const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500)
  const state = createOAuthState(); const { verifier, challenge } = createPkce()
  await db.insert(marketplaceOauthSessions).values({ workspaceId: workspace.id, provider: 'etsy', stateHash: hashOAuthState(state), verifierEncrypted: encryptSecret(verifier, config.MARKETPLACE_TOKEN_ENCRYPTION_KEY, `${workspace.id}:etsy-oauth`), expiresAt: new Date(Date.now() + 10 * 60_000) })
  const url = new URL('https://www.etsy.com/oauth/connect'); url.search = new URLSearchParams({ response_type: 'code', client_id: config.ETSY_KEYSTRING!, redirect_uri: config.ETSY_REDIRECT_URI, scope: 'listings_r listings_w shops_r', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
  return c.redirect(url.toString())
})

app.get('/api/marketplaces/etsy/oauth/callback', async (c) => {
  if (!config.MARKETPLACE_TOKEN_ENCRYPTION_KEY) return c.json({ error: 'Etsy token encryption is not configured' }, 503)
  const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const state = c.req.query('state'); const code = c.req.query('code'); if (!workspace || !state || !code) return c.json({ error: 'Invalid Etsy OAuth callback' }, 400)
  const [session] = await db.update(marketplaceOauthSessions).set({ consumedAt: new Date(), updatedAt: new Date() }).where(and(eq(marketplaceOauthSessions.workspaceId, workspace.id), eq(marketplaceOauthSessions.provider, 'etsy'), eq(marketplaceOauthSessions.stateHash, hashOAuthState(state)), isNull(marketplaceOauthSessions.consumedAt), gt(marketplaceOauthSessions.expiresAt, new Date()))).returning()
  if (!session) return c.json({ error: 'Etsy OAuth state is invalid, expired, or already used' }, 400)
  const verifier = decryptSecret(session.verifierEncrypted, config.MARKETPLACE_TOKEN_ENCRYPTION_KEY, `${workspace.id}:etsy-oauth`)
  const tokenResponse = await fetch('https://api.etsy.com/v3/public/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.ETSY_KEYSTRING!, redirect_uri: config.ETSY_REDIRECT_URI, code, code_verifier: verifier }) }); const token = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>
  if (!tokenResponse.ok || !token.access_token) return c.json({ error: 'Etsy authorization exchange failed' }, 400)
  const accessToken = String(token.access_token); const userId = accessToken.split('.')[0]
  const meResponse = await fetch(`https://openapi.etsy.com/v3/application/users/${userId}/shops`, { headers: { 'x-api-key': `${config.ETSY_KEYSTRING}:${config.ETSY_SHARED_SECRET}`, Authorization: `Bearer ${accessToken}` } }); const shops = await meResponse.json().catch(() => ({})) as { results?: Array<{ shop_id: number; shop_name: string }> }; const shop = shops.results?.[0]
  if (!meResponse.ok || !shop) return c.json({ error: 'No Etsy shop was found for this account' }, 400)
  await storeEtsyConnection(workspace.id, { accessToken, refreshToken: String(token.refresh_token), expiresAt: new Date(Date.now() + Number(token.expires_in ?? 3600) * 1000), scopes: String(token.scope ?? '').split(' ').filter(Boolean), shopId: String(shop.shop_id), shopName: shop.shop_name })
  return c.redirect(`${config.WEB_URL}/?etsy=connected`)
})

app.get('/api/marketplaces/etsy/connection', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [connection] = workspace ? await db.select().from(marketplaceConnections).where(and(eq(marketplaceConnections.workspaceId, workspace.id), eq(marketplaceConnections.provider, 'etsy'))).limit(1) : []; return c.json({ configured: config.ETSY_CONFIGURED, connection: connection ? { id: connection.id, state: connection.state, shopId: connection.externalAccountId, shopName: connection.externalAccountName, scopes: connection.scopes, expiresAt: connection.tokenExpiresAt, settings: connection.settings, lastError: connection.lastError } : null }) })
app.delete('/api/marketplaces/etsy/connection', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 404); await db.update(marketplaceConnections).set({ accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, externalAccountId: null, externalAccountName: null, scopes: [], state: 'disconnected', lastError: null, updatedAt: new Date() }).where(and(eq(marketplaceConnections.workspaceId, workspace.id), eq(marketplaceConnections.provider, 'etsy'))); return c.json({ ok: true }) })
app.put('/api/marketplaces/etsy/settings', async (c) => { const parsed = etsySettingsSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 404); const [existing] = await db.select().from(marketplaceConnections).where(and(eq(marketplaceConnections.workspaceId, workspace.id), eq(marketplaceConnections.provider, 'etsy'))).limit(1); const connection = existing ? (await db.update(marketplaceConnections).set({ settings: parsed.data, updatedAt: new Date() }).where(eq(marketplaceConnections.id, existing.id)).returning())[0] : (await db.insert(marketplaceConnections).values({ workspaceId: workspace.id, provider: 'etsy', settings: parsed.data }).returning())[0]; return c.json({ settings: connection.settings }) })
app.get('/api/marketplaces/etsy/options', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 404); try { const context = await getEtsyContext(workspace.id); const etsy = new EtsyAdapter({ keystring: config.ETSY_KEYSTRING!, sharedSecret: config.ETSY_SHARED_SECRET! }); const [shippingProfiles, readinessProfiles, taxonomy] = await Promise.all([etsy.getShippingProfiles(context), etsy.getReadinessProfiles(context), etsy.getTaxonomy(context)]); return c.json({ shippingProfiles, readinessProfiles, taxonomy }) } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Unable to load Etsy options' }, 400) } })

app.get('/api/dashboard/catalog', async (c) => { const user = await currentUser(c); return c.json(await dashboardCatalog(user.id)) })
app.get('/api/workflows', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ workflows: [], userId: user.id }); const rows = await db.select().from(workflows).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(workflows.createdAt)); return c.json({ workflows: rows, userId: user.id }) })
app.post('/api/prompt-templates', async (c) => { const parsed = promptTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); if (parsed.data.model && !validProviderModel(parsed.data.provider, parsed.data.model)) return c.json({ error: `Unsupported model for ${parsed.data.provider}` }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const [template] = await db.insert(promptTemplates).values({ workspaceId: workspace.id, ...parsed.data, model: parsed.data.model || null, description: parsed.data.description || null }).returning(); return c.json({ template }, 201) })
app.put('/api/prompt-templates/:id', async (c) => { const parsed = promptTemplateSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); if (parsed.data.model && !validProviderModel(parsed.data.provider, parsed.data.model)) return c.json({ error: `Unsupported model for ${parsed.data.provider}` }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [template] = workspace ? await db.update(promptTemplates).set({ ...parsed.data, model: parsed.data.model || null, description: parsed.data.description || null, updatedAt: new Date() }).where(and(eq(promptTemplates.id, c.req.param('id')), eq(promptTemplates.workspaceId, workspace.id))).returning() : []; if (!template) return c.json({ error: 'Prompt template not found' }, 404); return c.json({ template }) })
app.delete('/api/prompt-templates/:id', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const deleted = await db.delete(promptTemplates).where(and(eq(promptTemplates.id, c.req.param('id')), eq(promptTemplates.workspaceId, workspace.id))).returning({ id: promptTemplates.id }); if (!deleted.length) return c.json({ error: 'Prompt template not found' }, 404); return c.json({ ok: true }) })
app.put('/api/connections/:provider', async (c) => { const parsed = connectionSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const workspace = await workspaceForUser(user.id); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const provider = connectionProviderSchema.parse(c.req.param('provider')); if (!validProviderModel(provider, parsed.data.defaultModel)) return c.json({ error: `Unsupported model for ${provider}` }, 400); const existing = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, provider))).limit(1); const [connection] = existing.length ? await db.update(workspaceConnections).set({ defaultModel: parsed.data.defaultModel, enabled: String(parsed.data.enabled), updatedAt: new Date() }).where(eq(workspaceConnections.id, existing[0].id)).returning() : await db.insert(workspaceConnections).values({ workspaceId: workspace.id, provider, defaultModel: parsed.data.defaultModel, enabled: String(parsed.data.enabled) }).returning(); return c.json({ connection }) })
app.post('/api/connections/test', async (c) => {
  const input = await c.req.json().catch(() => ({}))
  const provider = connectionProviderSchema.parse(input.provider)
  const model = z.string().default(provider === 'gemini' ? config.GEMINI_MOCKUP_MODEL : defaultModelForProvider(provider)).parse(input.model)
  await currentUser(c)
  if (provider === 'mock') return c.json({ ok: true, provider, model, message: 'Local mock provider is ready.' })
  if (provider === 'ollama') {
    try {
      const response = await fetch(`${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`)
      if (!response.ok) return c.json({ ok: false, provider, model, message: `Ollama rejected the connection test (${response.status}).` }, 400)
      const data = await response.json() as { models?: Array<{ name?: string }> }
      const installed = data.models?.some((item) => item.name === model || item.name?.startsWith(`${model}:`))
      return c.json({ ok: true, provider, model, message: installed ? `Ollama is reachable and ${model} is installed.` : `Ollama is reachable, but ${model} is not installed. Pull it with \\"ollama pull ${model}\\".` })
    } catch { return c.json({ ok: false, provider, model, message: `Ollama is not reachable at ${config.OLLAMA_BASE_URL}. Start Ollama or update OLLAMA_BASE_URL.` }, 400) }
  }
  if (provider === 'huggingface') {
    if (!config.HUGGINGFACE_TOKEN) return c.json({ ok: false, provider, model, message: 'Hugging Face is not configured. Add HUGGINGFACE_TOKEN to .env.' }, 400)
    const response = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${config.HUGGINGFACE_TOKEN}` } })
    if (!response.ok) return c.json({ ok: false, provider, model, message: `Hugging Face rejected the connection test (${response.status}).` }, 400)
    return c.json({ ok: true, provider, model, message: 'Hugging Face token is valid.' })
  }
  if (provider === 'gemini') {
    if (!config.GEMINI_API_KEY) return c.json({ ok: false, provider, model, message: 'Gemini Nano Banana Pro is not configured. Add GEMINI_API_KEY to .env.' }, 400)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': config.GEMINI_API_KEY } })
    if (!response.ok) return c.json({ ok: false, provider, model, message: `Gemini rejected the connection test (${response.status}).` }, 400)
    return c.json({ ok: true, provider, model, message: 'Gemini Nano Banana Pro connection is valid.' })
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
  if (hasGenerativeTemplates(parsed.data.templates)) {
    const [mockupConnection] = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, config.MOCKUP_AI_PROVIDER))).limit(1)
    if (mockupConnection?.enabled === 'false') return c.json({ error: 'Gemini Nano Banana Pro is disabled in connection settings' }, 400)
    if (!mockupProviderConfigured(config.MOCKUP_AI_PROVIDER, config.GEMINI_API_KEY)) return c.json({ error: 'Gemini Nano Banana Pro is not configured. Add GEMINI_API_KEY to .env.' }, 400)
  }
  if (parsed.data.provider) {
    const [connection] = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspace.id), eq(workspaceConnections.provider, parsed.data.provider))).limit(1)
    if (connection?.enabled === 'false') return c.json({ error: `${parsed.data.provider} is disabled in connection settings` }, 400)
    if (!providerConfigured(parsed.data.provider)) return c.json({ error: `${parsed.data.provider} is not configured. Add its credentials or start its local service first.` }, 400)
    if (parsed.data.model && !validProviderModel(parsed.data.provider, parsed.data.model)) return c.json({ error: `Unsupported model for ${parsed.data.provider}` }, 400)
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
app.patch('/api/listings/:id', async (c) => { const parsed = etsyListingSchema.safeParse(await c.req.json()); if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400); const user = await currentUser(c); const owned = await ownedMarketplaceListing(user.id, c.req.param('id')); if (!owned || owned.listing.marketplace !== 'etsy') return c.json({ error: 'Listing not found' }, 404); if (['syncing', 'publishing', 'published'].includes(owned.listing.status)) return c.json({ error: `A ${owned.listing.status} listing cannot be edited` }, 409); const [listing] = await db.update(marketplaceListings).set({ metadata: { ...(owned.listing.metadata as object), ...parsed.data }, lastError: null, failedStage: null, status: owned.listing.externalId ? 'draft' : 'preview', updatedAt: new Date() }).where(eq(marketplaceListings.id, owned.listing.id)).returning(); return c.json({ listing }) })
app.post('/api/listings/:id/etsy-draft', async (c) => { const user = await currentUser(c); const owned = await ownedMarketplaceListing(user.id, c.req.param('id')); if (!owned || owned.listing.marketplace !== 'etsy') return c.json({ error: 'Listing not found' }, 404); if (!config.ETSY_CONFIGURED) return c.json({ error: 'Etsy app credentials are not configured' }, 400); const [connection] = await db.select().from(marketplaceConnections).where(and(eq(marketplaceConnections.workspaceId, owned.workspace.id), eq(marketplaceConnections.provider, 'etsy'), eq(marketplaceConnections.state, 'connected'))).limit(1); if (!connection?.accessTokenEncrypted) return c.json({ error: 'Connect Etsy before syncing a draft' }, 400); const errors = validateEtsyListing(owned.listing.metadata as never); if (errors.length) return c.json({ error: errors.join('. ') }, 400); const [listing] = await db.update(marketplaceListings).set({ status: 'syncing', lastError: null, failedStage: null, updatedAt: new Date() }).where(and(eq(marketplaceListings.id, owned.listing.id), inArray(marketplaceListings.status, ['preview', 'draft', 'failed']))).returning(); if (!listing) return c.json({ error: 'Listing is already being processed' }, 409); await marketplaceQueue.add('etsy-sync-draft', { listingId: listing.id, workspaceId: owned.workspace.id }, { jobId: `etsy-draft-${listing.id}-${Date.now()}`, attempts: 4, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 100 }); return c.json({ listing }, 202) })
app.post('/api/listings/:id/publish', async (c) => { const body = await c.req.json().catch(() => ({})) as { confirm?: boolean }; if (body.confirm !== true) return c.json({ error: 'Explicit confirmation of Etsy activation and listing fees is required' }, 400); const user = await currentUser(c); const owned = await ownedMarketplaceListing(user.id, c.req.param('id')); if (!owned || owned.listing.marketplace !== 'etsy') return c.json({ error: 'Listing not found' }, 404); if (!owned.listing.externalId || owned.listing.status !== 'draft') return c.json({ error: 'A successful Etsy draft is required before publishing' }, 409); const [listing] = await db.update(marketplaceListings).set({ status: 'publishing', updatedAt: new Date() }).where(and(eq(marketplaceListings.id, owned.listing.id), eq(marketplaceListings.status, 'draft'))).returning(); if (!listing) return c.json({ error: 'Listing is already being processed' }, 409); await marketplaceQueue.add('etsy-publish', { listingId: listing.id, workspaceId: owned.workspace.id }, { jobId: `etsy-publish-${listing.id}`, attempts: 4, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 100 }); return c.json({ listing }, 202) })
app.get('/api/runs/:id/export.zip', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const [ownedRun] = workspace ? await db.select({ run: runs }).from(runs).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(runs.id, c.req.param('id')), eq(workflows.workspaceId, workspace.id))).limit(1) : []; if (!ownedRun) return c.json({ error: 'Run not found' }, 404); const archive = await exportRunZip(c.req.param('id')); return new Response(new Uint8Array(archive), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="pod-run-${c.req.param('id')}.zip"` } }) })
app.post('/api/assets/upload', async (c) => { const user = await currentUser(c); const workspace = await workspaceForUser(user.id); const body = await c.req.parseBody(); const file = body.file; if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400); if (!workspace) return c.json({ error: 'Workspace not found' }, 500); const key = `uploads/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const bytes = Buffer.from(await file.arrayBuffer()); if (config.STORAGE_DRIVER === 'local') { const target = join(config.STORAGE_DIR, key); await mkdir(join(config.STORAGE_DIR, 'uploads'), { recursive: true }); await writeFile(target, bytes) } else await storage.put(key, bytes, file.type); const [asset] = await db.insert(assets).values({ workspaceId: workspace.id, type: 'uploaded-design', name: file.name, storagePath: key, contentType: file.type || 'application/octet-stream', metadata: { source: 'upload' } }).returning(); return c.json({ id: asset.id, name: asset.name, path: key, url: await storage.getPublicUrl(key) }, 201) })

export default app
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => console.log(`POD Automator API listening on ${config.APP_URL}`))
