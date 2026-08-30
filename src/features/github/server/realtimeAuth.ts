import { GithubServerError } from './errors.ts'
import { GithubHttpError, throwPublicGithubApiError } from './githubHttp.ts'
import { authenticateRequest, githubClientForUser } from './auth.ts'
import { getGithubRuntime } from './runtime.ts'
import {
  connectionsForInstallation,
  isRepositorySelected,
  setConnectionAccessState,
  updateConnection,
} from './store.ts'

interface GithubRepositoryApiResponse {
  id: number | string
  name: string
  full_name: string
  html_url: string
  default_branch: string
  private: boolean
  owner: { login: string }
  permissions?: { push?: boolean }
}

export async function requireSelectedGithubConnection(
  request: Request,
): Promise<{
  userId: string
  repositoryId: string
  sessionExpiresAt: number
}> {
  const authenticated = await authenticateRequest(request)
  const connection = authenticated.connection
  if (!connection) {
    throw new GithubServerError(
      'repository-not-selected',
      409,
      'Select a GitHub repository first.',
    )
  }

  try {
    const client = await githubClientForUser(authenticated.user.id)
    const repository = await client.request<GithubRepositoryApiResponse>(
      `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.name)}`,
    )
    if (String(repository.id) !== connection.repository_id) {
      throw new GithubServerError(
        'access-revoked',
        403,
        'The selected GitHub repository is no longer available.',
      )
    }

    const bindings = await getGithubRuntime()
    await updateConnection(
      bindings.AUTH_DB,
      authenticated.user.id,
      {
        id: String(repository.id),
        installationId: connection.installation_id,
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        htmlUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        isPrivate: repository.private,
        canPush: repository.permissions?.push === true,
      },
      'active',
      Math.floor(Date.now() / 1000),
    )
  } catch (error) {
    if (
      error instanceof GithubHttpError &&
      (error.status === 403 || error.status === 404)
    ) {
      const bindings = await getGithubRuntime()
      await setConnectionAccessState(
        bindings.AUTH_DB,
        authenticated.user.id,
        'revoked',
        Math.floor(Date.now() / 1000),
      )
    }
    throwPublicGithubApiError(error)
  }

  return {
    userId: authenticated.user.id,
    repositoryId: connection.repository_id,
    sessionExpiresAt: authenticated.session.expires_at * 1000,
  }
}

export async function isGithubRepositorySelected(
  repositoryId: string,
): Promise<boolean> {
  const bindings = await getGithubRuntime()
  return isRepositorySelected(bindings.AUTH_DB, repositoryId)
}

export async function applyGithubInstallationAccessEvent(input: {
  event: 'installation' | 'installation_repositories'
  action: string
  installationId: string
  repositoryIdsAdded: string[]
  repositoryIdsRemoved: string[]
}): Promise<string[]> {
  const bindings = await getGithubRuntime()
  const connections = await connectionsForInstallation(
    bindings.AUTH_DB,
    input.installationId,
  )
  const added = new Set(input.repositoryIdsAdded)
  const removed = new Set(input.repositoryIdsRemoved)
  const now = Math.floor(Date.now() / 1000)
  const affected: string[] = []

  for (const connection of connections) {
    let state: 'unknown' | 'revoked' | null = null
    if (input.event === 'installation') {
      state = ['deleted', 'suspend'].includes(input.action)
        ? 'revoked'
        : 'unknown'
    } else if (removed.has(connection.repository_id)) {
      state = 'revoked'
    } else if (added.has(connection.repository_id)) {
      state = 'unknown'
    }

    if (!state) continue
    await setConnectionAccessState(
      bindings.AUTH_DB,
      connection.user_id,
      state,
      now,
    )
    affected.push(connection.repository_id)
  }

  return [...new Set(affected)]
}

export { assertAllowedOrigin } from './security.ts'
export { GithubServerError }
