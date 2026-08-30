export type D1Value = string | number | ArrayBuffer | null

export interface D1RunResult {
  success: boolean
  meta: {
    changes?: number
  }
}

export interface D1Result<T> extends D1RunResult {
  results: T[]
}

export interface D1PreparedStatement {
  bind: (...values: D1Value[]) => D1PreparedStatement
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<D1Result<T>>
  run: () => Promise<D1RunResult>
}

export interface D1Database {
  prepare: (query: string) => D1PreparedStatement
  batch: (statements: D1PreparedStatement[]) => Promise<D1RunResult[]>
}

export interface GithubRuntimeBindings {
  AUTH_DB: D1Database
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GITHUB_APP_SLUG: string
  GITHUB_TOKEN_ENCRYPTION_KEY: string
  GITHUB_CALLBACK_URL?: string
}

export async function getGithubRuntime(): Promise<GithubRuntimeBindings> {
  const { env } = await import('cloudflare:workers')
  return env as unknown as GithubRuntimeBindings
}
