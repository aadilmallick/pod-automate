import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('localhost'),
  PORT: z.coerce.number().default(3000),
  API_PUBLIC_PORT: z.coerce.number().optional(),
  WEB_HOST: z.string().default('localhost'),
  WEB_PORT: z.coerce.number().default(5173),
  PUBLIC_HOST: z.string().default('localhost'),
  PUBLIC_WEB_HOST: z.string().default('localhost'),
  APP_URL: z.string().url().optional(),
  WEB_URL: z.string().url().optional(),
  DATABASE_URL: z.string().default('postgres://pod:pod@localhost:5432/pod_automator'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  AUTH_SECRET: z.string().min(16).default('dev-only-change-this-secret'),
  AUTH_MODE: z.enum(['development', 'google']).default('development'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_IMAGE_MODEL: z.string().default('google/gemini-3.1-flash-image'),
  FAL_API_KEY: z.string().optional(),
  FAL_IMAGE_MODEL: z.string().default('fal-ai/flux/schnell'),
  AI_PROVIDER: z.enum(['openrouter', 'fal', 'mock']).default('openrouter'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./data/uploads'),
  PUBLIC_ASSET_URL: z.string().url().optional(),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('pod-assets'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
}).parse(process.env)

const publicApiPort = envSchema.API_PUBLIC_PORT ?? envSchema.PORT
const appUrl = envSchema.APP_URL ?? `http://${envSchema.PUBLIC_HOST}:${publicApiPort}`
const webUrl = envSchema.WEB_URL ?? `http://${envSchema.PUBLIC_WEB_HOST}:${envSchema.WEB_PORT}`

export const config = {
  ...envSchema,
  API_PUBLIC_PORT: publicApiPort,
  APP_URL: appUrl,
  WEB_URL: webUrl,
  GOOGLE_REDIRECT_URI: envSchema.GOOGLE_REDIRECT_URI ?? `${appUrl}/api/auth/google/callback`,
  PUBLIC_ASSET_URL: envSchema.PUBLIC_ASSET_URL ?? `${appUrl}/uploads`,
}

if (config.NODE_ENV === 'production' && config.AUTH_MODE !== 'google') {
  throw new Error('Production requires AUTH_MODE=google with Google OAuth credentials; development identity is unsafe.')
}
