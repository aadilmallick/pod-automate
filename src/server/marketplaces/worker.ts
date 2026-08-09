import { and, eq } from 'drizzle-orm'
import { Worker, type Job } from 'bullmq'
import { db } from '../db/client'
import { marketplaceConnections, marketplaceListings, mockups, productVariants, runs, workflows } from '../db/schema'
import { redis } from '../queue'
import { storage } from '../storage'
import { config } from '../config'
import type { MarketplaceListingPayload } from '../../core/interfaces/providers'
import { EtsyAdapter, EtsyApiError } from './etsy-adapter'
import { getEtsyContext } from './etsy-auth'
import { validateEtsyListing, type EtsyListingData } from './etsy-listing'

type MarketplaceJob = { listingId: string; workspaceId: string }
const adapter = () => { if (!config.ETSY_KEYSTRING || !config.ETSY_SHARED_SECRET) throw new Error('Etsy app credentials are not configured'); return new EtsyAdapter({ keystring: config.ETSY_KEYSTRING, sharedSecret: config.ETSY_SHARED_SECRET }) }

async function withAuthRetry<T>(workspaceId: string, operation: (context: Awaited<ReturnType<typeof getEtsyContext>>) => Promise<T>) {
  try { return await operation(await getEtsyContext(workspaceId)) }
  catch (error) {
    if (!(error instanceof EtsyApiError) || error.status !== 401) throw error
    await db.update(marketplaceConnections).set({ tokenExpiresAt: new Date(0), updatedAt: new Date() }).where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.provider, 'etsy')))
    return operation(await getEtsyContext(workspaceId))
  }
}

async function ownedListing(listingId: string, workspaceId: string) {
  const [row] = await db.select({ listing: marketplaceListings, variant: productVariants }).from(marketplaceListings).innerJoin(productVariants, eq(marketplaceListings.productVariantId, productVariants.id)).innerJoin(runs, eq(productVariants.runId, runs.id)).innerJoin(workflows, eq(runs.workflowId, workflows.id)).where(and(eq(marketplaceListings.id, listingId), eq(workflows.workspaceId, workspaceId), eq(marketplaceListings.marketplace, 'etsy'))).limit(1)
  if (!row) throw new Error('Etsy listing not found')
  return row
}

async function payloadFor(row: Awaited<ReturnType<typeof ownedListing>>): Promise<MarketplaceListingPayload> {
  const data = row.listing.metadata as unknown as EtsyListingData
  const errors = validateEtsyListing(data)
  if (errors.length) throw new EtsyApiError(errors.join('. '), 400, false)
  const ready = await db.select().from(mockups).where(and(eq(mockups.productVariantId, row.variant.id), eq(mockups.status, 'ready')))
  const byId = new Map(ready.map((image) => [image.id, image]))
  const selected = data.imageIds.map((id) => byId.get(id)).filter((image): image is typeof ready[number] => Boolean(image?.storagePath)).slice(0, 10)
  if (!selected.length) throw new EtsyApiError('At least one selected mockup must still be ready', 400, false)
  const images = await Promise.all(selected.map(async (image, index) => ({ buffer: await storage.get(image.storagePath!), contentType: image.storagePath!.endsWith('.png') ? 'image/png' : image.storagePath!.endsWith('.webp') ? 'image/webp' : 'image/jpeg', filename: `mockup-${index + 1}.${image.storagePath!.split('.').pop() ?? 'jpg'}` })))
  return { ...data, images }
}

async function syncDraft(job: Job<MarketplaceJob>) {
  const row = await ownedListing(job.data.listingId, job.data.workspaceId)
  const payload = await payloadFor(row)
  const etsy = adapter()
  const result = row.listing.externalId ? await withAuthRetry(job.data.workspaceId, (context) => etsy.updateDraftListing(context, row.listing.externalId!, payload)) : await withAuthRetry(job.data.workspaceId, (context) => etsy.createDraftListing(context, payload))
  await db.update(marketplaceListings).set({ externalId: result.externalListingId, externalUrl: result.draftUrl, updatedAt: new Date() }).where(eq(marketplaceListings.id, row.listing.id))
  const previous = (row.listing.metadata as { etsy?: { images?: Array<{ listing_image_id?: number | string }> } }).etsy?.images ?? []
  for (const image of previous) if (image.listing_image_id) await withAuthRetry(job.data.workspaceId, (context) => etsy.deleteListingImage(context, result.externalListingId, String(image.listing_image_id)))
  const uploaded = []
  for (const [index, image] of payload.images.entries()) uploaded.push(await withAuthRetry(job.data.workspaceId, (context) => etsy.uploadListingImage(context, result.externalListingId, image, index + 1)))
  await db.update(marketplaceListings).set({ externalId: result.externalListingId, externalUrl: result.draftUrl, status: 'draft', metadata: { ...(row.listing.metadata as object), etsy: { listing: result.raw, images: uploaded } }, syncedAt: new Date(), lastError: null, failedStage: null, updatedAt: new Date() }).where(eq(marketplaceListings.id, row.listing.id))
}

async function publish(job: Job<MarketplaceJob>) {
  const row = await ownedListing(job.data.listingId, job.data.workspaceId)
  if (!row.listing.externalId) throw new EtsyApiError('Sync an Etsy draft before publishing', 400, false)
  const result = await withAuthRetry(job.data.workspaceId, (context) => adapter().publishListing(context, row.listing.externalId!))
  await db.update(marketplaceListings).set({ status: 'published', externalUrl: result.url, publishedAt: new Date(), lastError: null, failedStage: null, updatedAt: new Date() }).where(eq(marketplaceListings.id, row.listing.id))
}

export const marketplaceWorker = new Worker<MarketplaceJob>('pod-marketplaces', async (job) => {
  try { if (job.name === 'etsy-sync-draft') return syncDraft(job); if (job.name === 'etsy-publish') return publish(job); throw new Error(`Unknown marketplace job ${job.name}`) }
  catch (error) { if (error instanceof EtsyApiError && error.status === 429 && error.retryAfter) { await marketplaceWorker.rateLimit(error.retryAfter * 1000); throw Worker.RateLimitError() }; if (error instanceof EtsyApiError && !error.retryable) { job.discard(); await db.update(marketplaceListings).set({ status: 'failed', failedStage: job.name === 'etsy-publish' ? 'publish' : 'draft', lastError: error.message.slice(0, 1000), updatedAt: new Date() }).where(eq(marketplaceListings.id, job.data.listingId)) }; throw error }
}, { connection: redis, concurrency: 3 })

marketplaceWorker.on('failed', (job, error) => { if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return; const stage = job.name === 'etsy-publish' ? 'publish' : 'draft'; void db.update(marketplaceListings).set({ status: 'failed', failedStage: stage, lastError: error.message.slice(0, 1000), updatedAt: new Date() }).where(eq(marketplaceListings.id, job.data.listingId)) })
