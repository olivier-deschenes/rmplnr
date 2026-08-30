import type {
  GithubErrorCode,
  GithubErrorPayload,
} from '#/features/github/contracts.ts'

export class GithubServerError extends Error {
  readonly code: GithubErrorCode
  readonly status: number
  readonly retryAt?: string
  readonly headSha?: string | null

  constructor(
    code: GithubErrorCode,
    status: number,
    message: string,
    details: { retryAt?: string; headSha?: string | null } = {},
  ) {
    super(message)
    this.name = 'GithubServerError'
    this.code = code
    this.status = status
    this.retryAt = details.retryAt
    this.headSha = details.headSha
  }
}

export function publicGithubError(error: unknown): GithubErrorPayload {
  if (error instanceof GithubServerError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      ...(error.headSha !== undefined ? { headSha: error.headSha } : {}),
    }
  }

  return {
    code: 'github-unavailable',
    message: 'GitHub could not be reached. Your browser copy is unchanged.',
  }
}
