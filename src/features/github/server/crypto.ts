const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return base64ToBytes(`${normalized}${padding}`)
}

export function randomToken(byteLength = 32): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function sha256Bytes(
  value: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  )
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await sha256Bytes(value)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Base64Url(value: string): Promise<string> {
  return encodeBase64Url(await sha256Bytes(value))
}

export async function createPkcePair(): Promise<{
  verifier: string
  challenge: string
}> {
  const verifier = randomToken(32)
  return { verifier, challenge: await sha256Base64Url(verifier) }
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = decodeBase64Url(encodedKey.trim())
  } catch {
    throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY must be base64url encoded.')
  }

  if (raw.byteLength !== 32) {
    throw new Error('GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.')
  }

  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptSecret(
  plaintext: string,
  encodedKey: string,
  additionalData: string,
): Promise<string> {
  const key = await importEncryptionKey(encodedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(additionalData),
    },
    key,
    encoder.encode(plaintext),
  )

  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`
}

export async function decryptSecret(
  encrypted: string,
  encodedKey: string,
  additionalData: string,
): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = encrypted.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext || extra) {
    throw new Error('Encrypted value is not in a known format.')
  }

  const key = await importEncryptionKey(encodedKey)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64Url(encodedIv),
      additionalData: encoder.encode(additionalData),
    },
    key,
    decodeBase64Url(encodedCiphertext),
  )

  return decoder.decode(plaintext)
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return difference === 0
}

export function encodeUtf8Base64(value: string): string {
  return bytesToBase64(encoder.encode(value))
}

export function decodeUtf8Base64(value: string): string {
  return decoder.decode(base64ToBytes(value.replaceAll(/\s/gu, '')))
}
