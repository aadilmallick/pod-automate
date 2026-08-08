import archiver from 'archiver'
import { PassThrough } from 'node:stream'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { assets, marketplaceListings, productVariants, runs } from './db/schema'
import { storage } from './storage'

export async function exportRunZip(runId: string): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } })
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<Buffer>((resolve, reject) => { output.on('end', () => resolve(Buffer.concat(chunks))); archive.on('error', reject) })
  archive.pipe(output)
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1)
  const runAssets = await db.select().from(assets).where(eq(assets.runId, runId))
  const variants = await db.select().from(productVariants).where(eq(productVariants.runId, runId))
  const listings = []
  for (const variant of variants) listings.push(...await db.select().from(marketplaceListings).where(eq(marketplaceListings.productVariantId, variant.id)))
  archive.append(JSON.stringify({ run, assets: runAssets, variants, listings }, null, 2), { name: 'manifest.json' })
  for (const asset of runAssets) archive.append(await storage.get(asset.storagePath), { name: `designs/${asset.name}.${asset.storagePath.split('.').pop() ?? 'bin'}` })
  await archive.finalize()
  return done
}
