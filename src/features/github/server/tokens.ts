import { z } from 'zod'

import { decryptSecret, encryptSecret } from './crypto.ts'
import { GithubServerError } from './errors.ts'
import type { GithubRuntimeBindings } from './runtime.ts'
import {
  deleteGithubCredentials,
  getGithubCredentials,
  putGithubCredentials,
  replaceGithubCredentials,
  setConnectionAccessState,
} from './store.ts'
import type { GithubCredentialRow } from './store.ts'

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1).default('bearer'),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
})

export type GithubTokenResponse = z.infer<typeof tokenResponseSchema>

function tokenBody(bindings: GithubRuntimeBindings): URLSearchParams {
  return new URLSearchParams({
    client_id: bindings.GITHUB_CLIENT_ID,
    client_secret: bindings.GITHUB_CLIENT_SECRET,
  })
}

const tokenErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
})

function describeTokenError(raw: unknown): string {
  const parsed = tokenErrorSchema.safeParse(raw)
  if (!parsed.success) return 'unrecognized token response shape'
  return parsed.data.error_description
    ? `${parsed.data.error}: ${parsed.data.error_description}`
    : parsed.data.error
}

async function requestToken(
  body: URLSearchParams,
): Promise<GithubTokenResponse> {
  let response: Response
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'rmplnr',
      },
      body,
    })
  } catch {
    throw new GithubServerError(
      'github-unavailable',
      502,
      'GitHub could not finish connecting. Please try again.',
    )
  }

  if (!response.ok) {
    console.error('github token endpoint returned an error status', {
      status: response.status,
    })
    const transient = response.status === 429 || response.status >= 500
    throw new GithubServerError(
      transient ? 'github-unavailable' : 'access-revoked',
      transient ? 502 : 401,
      transient
        ? 'GitHub could not finish connecting. Please try again.'
        : 'GitHub authorization is no longer valid. Please reconnect.',
    )
  }

  const raw = (await response.json()) as unknown
  const parsed = tokenResponseSchema.safeParse(raw)
  if (!parsed.success) {
    // GitHub answers a rejected exchange with 200 and an `error` body, so this
    // is the only place the real reason is ever visible. Log it without the
    // token fields so a failed connect is diagnosable from the Worker logs.
    console.error('github token endpoint rejected the exchange', {
      error: describeTokenError(raw),
    })
    throw new GithubServerError(
      'access-revoked',
      401,
      'GitHub authorization is no longer valid. Please reconnect.',
    )
  }
  return parsed.data
}

export async function exchangeAuthorizationCode(
  bindings: GithubRuntimeBindings,
  input: { code: string; verifier: string; redirectUri: string },
): Promise<GithubTokenResponse> {
  const body = tokenBody(bindings)
  body.set('code', input.code)
  body.set('code_verifier', input.verifier)
  body.set('redirect_uri', input.redirectUri)
  return requestToken(body)
}

async function encryptedCredentialRow(
  bindings: GithubRuntimeBindings,
  userId: string,
  token: GithubTokenResponse,
  now: number,
): Promise<GithubCredentialRow> {
  return {
    user_id: userId,
    access_token_cipher: await encryptSecret(
      token.access_token,
      bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
      `github-access:${userId}`,
    ),
    refresh_token_cipher: token.refresh_token
      ? await encryptSecret(
          token.refresh_token,
          bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
          `github-refresh:${userId}`,
        )
      : null,
    access_token_expires_at: token.expires_in ? now + token.expires_in : null,
    refresh_token_expires_at: token.refresh_token_expires_in
      ? now + token.refresh_token_expires_in
      : null,
    token_type: token.token_type,
    updated_at: now,
  }
}

export async function storeGithubTokenSet(
  bindings: GithubRuntimeBindings,
  userId: string,
  token: GithubTokenResponse,
  now: number,
): Promise<void> {
  await putGithubCredentials(
    bindings.AUTH_DB,
    await encryptedCredentialRow(bindings, userId, token, now),
  )
}

async function markCredentialsRevoked(
  bindings: GithubRuntimeBindings,
  userId: string,
  now: number,
): Promise<never> {
  await Promise.all([
    deleteGithubCredentials(bindings.AUTH_DB, userId),
    setConnectionAccessState(bindings.AUTH_DB, userId, 'revoked', now),
  ])
  throw new GithubServerError(
    'access-revoked',
    401,
    'GitHub authorization expired or was revoked. Please reconnect.',
  )
}

async function refreshAccessToken(
  bindings: GithubRuntimeBindings,
  userId: string,
  current: GithubCredentialRow,
  now: number,
): Promise<string> {
  if (
    !current.refresh_token_cipher ||
    (current.refresh_token_expires_at !== null &&
      current.refresh_token_expires_at <= now)
  ) {
    return markCredentialsRevoked(bindings, userId, now)
  }

  const refreshToken = await decryptSecret(
    current.refresh_token_cipher,
    bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
    `github-refresh:${userId}`,
  )
  const body = tokenBody(bindings)
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', refreshToken)

  let refreshed: GithubTokenResponse
  try {
    refreshed = await requestToken(body)
  } catch (error) {
    const newest = await getGithubCredentials(bindings.AUTH_DB, userId)
    if (
      newest &&
      newest.refresh_token_cipher !== current.refresh_token_cipher &&
      (newest.access_token_expires_at === null ||
        newest.access_token_expires_at > now)
    ) {
      return decryptSecret(
        newest.access_token_cipher,
        bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
        `github-access:${userId}`,
      )
    }
    if (
      error instanceof GithubServerError &&
      error.code === 'github-unavailable'
    ) {
      throw error
    }
    return markCredentialsRevoked(bindings, userId, now)
  }

  const next = await encryptedCredentialRow(bindings, userId, refreshed, now)
  const replaced = await replaceGithubCredentials(
    bindings.AUTH_DB,
    current.refresh_token_cipher,
    next,
  )
  const saved = replaced
    ? next
    : await getGithubCredentials(bindings.AUTH_DB, userId)
  if (!saved) return markCredentialsRevoked(bindings, userId, now)

  return decryptSecret(
    saved.access_token_cipher,
    bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
    `github-access:${userId}`,
  )
}

export async function getUserAccessToken(
  bindings: GithubRuntimeBindings,
  userId: string,
  forceRefresh = false,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const credentials = await getGithubCredentials(bindings.AUTH_DB, userId)
  if (!credentials) {
    throw new GithubServerError(
      'access-revoked',
      401,
      'GitHub is disconnected. Please reconnect.',
    )
  }

  const isFresh =
    credentials.access_token_expires_at === null ||
    credentials.access_token_expires_at > now + 300
  if (!forceRefresh && isFresh) {
    return decryptSecret(
      credentials.access_token_cipher,
      bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
      `github-access:${userId}`,
    )
  }

  return refreshAccessToken(bindings, userId, credentials, now)
}
