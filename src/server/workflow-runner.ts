import { and, eq, inArray } from 'drizzle-orm'
import { Worker, type Job } from 'bullmq'
import { db } from './db/client'
import { assets, jobs, marketplaceConnections, marketplaceListings, mockups, productVariants, runs, workspaceConnections } from './db/schema'
import { defaultModelForProvider, generateImages, imageProvider } from './ai'
import { storage } from './storage'
import { redis } from './queue'
import { config } from './config'
import { buildDesignPrompt, defaultNegativePrompt, type ImageStyle } from './prompt-builder'
import { renderDeterministicMockup } from './mockup-renderer'
import { generateMockupImage } from './mockup-generation'
import { backgroundRemovalConfigured, conformToMaxDimension, transformationProvider } from './transformations'
import { buildEtsyPreview } from './marketplaces/etsy-listing'

interface RunPayload { runId: string; workspaceId: string; prompt: string; source?: 'ai' | 'upload'; style?: ImageStyle; includeText?: boolean; negativePrompt?: string; count: number; products: string[]; destinations: string[]; provider?: string; model?: string; assetIds?: string[]; templates?: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: string; quantity: number; config?: Record<string, unknown> }>; prepareArtwork?: { removeBackground?: boolean; resize?: boolean; maxDimension?: number } }

async function updateRun(runId: string, progressPercent: number, status: string, errorLog?: string) { await db.update(runs).set({ progressPercent, status, ...(errorLog ? { errorLog } : {}), updatedAt: new Date() }).where(eq(runs.id, runId)) }

async function updateJob(runId: string, stepName: string, status: string, errorLog?: string) { await db.update(jobs).set({ status, ...(errorLog ? { errorLog } : {}), updatedAt: new Date() }).where(and(eq(jobs.runId, runId), eq(jobs.stepName, stepName))) }

async function bufferFromUrl(url: string) {
  if (!url.startsWith('data:')) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Generated image download failed (${response.status})`)
    return Buffer.from(await response.arrayBuffer())
  }
  const [header, payload = ''] = url.split(',', 2)
  return header.includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
}

function imageFormat(buffer: Buffer) {
  if (buffer.subarray(0, 100).toString().includes('<svg')) return { extension: 'svg', contentType: 'image/svg+xml' }
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { extension: 'png', contentType: 'image/png' }
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return { extension: 'jpg', contentType: 'image/jpeg' }
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { extension: 'webp', contentType: 'image/webp' }
  return { extension: 'bin', contentType: 'application/octet-stream' }
}

function bufferDataUrl(buffer: Buffer, contentType: string) {
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

async function processRun(job: Job<RunPayload>) {
  const { runId, workspaceId, prompt, source = 'ai', style = 'illustration', includeText = false, negativePrompt: customNegativePrompt, count, products, destinations, provider, model: configuredModel, assetIds = [], templates = [], prepareArtwork } = job.data
  const effectiveProvider = provider ?? config.AI_PROVIDER
  const model = configuredModel || defaultModelForProvider(effectiveProvider)
  const effectiveIncludeText = source === 'upload' ? true : includeText
  const negativePrompt = defaultNegativePrompt(effectiveIncludeText, customNegativePrompt)
  const designPrompt = buildDesignPrompt({ prompt, style, includeText: effectiveIncludeText, negativePrompt, width: 1024, height: 1024 })
  await updateRun(runId, 5, 'running')
  await updateJob(runId, 'workflow:start', 'running')
  const designIds: string[] = []
  if (assetIds.length) {
    const selectedAssets = await db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), inArray(assets.id, assetIds)))
    if (selectedAssets.length !== assetIds.length) throw new Error('Selected assets could not be found in this workspace')
    await db.update(assets).set({ runId, updatedAt: new Date() }).where(inArray(assets.id, selectedAssets.map((asset) => asset.id)))
    designIds.push(...selectedAssets.map((asset) => asset.id))
    await updateJob(runId, 'workflow:start', 'completed')
  } else {
    const generation = await generateImages(imageProvider(effectiveProvider), { prompt: designPrompt, negativePrompt, width: 1024, height: 1024, count, model })
    for (const [index, url] of generation.urls.entries()) {
    const buffer = await bufferFromUrl(url)
    const { extension, contentType } = imageFormat(buffer)
    const storagePath = `runs/${runId}/designs/design-${String(index + 1).padStart(3, '0')}.${extension}`
    await storage.put(storagePath, buffer, contentType)
    const [asset] = await db.insert(assets).values({ runId, workspaceId, type: 'design', name: `Design ${index + 1}`, storagePath, contentType, metadata: { provider: effectiveProvider, prompt, generatedPrompt: designPrompt, negativePrompt, style, includeText: effectiveIncludeText, source, model } }).returning()
    designIds.push(asset.id)
    }
    await updateJob(runId, 'workflow:start', 'completed')
  }
  await updateRun(runId, 20, 'running')

  // Explicit artwork-preparation stage: optional background removal (offline ONNX via
  // @imgly) and conform/resize to a max dimension. Produces `processed-design` assets that
  // feed mockup rendering, leaving the original design untouched.
  const preparedDesigns = new Map<string, { buffer: Buffer; asset: { id: string; storagePath: string } }>()
  const prepare = prepareArtwork ?? { removeBackground: false, resize: true }
  const maxDimension = prepare.maxDimension ?? config.TRANSFORM_MAX_DIMENSIONS
  if (prepare.removeBackground || prepare.resize) {
    await db.insert(jobs).values({ runId, stepName: 'prepare', status: 'running' })
    const [bgRemovalConnection] = await db.select().from(workspaceConnections).where(and(eq(workspaceConnections.workspaceId, workspaceId), eq(workspaceConnections.provider, 'bg-removal'))).limit(1)
    const bgRemovalEnabled = Boolean(prepare.removeBackground && backgroundRemovalConfigured() && bgRemovalConnection?.enabled !== 'false')
    if (prepare.removeBackground && !bgRemovalEnabled) {
      console.warn(`[worker] background removal requested but unavailable (driver=${config.TRANSFORM_DRIVER}, connection=${bgRemovalConnection?.enabled ?? 'n/a'}) — skipping`)
    }
    for (const designId of designIds) {
      const [designAsset] = await db.select().from(assets).where(and(eq(assets.id, designId), eq(assets.workspaceId, workspaceId))).limit(1)
      if (!designAsset) throw new Error('Design asset disappeared before artwork preparation')
      let buffer = await storage.get(designAsset.storagePath)
      const operations: string[] = []
      if (bgRemovalEnabled) {
        buffer = await transformationProvider.removeBackground(buffer)
        operations.push('removeBackground')
      }
      if (prepare.resize) {
        const resized = await conformToMaxDimension(buffer, maxDimension, transformationProvider)
        if (resized !== buffer) operations.push('resize')
        buffer = resized
      }
      if (operations.length) {
        const storagePath = `runs/${runId}/prepared/design-${designId}.png`
        await storage.put(storagePath, buffer, 'image/png')
        const [processed] = await db.insert(assets).values({
          runId,
          workspaceId,
          type: 'processed-design',
          name: `${designAsset.name} · prepared`,
          storagePath,
          contentType: 'image/png',
          metadata: { sourceDesignId: designId, operations, provider: bgRemovalEnabled ? 'imgly' : 'sharp', maxDimension, ...(designAsset.metadata && typeof designAsset.metadata === 'object' ? designAsset.metadata as Record<string, unknown> : {}) },
        }).returning()
        preparedDesigns.set(designId, { buffer, asset: processed })
      }
    }
    await updateJob(runId, 'prepare', 'completed')
  }
  await updateRun(runId, 35, 'running')
  let completed = 0
  for (const designId of designIds) {
    for (const productType of products) {
      const [stageJob] = await db.insert(jobs).values({ runId, stepName: `mockup:${designId}:${productType}`, status: 'running' }).returning()
      const [variant] = await db.insert(productVariants).values({ runId, designAssetId: designId, productType, status: 'ready' }).returning()
      const [designAsset] = await db.select().from(assets).where(and(eq(assets.id, designId), eq(assets.workspaceId, workspaceId))).limit(1)
      if (!designAsset) throw new Error('Design asset disappeared before mockup rendering')
      const prepared = preparedDesigns.get(designId)
      const designBuffer = prepared?.buffer ?? await storage.get(designAsset.storagePath)
      const productTemplates = templates.filter((template) => template.productType === productType)
      const templatesToRender = productTemplates.length ? productTemplates : [{ id: 'fallback-studio', name: 'Studio front', kind: 'deterministic' as const, productType, quantity: 1 }]
      for (const template of templatesToRender) {
        for (let templateIndex = 0; templateIndex < template.quantity; templateIndex += 1) {
          let mockupBuffer: Buffer
          let mockupContentType = 'image/svg+xml'
          if (template.kind === 'generative') {
            const generated = await generateMockupImage({ designBuffer, designContentType: prepared ? 'image/png' : designAsset.contentType, templateName: template.name, productType, includeText: effectiveIncludeText })
            mockupBuffer = generated.buffer
            mockupContentType = generated.contentType
          } else {
            mockupBuffer = await renderDeterministicMockup(designBuffer, { productType, templateName: template.name, templateConfig: template.config })
            mockupContentType = 'image/webp'
          }
          const extension = mockupContentType === 'image/png' ? 'png' : mockupContentType === 'image/webp' ? 'webp' : 'svg'
          const mockupPath = `runs/${runId}/mockups/${variant.id}-${template.id}-${templateIndex + 1}.${extension}`
          await storage.put(mockupPath, mockupBuffer, mockupContentType)
          await db.insert(mockups).values({ productVariantId: variant.id, templateId: template.kind === 'deterministic' && /^[0-9a-f-]{36}$/i.test(template.id) ? template.id : undefined, storagePath: mockupPath, status: 'ready' })
        }
      }
      for (const destination of destinations) {
        if (destination === 'etsy') {
          const [connection] = await db.select().from(marketplaceConnections).where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.provider, 'etsy'))).limit(1)
          const settings = connection?.settings as { productDefaults?: Record<string, { price: number; quantity: number; taxonomyId: number; shippingProfileId: number; readinessStateId: number; skuPrefix?: string; whoMade?: 'i_did' | 'collective' | 'someone_else'; whenMade?: string; isSupply?: boolean }> } | undefined
          const defaults = settings?.productDefaults?.[productType]
          const preview = buildEtsyPreview({ prompt, productType, variantId: variant.id })
          const readyMockups = await db.select({ id: mockups.id }).from(mockups).where(and(eq(mockups.productVariantId, variant.id), eq(mockups.status, 'ready')))
          await db.insert(marketplaceListings).values({ productVariantId: variant.id, marketplace: destination, status: 'preview', metadata: { ...preview, sku: defaults?.skuPrefix ? `${defaults.skuPrefix}-${variant.id.slice(0, 8).toUpperCase()}` : preview.sku, price: defaults?.price ?? 0, quantity: defaults?.quantity ?? 0, taxonomyId: defaults?.taxonomyId ?? 0, shippingProfileId: defaults?.shippingProfileId ?? 0, readinessStateId: defaults?.readinessStateId ?? 0, whoMade: defaults?.whoMade ?? 'someone_else', whenMade: defaults?.whenMade ?? 'made_to_order', isSupply: defaults?.isSupply ?? false, imageIds: readyMockups.map((item) => item.id) } })
        } else await db.insert(marketplaceListings).values({ productVariantId: variant.id, marketplace: destination, status: destination === 'download' ? 'ready' : 'draft', metadata: { title: `${prompt.slice(0, 65)} · ${productType}`, tags: ['print on demand', productType, 'original design'] } })
      }
      await db.update(jobs).set({ status: 'completed', updatedAt: new Date() }).where(eq(jobs.id, stageJob.id))
      completed += 1
    }
    await updateRun(runId, Math.min(94, 35 + Math.round((completed / Math.max(1, designIds.length * products.length)) * 55)), 'running')
  }
  await updateRun(runId, 100, 'completed')
  return { designCount: designIds.length, productCount: completed }
}

export const worker = new Worker<RunPayload>('pod-workflows', processRun, { connection: redis, concurrency: 2 })
worker.on('completed', (job) => console.log(`[worker] completed ${job.id}`))
worker.on('failed', (job, error) => { console.error(`[worker] failed ${job?.id}`, error); if (job?.data.runId && job.attemptsMade >= (job.opts.attempts ?? 1)) void Promise.all([updateRun(job.data.runId, 0, 'failed', error.message), db.update(jobs).set({ status: 'failed', errorLog: error.message, updatedAt: new Date() }).where(and(eq(jobs.runId, job.data.runId), eq(jobs.status, 'running')))]) })
