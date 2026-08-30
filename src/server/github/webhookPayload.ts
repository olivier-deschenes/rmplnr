export const MAX_GITHUB_WEBHOOK_BYTES = 10 * 1024 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const GITHUB_SHA_PATTERN = /^[a-f0-9]{40,64}$/
const GITHUB_DELIVERY_PATTERN = /^[A-Za-z0-9-]{1,128}$/

export class GithubWebhookError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GithubWebhookError'
    this.status = status
  }
}

export interface RepositoryChangedWebhook {
  type: 'repository-changed'
  repositoryId: string
  headSha: string
}

export interface InstallationAccessWebhook {
  type: 'installation-access-changed'
  event: 'installation' | 'installation_repositories'
  action: string
  installationId: string
  repositoryIdsAdded: Array<string>
  repositoryIdsRemoved: Array<string>
}

export interface IgnoredWebhook {
  type: 'ignored'
}

export type GithubWebhookNotification =
  RepositoryChangedWebhook | InstallationAccessWebhook | IgnoredWebhook

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GithubWebhookError(400, `Invalid ${field} in webhook payload.`)
  }

  return value
}

function readString(
  value: unknown,
  field: string,
  maximumLength = 255,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new GithubWebhookError(400, `Invalid ${field} in webhook payload.`)
  }

  return value
}

function readGithubId(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new GithubWebhookError(400, `Invalid ${field} in webhook payload.`)
  }

  return String(value)
}

function readRepositoryIds(value: unknown, field: string): Array<string> {
  if (!Array.isArray(value)) {
    throw new GithubWebhookError(400, `Invalid ${field} in webhook payload.`)
  }

  return value.map((repository) =>
    readGithubId(readRecord(repository, field).id, `${field}.id`),
  )
}

function parseJson(body: Uint8Array): Record<string, unknown> {
  try {
    return readRecord(JSON.parse(decoder.decode(body)), 'body')
  } catch (error) {
    if (error instanceof GithubWebhookError) throw error
    throw new GithubWebhookError(400, 'Invalid GitHub webhook JSON.')
  }
}

export function parseGithubWebhook(
  event: string,
  body: Uint8Array<ArrayBuffer>,
): GithubWebhookNotification {
  if (event === 'ping') return { type: 'ignored' }

  if (event === 'push') {
    const payload = parseJson(body)
    const repository = readRecord(payload.repository, 'repository')
    const defaultBranch = readString(
      repository.default_branch,
      'repository.default_branch',
    )
    const ref = readString(payload.ref, 'ref', 512)

    // Only the selected repository's default branch is authoritative in v1.
    if (ref !== `refs/heads/${defaultBranch}`) return { type: 'ignored' }

    const headSha = readString(payload.after, 'after', 64)
    if (!GITHUB_SHA_PATTERN.test(headSha)) {
      throw new GithubWebhookError(400, 'Invalid after in webhook payload.')
    }

    return {
      type: 'repository-changed',
      repositoryId: readGithubId(repository.id, 'repository.id'),
      headSha,
    }
  }

  if (event === 'installation') {
    const payload = parseJson(body)
    const installation = readRecord(payload.installation, 'installation')

    return {
      type: 'installation-access-changed',
      event,
      action: readString(payload.action, 'action'),
      installationId: readGithubId(installation.id, 'installation.id'),
      repositoryIdsAdded: [],
      repositoryIdsRemoved: [],
    }
  }

  if (event === 'installation_repositories') {
    const payload = parseJson(body)
    const installation = readRecord(payload.installation, 'installation')

    return {
      type: 'installation-access-changed',
      event,
      action: readString(payload.action, 'action'),
      installationId: readGithubId(installation.id, 'installation.id'),
      repositoryIdsAdded: readRepositoryIds(
        payload.repositories_added,
        'repositories_added',
      ),
      repositoryIdsRemoved: readRepositoryIds(
        payload.repositories_removed,
        'repositories_removed',
      ),
    }
  }

  return { type: 'ignored' }
}

function signatureBytes(
  signatureHeader: string,
): Uint8Array<ArrayBuffer> | null {
  if (!/^sha256=[a-f0-9]{64}$/.test(signatureHeader)) return null

  const result = new Uint8Array(32)
  const hex = signatureHeader.slice('sha256='.length)

  for (let offset = 0; offset < hex.length; offset += 2) {
    result[offset / 2] = Number.parseInt(hex.slice(offset, offset + 2), 16)
  }

  return result
}

/** Web Crypto performs the HMAC comparison without a timing-leaky JS loop. */
export async function verifyGithubWebhookSignature(
  secret: string,
  signatureHeader: string,
  body: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const signature = signatureBytes(signatureHeader)
  if (!signature) return false

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify('HMAC', key, signature, body)
}

export function assertGithubDeliveryId(deliveryId: string): void {
  if (!GITHUB_DELIVERY_PATTERN.test(deliveryId)) {
    throw new GithubWebhookError(400, 'Invalid GitHub delivery id.')
  }
}

/** Buffers the raw signed body, but never more than the explicit webhook cap. */
export async function readBoundedWebhookBody(
  request: Request,
  maximumBytes = MAX_GITHUB_WEBHOOK_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  const lengthHeader = request.headers.get('content-length')
  if (lengthHeader !== null) {
    const contentLength = Number(lengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new GithubWebhookError(400, 'Invalid Content-Length header.')
    }
    if (contentLength > maximumBytes) {
      throw new GithubWebhookError(413, 'GitHub webhook payload is too large.')
    }
  }

  if (request.body === null) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Array<Uint8Array<ArrayBuffer>> = []
  let length = 0

  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      const { value } = chunk

      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel('GitHub webhook payload is too large.')
        throw new GithubWebhookError(
          413,
          'GitHub webhook payload is too large.',
        )
      }

      chunks.push(value)
      chunk = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}
