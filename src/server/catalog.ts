import { desc, eq, inArray } from 'drizzle-orm'
import { db } from './db/client'
import { assets, jobs, marketplaceListings, mockupTemplates, productVariants, runs, workflows } from './db/schema'
import { storage } from './storage'
import { workspaceForUser } from './auth'
import { config } from './config'

const artPalettes = [
  { background: 'linear-gradient(135deg, #f5b47e 0%, #ffdcb0 100%)', accent: '#45251b', icon: '☾' },
  { background: 'linear-gradient(135deg, #a7c7ff 0%, #dae7ff 100%)', accent: '#1b315f', icon: '◒' },
  { background: 'linear-gradient(135deg, #b4e8c6 0%, #e1f8e7 100%)', accent: '#19412b', icon: '✦' },
  { background: 'linear-gradient(135deg, #d6b7f1 0%, #f0e2ff 100%)', accent: '#42245d', icon: '○' },
  { background: 'linear-gradient(135deg, #ffafc1 0%, #ffe0e7 100%)', accent: '#641f36', icon: '✹' },
  { background: 'linear-gradient(135deg, #ffe28c 0%, #fff2c7 100%)', accent: '#57400d', icon: '⌁' },
]

function palette(index: number) { return artPalettes[index % artPalettes.length] }

export async function dashboardCatalog(userId: string) {
  const workspace = await workspaceForUser(userId)
  if (!workspace) return { runs: [], assets: [], templates: [], listings: [], connections: [], stats: { workflows: 0, assets: 0, readyListings: 0 } }
  const workspaceWorkflows = await db.select().from(workflows).where(eq(workflows.workspaceId, workspace.id)).orderBy(desc(workflows.createdAt))
  const workflowIds = workspaceWorkflows.map((workflow) => workflow.id)
  const workspaceRuns = workflowIds.length ? await db.select().from(runs).where(inArray(runs.workflowId, workflowIds)).orderBy(desc(runs.createdAt)).limit(25) : []
  const runIds = workspaceRuns.map((run) => run.id)
  const workspaceAssets = await db.select().from(assets).where(eq(assets.workspaceId, workspace.id)).orderBy(desc(assets.createdAt)).limit(100)
  const variants = runIds.length ? await db.select().from(productVariants).where(inArray(productVariants.runId, runIds)) : []
  const variantIds = variants.map((variant) => variant.id)
  const workspaceListings = variantIds.length ? await db.select().from(marketplaceListings).where(inArray(marketplaceListings.productVariantId, variantIds)).orderBy(desc(marketplaceListings.createdAt)).limit(100) : []
  const templates = await db.select().from(mockupTemplates).where(eq(mockupTemplates.workspaceId, workspace.id)).orderBy(desc(mockupTemplates.createdAt)).limit(24)
  const jobsByRun = runIds.length ? await db.select().from(jobs).where(inArray(jobs.runId, runIds)) : []
  return {
    stats: { workflows: workspaceWorkflows.length, assets: workspaceAssets.length, readyListings: workspaceListings.filter((listing) => listing.status === 'ready' || listing.status === 'draft').length },
    connections: [
      { id: 'openrouter', name: 'OpenRouter', configured: Boolean(config.OPENROUTER_API_KEY), detail: 'Image generation · credits required' },
      { id: 'fal', name: 'Fal.ai', configured: Boolean(config.FAL_API_KEY), detail: 'Image generation · Flux Schnell' },
      { id: 'storage', name: config.STORAGE_DRIVER === 's3' ? 'S3-compatible storage' : 'Local storage', configured: true, detail: 'Asset persistence' },
    ],
    runs: workspaceRuns.map((run, index) => ({ id: run.id, name: workspaceWorkflows.find((workflow) => workflow.id === run.workflowId)?.name ?? 'Production run', detail: `${run.config && typeof run.config === 'object' && 'count' in run.config ? run.config.count : 0} designs · ${run.config && typeof run.config === 'object' && 'products' in run.config && Array.isArray(run.config.products) ? run.config.products.length : 0} products`, status: run.status, progress: run.progressPercent, date: run.createdAt, ...palette(index), jobs: jobsByRun.filter((job) => job.runId === run.id).map((job) => ({ id: job.id, stepName: job.stepName, status: job.status, errorLog: job.errorLog })) })),
    assets: await Promise.all(workspaceAssets.map(async (asset, index) => ({ id: asset.id, name: asset.name, type: asset.type, contentType: asset.contentType, url: await storage.getPublicUrl(asset.storagePath), ...palette(index), createdAt: asset.createdAt }))),
    templates: templates.map((template, index) => ({ id: template.id, name: template.name, kind: template.type, productType: template.productType, quantity: Number((template.config as { quantity?: number })?.quantity ?? 1), ...palette(index) })),
    listings: workspaceListings.map((listing, index) => { const variant = variants.find((item) => item.id === listing.productVariantId); const metadata = listing.metadata as { title?: string; tags?: string[] }; return { id: listing.id, title: metadata.title ?? `${variant?.productType ?? 'Product'} listing`, type: variant?.productType ?? 'product', status: listing.status, tags: metadata.tags ?? [], ...palette(index) } }),
  }
}
