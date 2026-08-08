import { and, eq, inArray } from 'drizzle-orm'
import { Worker, type Job } from 'bullmq'
import { db } from './db/client'
import { assets, jobs, marketplaceListings, mockups, productVariants, runs } from './db/schema'
import { defaultModelForProvider, generateImages, imageProvider } from './ai'
import { storage } from './storage'
import { redis } from './queue'
import { config } from './config'
import { buildDesignPrompt, buildMockupPrompt, defaultNegativePrompt, type ImageStyle } from './prompt-builder'
import { renderDeterministicMockup } from './mockup-renderer'

interface RunPayload { runId: string; workspaceId: string; prompt: string; source?: 'ai' | 'upload'; style?: ImageStyle; includeText?: boolean; negativePrompt?: string; count: number; products: string[]; destinations: string[]; provider?: string; model?: string; assetIds?: string[]; templates?: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: string; quantity: number; config?: Record<string, unknown> }> }

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
  const { runId, workspaceId, prompt, source = 'ai', style = 'illustration', includeText = false, negativePrompt: customNegativePrompt, count, products, destinations, provider, model: configuredModel, assetIds = [], templates = [] } = job.data
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
  await updateRun(runId, 35, 'running')
  let completed = 0
  for (const designId of designIds) {
    for (const productType of products) {
      const [stageJob] = await db.insert(jobs).values({ runId, stepName: `mockup:${designId}:${productType}`, status: 'running' }).returning()
      const [variant] = await db.insert(productVariants).values({ runId, designAssetId: designId, productType, status: 'ready' }).returning()
      const [designAsset] = await db.select().from(assets).where(and(eq(assets.id, designId), eq(assets.workspaceId, workspaceId))).limit(1)
      if (!designAsset) throw new Error('Design asset disappeared before mockup rendering')
      const designBuffer = await storage.get(designAsset.storagePath)
      const productTemplates = templates.filter((template) => template.productType === productType)
      const templatesToRender = productTemplates.length ? productTemplates : [{ id: 'fallback-studio', name: 'Studio front', kind: 'deterministic' as const, productType, quantity: 1 }]
      for (const template of templatesToRender) {
        for (let templateIndex = 0; templateIndex < template.quantity; templateIndex += 1) {
          let mockupBuffer: Buffer
          let mockupContentType = 'image/svg+xml'
          if (template.kind === 'generative') {
            const mockupPrompt = buildMockupPrompt({ templateName: template.name, productType, designPrompt: prompt, style, includeText: effectiveIncludeText, negativePrompt })
            const generated = await generateImages(imageProvider(effectiveProvider), { prompt: mockupPrompt, negativePrompt, referenceImageUrls: [await storage.getPublicUrl(designAsset.storagePath)], width: 1600, height: 1600, count: 1, model })
            mockupBuffer = await bufferFromUrl(generated.urls[0])
            mockupContentType = imageFormat(mockupBuffer).contentType
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
        await db.insert(marketplaceListings).values({ productVariantId: variant.id, marketplace: destination, status: destination === 'download' ? 'ready' : 'draft', metadata: { title: `${prompt.slice(0, 65)} · ${productType}`, tags: ['print on demand', productType, 'original design'] } })
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
