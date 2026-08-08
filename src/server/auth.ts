import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users, workspaces } from './db/schema'
import { config } from './config'

const SESSION_COOKIE = 'pod_session'
const STATE_COOKIE = 'pod_oauth_state'

function signature(value: string) {
  return createHmac('sha256', config.AUTH_SECRET).update(value).digest('hex')
}

function signedSession(userId: string) {
  const value = `${userId}.${signature(userId)}`
  return value
}

function verifiedSession(value?: string) {
  if (!value) return undefined
  const [userId, provided] = value.split('.')
  if (!userId || !provided) return undefined
  const expected = signature(userId)
  if (provided.length !== expected.length) return undefined
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected)) ? userId : undefined
}

async function ensureWorkspace(userId: string) {
  const existing = await db.select().from(workspaces).where(eq(workspaces.ownerId, userId)).limit(1)
  if (existing[0]) return existing[0]
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return (await db.insert(workspaces).values({ ownerId: userId, name: `${user?.name ?? 'Personal'}'s studio` }).returning())[0]
}

export async function userFromId(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return user
}

export async function currentUser(c: Context) {
  const cookieUserId = verifiedSession(getCookie(c, SESSION_COOKIE))
  if (cookieUserId) {
    const user = await userFromId(cookieUserId)
    if (user) return user
  }

  if (config.AUTH_MODE === 'google') {
    throw new Error('Authentication required')
  }

  const email = c.req.header('x-dev-user-email') ?? 'owner@local.test'
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing[0]) {
    await ensureWorkspace(existing[0].id)
    return existing[0]
  }
  const [user] = await db.insert(users).values({ email, name: email === 'owner@local.test' ? 'Local Owner' : email }).returning()
  await ensureWorkspace(user.id)
  return user
}

export async function requireUser(c: Context) {
  try {
    return await currentUser(c)
  } catch {
    return undefined
  }
}

export async function workspaceForUser(userId: string) {
  return (await db.select().from(workspaces).where(eq(workspaces.ownerId, userId)).limit(1))[0]
}

export function authStatus() {
  return { mode: config.AUTH_MODE, googleConfigured: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET), message: config.AUTH_MODE === 'google' ? 'Google OAuth is enabled when credentials are configured.' : 'Development identity is active. Set AUTH_MODE=google to enable OAuth.' }
}

export function startGoogleAuth(c: Context) {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) return c.text('Google OAuth credentials are not configured.', 503)
  const state = randomBytes(24).toString('hex')
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, sameSite: 'Lax', secure: config.NODE_ENV === 'production', maxAge: 600, path: '/' })
  const params = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email profile', state, access_type: 'offline', prompt: 'select_account' })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}

export async function finishGoogleAuth(c: Context) {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) return c.text('Google OAuth credentials are not configured.', 503)
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state || state !== getCookie(c, STATE_COOKIE)) return c.text('Invalid OAuth state.', 400)
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, redirect_uri: config.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }) })
  if (!tokenResponse.ok) return c.text('Google token exchange failed.', 502)
  const token = await tokenResponse.json() as { access_token?: string }
  if (!token.access_token) return c.text('Google did not return an access token.', 502)
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } })
  if (!profileResponse.ok) return c.text('Google profile request failed.', 502)
  const profile = await profileResponse.json() as { sub: string; email: string; name?: string }
  const existing = (await db.select().from(users).where(eq(users.email, profile.email)).limit(1))[0]
  const user = existing ? (await db.update(users).set({ googleId: profile.sub, name: profile.name ?? existing.name, updatedAt: new Date() }).where(eq(users.id, existing.id)).returning())[0] : (await db.insert(users).values({ googleId: profile.sub, email: profile.email, name: profile.name ?? profile.email }).returning())[0]
  await ensureWorkspace(user.id)
  setCookie(c, SESSION_COOKIE, signedSession(user.id), { httpOnly: true, sameSite: 'Lax', secure: config.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 30, path: '/' })
  return c.redirect(config.WEB_URL)
}

export function createDevSession(c: Context, userId: string) {
  setCookie(c, SESSION_COOKIE, signedSession(userId), { httpOnly: true, sameSite: 'Lax', secure: config.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 30, path: '/' })
}

export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  deleteCookie(c, STATE_COOKIE, { path: '/' })
}
