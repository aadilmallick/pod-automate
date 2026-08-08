import archiver from 'archiver'
import { PassThrough } from 'node:stream'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { assets, marketplaceListings, mockups, productVariants, runs } from './db/schema'
import { storage } from './storage'

function safeName(name: string) { return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '') || 'asset' }

function extensionFor(asset: { storagePath: string; contentType: string }) {
  const fromPath = asset.storagePath.split('.').pop()
  if (fromPath && fromPath.length <= 5) return fromPath
  return asset.contentType.split('/')[1] ?? 'bin'
}

export async function exportRunZip(runId: string): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } })
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<Buffer>((resolve, reject) => { output.on('end', () => resolve(Buffer.concat(chunks))); archive.on('error', reject) })
  archive.pipe(output)
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1)
  if (!run) throw new Error('Run not found')
  const runAssets = await db.select().from(assets).where(eq(assets.runId, runId))
  const variants = await db.select().from(productVariants).where(eq(productVariants.runId, runId))
  const runMockups = []
  const listings = []
  for (const variant of variants) {
    runMockups.push(...await db.select().from(mockups).where(eq(mockups.productVariantId, variant.id)))
    listings.push(...await db.select().from(marketplaceListings).where(eq(marketplaceListings.productVariantId, variant.id)))
  }
  archive.append(JSON.stringify({ run, assets: runAssets, variants, mockups: runMockups, listings }, null, 2), { name: 'manifest.json' })
  for (const asset of runAssets) {
    const folder = asset.type === 'uploaded-design' ? 'source-designs' : 'generated-designs'
    archive.append(await storage.get(asset.storagePath), { name: `${folder}/${safeName(asset.name)}.${extensionFor(asset)}` })
  }
  for (const [index, mockup] of runMockups.entries()) {
    if (!mockup.storagePath) continue
    const ext = mockup.storagePath.split('.').pop() ?? 'bin'
    archive.append(await storage.get(mockup.storagePath), { name: `mockups/mockup-${String(index + 1).padStart(3, '0')}.${ext}` })
  }
  await archive.finalize()
  return done
}
