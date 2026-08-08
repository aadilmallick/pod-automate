import { eq } from 'drizzle-orm'
import { Worker, type Job } from 'bullmq'
import { db } from './db/client'
import { assets, jobs, marketplaceListings, mockups, productVariants, runs } from './db/schema'
import { imageProvider } from './ai'
import { storage } from './storage'
import { redis } from './queue'
import { config } from './config'

interface RunPayload { runId: string; prompt: string; count: number; products: string[]; destinations: string[]; provider?: string; templates?: Array<{ id: string; name: string; kind: 'deterministic' | 'generative'; productType: string; quantity: number }> }

async function updateRun(runId: string, progressPercent: number, status: string) { await db.update(runs).set({ progressPercent, status, updatedAt: new Date() }).where(eq(runs.id, runId)) }

async function bufferFromUrl(url: string) { return url.startsWith('data:') ? Buffer.from(url.split(',')[1], 'base64') : Buffer.from(await (await fetch(url)).arrayBuffer()) }

async function processRun(job: Job<RunPayload>) {
  const { runId, prompt, count, products, destinations, provider, templates = [] } = job.data
  await updateRun(runId, 5, 'running')
  const generation = await imageProvider(provider).generateImages({ prompt, width: 1024, height: 1024, count, model: provider === 'fal' ? config.FAL_IMAGE_MODEL : config.OPENROUTER_IMAGE_MODEL })
  const designIds: string[] = []
  for (const [index, url] of generation.urls.entries()) {
    const buffer = await bufferFromUrl(url)
    const isSvg = buffer.subarray(0, 100).toString().includes('<svg')
    const extension = isSvg ? 'svg' : 'png'
    const contentType = isSvg ? 'image/svg+xml' : 'image/png'
    const storagePath = `runs/${runId}/designs/design-${String(index + 1).padStart(3, '0')}.${extension}`
    await storage.put(storagePath, buffer, contentType)
    const [asset] = await db.insert(assets).values({ runId, type: 'design', name: `Design ${index + 1}`, storagePath, contentType, metadata: { provider: provider ?? config.AI_PROVIDER, prompt, model: config.OPENROUTER_IMAGE_MODEL } }).returning()
    designIds.push(asset.id)
  }
  await updateRun(runId, 35, 'running')
  let completed = 0
  for (const designId of designIds) {
    for (const productType of products) {
      const [variant] = await db.insert(productVariants).values({ runId, designAssetId: designId, productType, status: 'ready' }).returning()
      const productTemplates = templates.filter((template) => template.productType === productType)
      const templatesToRender = productTemplates.length ? productTemplates : [{ id: 'fallback-studio', name: 'Studio front', kind: 'deterministic' as const, productType, quantity: 1 }]
      for (const template of templatesToRender) {
        for (let templateIndex = 0; templateIndex < template.quantity; templateIndex += 1) {
          let mockupBuffer: Buffer
          let mockupContentType = 'image/svg+xml'
          if (template.kind === 'generative') {
            const generated = await imageProvider(provider).generateImages({ prompt: `${template.name}: place the exact artwork for a ${productType} product into a polished lifestyle mockup. ${prompt}`, width: 1600, height: 1600, count: 1, model: provider === 'fal' ? config.FAL_IMAGE_MODEL : config.OPENROUTER_IMAGE_MODEL })
            mockupBuffer = await bufferFromUrl(generated.urls[0])
            mockupContentType = mockupBuffer.subarray(0, 100).toString().includes('<svg') ? 'image/svg+xml' : 'image/png'
          } else {
            const background = '#e6f5ee'
            const accent = '#398862'
            const mockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="100%" height="100%" fill="${background}"/><rect x="180" y="160" width="1240" height="1280" rx="48" fill="#ffffff" opacity=".82"/><circle cx="800" cy="540" r="170" fill="${accent}" opacity=".16"/><text x="800" y="720" text-anchor="middle" fill="${accent}" font-family="sans-serif" font-size="68" font-weight="700">${productType.toUpperCase()}</text><text x="800" y="820" text-anchor="middle" fill="#4a456c" font-family="sans-serif" font-size="34">${template.name} · deterministic</text><text x="800" y="1370" text-anchor="middle" fill="#9b96ba" font-family="sans-serif" font-size="24">TEMPLATE MOCKUP · POD AUTOMATOR</text></svg>`
            mockupBuffer = Buffer.from(mockupSvg)
          }
          const extension = mockupContentType === 'image/png' ? 'png' : 'svg'
          const mockupPath = `runs/${runId}/mockups/${variant.id}-${template.id}-${templateIndex + 1}.${extension}`
          await storage.put(mockupPath, mockupBuffer, mockupContentType)
          await db.insert(mockups).values({ productVariantId: variant.id, storagePath: mockupPath, status: 'ready' })
        }
      }
      for (const destination of destinations) {
        await db.insert(marketplaceListings).values({ productVariantId: variant.id, marketplace: destination, status: destination === 'download' ? 'ready' : 'draft', metadata: { title: `${prompt.slice(0, 65)} · ${productType}`, tags: ['print on demand', productType, 'original design'] } })
      }
      await db.insert(jobs).values({ runId, stepName: `mockup:${productType}`, status: 'completed' })
      completed += 1
    }
    await updateRun(runId, Math.min(94, 35 + Math.round((completed / Math.max(1, designIds.length * products.length)) * 55)), 'running')
  }
  await updateRun(runId, 100, 'completed')
  return { designCount: designIds.length, productCount: completed }
}

export const worker = new Worker<RunPayload>('pod-workflows', processRun, { connection: redis, concurrency: 2 })
worker.on('completed', (job) => console.log(`[worker] completed ${job.id}`))
worker.on('failed', (job, error) => { console.error(`[worker] failed ${job?.id}`, error); if (job?.data.runId) void updateRun(job.data.runId, 0, 'failed') })
