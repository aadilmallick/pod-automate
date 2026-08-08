import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { config } from './config'

export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
redis.on('error', (error) => console.error('[redis]', error.message))
export const workflowQueue = new Queue('pod-workflows', { connection: redis })
