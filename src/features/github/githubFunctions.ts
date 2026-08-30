import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'

import {
  beginGithubConnectionInputSchema,
  githubCommitInputSchema,
  selectGithubRepositoryInputSchema,
} from './contracts.ts'

import type {
  GithubCommitResult,
  GithubConnectionStatus,
  GithubRepositorySnapshot,
  GithubRepositorySummary,
  GithubResult,
  GithubSelectedRepository,
} from './contracts.ts'

async function result<T>(
  operation: () => Promise<T>,
): Promise<GithubResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    const { publicGithubError } = await import('./server/errors.ts')
    return { ok: false, error: publicGithubError(error) }
  }
}

export const getGithubConnectionStatus = createServerFn({
  method: 'GET',
}).handler(async (): Promise<GithubResult<GithubConnectionStatus>> =>
  result(async () => {
    const { getGithubStatus } = await import('./server/auth.ts')
    return getGithubStatus(getRequest())
  }),
)

export const beginGithubConnection = createServerFn({ method: 'POST' })
  .validator(beginGithubConnectionInputSchema)
  .handler(async ({ data }): Promise<GithubResult<{ authorizeUrl: string }>> =>
    result(async () => {
      const { beginGithubOauth } = await import('./server/auth.ts')
      const begun = await beginGithubOauth(getRequest(), data.returnPath)
      setResponseHeader('set-cookie', begun.setCookie)
      return { authorizeUrl: begun.authorizeUrl }
    }),
  )

export const listGithubRepositories = createServerFn({ method: 'GET' }).handler(
  async (): Promise<
    GithubResult<{
      repositories: GithubRepositorySummary[]
      installUrl: string
    }>
  > =>
    result(async () => {
      const request = getRequest()
      const [
        {
          authenticateServerFunctionRequest,
          githubClientForUser,
          installationUrl,
        },
        { listInstallableRepositories },
        { getGithubRuntime },
      ] = await Promise.all([
        import('./server/auth.ts'),
        import('./server/repository.ts'),
        import('./server/runtime.ts'),
      ])
      const authenticated = await authenticateServerFunctionRequest(request)
      const client = await githubClientForUser(authenticated.user.id)
      const bindings = await getGithubRuntime()
      return {
        repositories: await listInstallableRepositories(client),
        installUrl: installationUrl(bindings),
      }
    }),
)

async function selectedRepositoryContext(): Promise<{
  repository: GithubSelectedRepository
  snapshot: () => Promise<GithubRepositorySnapshot>
}> {
  const [auth, repositoryApi, store, runtime] = await Promise.all([
    import('./server/auth.ts'),
    import('./server/repository.ts'),
    import('./server/store.ts'),
    import('./server/runtime.ts'),
  ])
  const authenticated =
    await auth.authenticateServerFunctionRequest(getRequest())
  if (!authenticated.connection) {
    const { GithubServerError } = await import('./server/errors.ts')
    throw new GithubServerError(
      'repository-not-selected',
      409,
      'Select a GitHub repository first.',
    )
  }
  const client = await auth.githubClientForUser(authenticated.user.id)
  const stored = store.toSelectedRepository(authenticated.connection)
  const repository = await repositoryApi.getAuthorizedRepository(client, stored)
  const bindings = await runtime.getGithubRuntime()
  await store.updateConnection(
    bindings.AUTH_DB,
    authenticated.user.id,
    repository,
    'active',
    Math.floor(Date.now() / 1000),
  )
  return {
    repository,
    snapshot: () => repositoryApi.getRepositorySnapshot(client, repository),
  }
}

export const selectGithubRepository = createServerFn({ method: 'POST' })
  .validator(selectGithubRepositoryInputSchema)
  .handler(
    async ({
      data,
    }): Promise<
      GithubResult<{
        repository: GithubSelectedRepository
        snapshot: GithubRepositorySnapshot
      }>
    > =>
      result(async () => {
        const [auth, repositoryApi, store, runtime] = await Promise.all([
          import('./server/auth.ts'),
          import('./server/repository.ts'),
          import('./server/store.ts'),
          import('./server/runtime.ts'),
        ])
        const authenticated =
          await auth.authenticateServerFunctionRequest(getRequest())
        const client = await auth.githubClientForUser(authenticated.user.id)
        const repositories =
          await repositoryApi.listInstallableRepositories(client)
        const repository = repositories.find(
          (candidate) => candidate.id === data.repositoryId,
        )
        if (!repository) {
          const { GithubServerError } = await import('./server/errors.ts')
          throw new GithubServerError(
            'access-revoked',
            403,
            'That repository is not available to this GitHub App installation.',
          )
        }
        const selected: GithubSelectedRepository = {
          ...repository,
          accessState: 'active',
        }
        const bindings = await runtime.getGithubRuntime()
        await store.putConnection(
          bindings.AUTH_DB,
          authenticated.user.id,
          repository,
          Math.floor(Date.now() / 1000),
        )
        return {
          repository: selected,
          snapshot: await repositoryApi.getRepositorySnapshot(client, selected),
        }
      }),
  )

export const getGithubSnapshot = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GithubResult<GithubRepositorySnapshot>> =>
    result(async () => {
      const context = await selectedRepositoryContext()
      return context.snapshot()
    }),
)

export const commitGithubChanges = createServerFn({ method: 'POST' })
  .validator(githubCommitInputSchema)
  .handler(async ({ data }): Promise<GithubResult<GithubCommitResult>> =>
    result(async () => {
      const [auth, repositoryApi, store] = await Promise.all([
        import('./server/auth.ts'),
        import('./server/repository.ts'),
        import('./server/store.ts'),
      ])
      const authenticated =
        await auth.authenticateServerFunctionRequest(getRequest())
      if (!authenticated.connection) {
        const { GithubServerError } = await import('./server/errors.ts')
        throw new GithubServerError(
          'repository-not-selected',
          409,
          'Select a GitHub repository first.',
        )
      }
      const client = await auth.githubClientForUser(authenticated.user.id)
      const repository = await repositoryApi.getAuthorizedRepository(
        client,
        store.toSelectedRepository(authenticated.connection),
      )
      return repositoryApi.commitRepositoryChanges(client, repository, data)
    }),
  )

export const disconnectGithub = createServerFn({ method: 'POST' }).handler(
  async (): Promise<GithubResult<{ disconnected: true }>> =>
    result(async () => {
      const request = getRequest()
      const [auth, store, runtime, security] = await Promise.all([
        import('./server/auth.ts'),
        import('./server/store.ts'),
        import('./server/runtime.ts'),
        import('./server/security.ts'),
      ])
      const authenticated =
        await auth.authenticateServerFunctionRequest(request)
      const bindings = await runtime.getGithubRuntime()
      await Promise.all([
        store.deleteConnection(bindings.AUTH_DB, authenticated.user.id),
        store.deleteGithubCredentials(bindings.AUTH_DB, authenticated.user.id),
        store.deleteUserSessions(bindings.AUTH_DB, authenticated.user.id),
      ])
      setResponseHeader(
        'set-cookie',
        security.expiredCookie(security.SESSION_COOKIE_NAME),
      )
      return { disconnected: true as const }
    }),
)
