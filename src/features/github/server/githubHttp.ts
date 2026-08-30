import { GITHUB_API_VERSION } from '#/features/github/contracts.ts'

import { GithubServerError } from './errors.ts'

const GITHUB_API_ROOT = 'https://api.github.com'

export class GithubHttpError extends Error {
  readonly status: number
  readonly retryAt?: string

  constructor(status: number, message: string, retryAt?: string) {
    super(message)
    this.name = 'GithubHttpError'
    this.status = status
    this.retryAt = retryAt
  }
}

type GithubTokenProvider = (forceRefresh: boolean) => Promise<string>

function retryAtFrom(headers: Headers): string | undefined {
  const retryAfter = Number(headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return new Date(Date.now() + retryAfter * 1000).toISOString()
  }

  const reset = Number(headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    return new Date(reset * 1000).toISOString()
  }

  return undefined
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    return typeof body.message === 'string' ? body.message : response.statusText
  } catch {
    return response.statusText
  }
}

export class GithubApiClient {
  constructor(
    private readonly getToken: GithubTokenProvider,
    // Bound to the global: `this.fetcher(...)` would otherwise call fetch with
    // the client as its receiver, which workerd rejects as an illegal
    // invocation. Tests still inject their own fetcher here.
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async request<T>(
    path: string,
    init: RequestInit = {},
    allowTokenRefresh = true,
  ): Promise<T> {
    const token = await this.getToken(false)
    let response = await this.fetchWithToken(path, token, init)

    if (response.status === 401 && allowTokenRefresh) {
      const refreshedToken = await this.getToken(true)
      response = await this.fetchWithToken(path, refreshedToken, init)
    }

    if (!response.ok) {
      throw new GithubHttpError(
        response.status,
        await responseMessage(response),
        retryAtFrom(response.headers),
      )
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  private fetchWithToken(
    path: string,
    token: string,
    init: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/vnd.github+json')
    headers.set('authorization', `Bearer ${token}`)
    headers.set('user-agent', 'rmplnr')
    headers.set('x-github-api-version', GITHUB_API_VERSION)
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    return this.fetcher(`${GITHUB_API_ROOT}${path}`, { ...init, headers })
  }
}

export function isGithubRateLimitError(error: unknown): boolean {
  return (
    error instanceof GithubHttpError &&
    (error.status === 429 || error.retryAt !== undefined)
  )
}

export function throwPublicGithubApiError(error: unknown): never {
  if (isGithubRateLimitError(error)) {
    const httpError = error as GithubHttpError
    throw new GithubServerError(
      'rate-limited',
      429,
      'GitHub is temporarily rate limiting requests. Your drafts are safe.',
      { retryAt: httpError.retryAt },
    )
  }

  if (
    error instanceof GithubHttpError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    throw new GithubServerError(
      'access-revoked',
      403,
      'rmplnr no longer has access to this GitHub repository.',
    )
  }

  if (error instanceof GithubServerError) throw error

  throw new GithubServerError(
    'github-unavailable',
    502,
    'GitHub could not complete the request. Your browser copy is unchanged.',
  )
}
