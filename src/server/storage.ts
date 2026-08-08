import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { StorageProvider } from '../core/interfaces/providers'
import { config } from './config'

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root = config.STORAGE_DIR, private readonly publicBase = config.PUBLIC_ASSET_URL) {}
  private filePath(key: string) { return join(this.root, normalize(`/${key}`).replace(/^\//, '')) }
  async put(path: string, buffer: Buffer, contentType: string): Promise<string> { void contentType; await mkdir(dirname(this.filePath(path)), { recursive: true }); await writeFile(this.filePath(path), buffer); return path }
  async get(path: string) { return readFile(this.filePath(path)) }
  async delete(path: string) { await unlink(this.filePath(path)).catch(() => undefined) }
  async getPublicUrl(path: string) { return `${this.publicBase}/${path}` }
}

export class S3StorageProvider implements StorageProvider {
  private readonly client = new S3Client({ region: config.S3_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } })
  async put(path: string, buffer: Buffer, contentType: string) { await this.client.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: path, Body: buffer, ContentType: contentType })); return path }
  async get(path: string) { const response = await this.client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: path })); return Buffer.from(await response.Body!.transformToByteArray()) }
  async delete(path: string) { await this.client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: path })) }
  async getPublicUrl(path: string) { return `${config.PUBLIC_ASSET_URL}/${path}` }
}

export const storage: StorageProvider = config.STORAGE_DRIVER === 's3' ? new S3StorageProvider() : new LocalStorageProvider()
