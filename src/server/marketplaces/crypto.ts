import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const b64url = (value: Buffer) => value.toString('base64url')

export function pkceChallenge(verifier: string) { return b64url(createHash('sha256').update(verifier).digest()) }
export function createPkce() { const verifier = b64url(randomBytes(48)); return { verifier, challenge: pkceChallenge(verifier) } }
export function createOAuthState() { return b64url(randomBytes(32)) }
export function hashOAuthState(state: string) { return createHash('sha256').update(state).digest('hex') }

function encryptionKey(value: string) {
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('MARKETPLACE_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64')
  return key
}

export function encryptSecret(secret: string, keyValue: string, associatedData: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyValue), iv)
  cipher.setAAD(Buffer.from(associatedData))
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [b64url(iv), b64url(cipher.getAuthTag()), b64url(ciphertext)].join('.')
}

export function decryptSecret(value: string, keyValue: string, associatedData: string) {
  const [ivValue, tagValue, ciphertextValue] = value.split('.')
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Invalid encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyValue), Buffer.from(ivValue, 'base64url'))
  decipher.setAAD(Buffer.from(associatedData)); decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
}
