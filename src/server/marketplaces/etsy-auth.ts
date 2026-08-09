import { and, eq, sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db/client'
import { marketplaceConnections } from '../db/schema'
import { decryptSecret, encryptSecret } from './crypto'

export interface EtsyTokens { accessToken: string; refreshToken: string; expiresAt: Date; scopes: string[]; shopId: string; shopName: string }
const aad = (workspaceId: string) => `${workspaceId}:etsy`

function key() { if (!config.MARKETPLACE_TOKEN_ENCRYPTION_KEY) throw new Error('Etsy token encryption is not configured'); return config.MARKETPLACE_TOKEN_ENCRYPTION_KEY }

export async function storeEtsyConnection(workspaceId: string, tokens: EtsyTokens) {
  const values = { accessTokenEncrypted: encryptSecret(tokens.accessToken, key(), aad(workspaceId)), refreshTokenEncrypted: encryptSecret(tokens.refreshToken, key(), aad(workspaceId)), tokenExpiresAt: tokens.expiresAt, scopes: tokens.scopes, externalAccountId: tokens.shopId, externalAccountName: tokens.shopName, state: 'connected', lastError: null, updatedAt: new Date() }
  const [existing] = await db.select().from(marketplaceConnections).where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.provider, 'etsy'))).limit(1)
  if (existing) return (await db.update(marketplaceConnections).set(values).where(eq(marketplaceConnections.id, existing.id)).returning())[0]
  return (await db.insert(marketplaceConnections).values({ workspaceId, provider: 'etsy', ...values }).returning())[0]
}

async function refresh(workspaceId: string, refreshToken: string, shopId: string, shopName: string) {
  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.ETSY_KEYSTRING ?? '', refresh_token: refreshToken }) })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || !body.access_token) throw new Error(String(body.error_description ?? body.error ?? 'Etsy token refresh failed'))
  return storeEtsyConnection(workspaceId, { accessToken: String(body.access_token), refreshToken: String(body.refresh_token ?? refreshToken), expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000), scopes: String(body.scope ?? '').split(' ').filter(Boolean), shopId, shopName })
}

export async function getEtsyContext(workspaceId: string) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${workspaceId}:etsy-token`}))`)
      const [connection] = await tx.select().from(marketplaceConnections).where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.provider, 'etsy'))).limit(1)
      if (!connection?.accessTokenEncrypted || !connection.refreshTokenEncrypted || !connection.externalAccountId) throw new Error('Connect Etsy before syncing a draft')
      let current = connection
      if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() <= Date.now() + 60_000) current = await refresh(workspaceId, decryptSecret(connection.refreshTokenEncrypted, key(), aad(workspaceId)), connection.externalAccountId, connection.externalAccountName ?? '')
      return { accessToken: decryptSecret(current.accessTokenEncrypted!, key(), aad(workspaceId)), shopId: current.externalAccountId || connection.externalAccountId }
    })
  } catch (error) {
    await db.update(marketplaceConnections).set({ state: 'error', lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Token refresh failed', updatedAt: new Date() }).where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.provider, 'etsy')))
    throw error
  }
}
