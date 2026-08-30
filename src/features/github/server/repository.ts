import { z } from 'zod'

import {
  fromProjectRecord,
  serializeProjectRecord,
} from '#/lib/planner/planSerialization.ts'
import { ProjectRecordSchema } from '#/lib/planner/types.ts'

import {
  GITHUB_PLANS_PATH,
  GITHUB_WORKSPACE_PATH,
} from '#/features/github/contracts.ts'
import { hashProject } from '#/features/github/hash.ts'

import { GithubServerError } from './errors.ts'
import {
  GithubHttpError,
  isGithubRateLimitError,
  throwPublicGithubApiError,
} from './githubHttp.ts'

import type {
  GithubCommitInput,
  GithubCommitResult,
  GithubInvalidRemoteFile,
  GithubRemoteProject,
  GithubRepositorySnapshot,
  GithubRepositorySummary,
  GithubSelectedRepository,
} from '#/features/github/contracts.ts'
import type { GithubApiClient } from './githubHttp.ts'

const MAXIMUM_PLAN_BYTES = 1_000_000
const MAXIMUM_MANAGED_FILES = 1_000

/** The directory rmplnr owns in a repository. Nothing outside it is touched. */
const MANAGED_ROOT = '.rmplnr'

export type GithubRequestClient = Pick<GithubApiClient, 'request'>

const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    application: z.literal('rmplnr'),
    plansPath: z.literal(GITHUB_PLANS_PATH),
  })
  .strict()

export const GITHUB_WORKSPACE_CONTENTS = `${JSON.stringify(
  {
    schemaVersion: 1,
    application: 'rmplnr',
    plansPath: GITHUB_PLANS_PATH,
  },
  null,
  2,
)}\n`

interface GithubInstallationResponse {
  id: number | string
}

interface GithubInstallationsResponse {
  installations: GithubInstallationResponse[]
}

interface GithubRepositoryResponse {
  id: number | string
  name: string
  full_name: string
  html_url: string
  default_branch: string
  private: boolean
  owner: { login: string }
  permissions?: { push?: boolean }
}

interface GithubRepositoriesResponse {
  repositories: GithubRepositoryResponse[]
}

interface GithubRefResponse {
  object: { sha: string }
}

interface GithubCommitResponse {
  sha: string
  tree: { sha: string }
}

interface GithubTreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

interface GithubTreeResponse {
  sha: string
  tree: GithubTreeEntry[]
  truncated?: boolean
}

interface GithubBlobResponse {
  sha: string
  content: string
  encoding: string
  size: number
}

interface GithubCreatedObject {
  sha: string
}

interface GithubContentsCommitResponse {
  commit: { sha: string }
}

function repositoryPath(owner: string, name: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

function branchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/')
}

function planPath(projectId: string): string {
  return `${GITHUB_PLANS_PATH}/${projectId}.json`
}

function githubFileUrl(
  repository: GithubSelectedRepository,
  path: string,
): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${repository.htmlUrl}/blob/${branchPath(repository.defaultBranch)}/${encodedPath}`
}

function repositorySummary(
  repository: GithubRepositoryResponse,
  installationId: string,
): GithubRepositorySummary {
  return {
    id: String(repository.id),
    installationId,
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    defaultBranch: repository.default_branch,
    isPrivate: repository.private,
    canPush: repository.permissions?.push === true,
  }
}

function decodeBase64Utf8(value: string): string {
  const compact = value.replace(/\s/g, '')
  const bytes = Uint8Array.from(atob(compact), (character) =>
    character.charCodeAt(0),
  )
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function pages<T>(
  load: (page: number) => Promise<T[]>,
  maximumPages = 10,
): Promise<T[]> {
  const values: T[] = []
  for (let page = 1; page <= maximumPages; page += 1) {
    const next = await load(page)
    values.push(...next)
    if (next.length < 100) return values
  }
  return values
}

export async function listInstallableRepositories(
  client: GithubRequestClient,
): Promise<GithubRepositorySummary[]> {
  try {
    const installations = await pages(async (page) => {
      const response = await client.request<GithubInstallationsResponse>(
        `/user/installations?per_page=100&page=${page}`,
      )
      return response.installations
    })

    const repositories = (
      await Promise.all(
        installations.map(async (installation) => {
          const installationId = String(installation.id)
          return pages(async (page) => {
            const response = await client.request<GithubRepositoriesResponse>(
              `/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`,
            )
            return response.repositories.map((repository) =>
              repositorySummary(repository, installationId),
            )
          })
        }),
      )
    ).flat()

    return [
      ...new Map(repositories.map((repo) => [repo.id, repo])).values(),
    ].sort((left, right) => left.fullName.localeCompare(right.fullName))
  } catch (error) {
    throwPublicGithubApiError(error)
  }
}

export async function getAuthorizedRepository(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
): Promise<GithubSelectedRepository> {
  try {
    const response = await client.request<GithubRepositoryResponse>(
      repositoryPath(repository.owner, repository.name),
    )
    if (String(response.id) !== repository.id) {
      throw new GithubServerError(
        'access-revoked',
        403,
        'The selected GitHub repository is no longer available.',
      )
    }
    return {
      ...repositorySummary(response, repository.installationId),
      accessState: 'active',
    }
  } catch (error) {
    throwPublicGithubApiError(error)
  }
}

async function repositoryHead(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
): Promise<string | null> {
  try {
    const response = await client.request<GithubRefResponse>(
      `${repositoryPath(repository.owner, repository.name)}/git/ref/heads/${branchPath(repository.defaultBranch)}`,
    )
    return response.object.sha
  } catch (error) {
    if (error instanceof GithubHttpError && error.status === 409) return null
    throwPublicGithubApiError(error)
  }
}

async function loadTree(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
  sha: string,
): Promise<GithubTreeResponse> {
  const tree = await client.request<GithubTreeResponse>(
    `${repositoryPath(repository.owner, repository.name)}/git/trees/${encodeURIComponent(sha)}`,
  )
  if (tree.truncated) {
    throw new GithubServerError(
      'invalid-remote',
      409,
      'GitHub returned an incomplete repository tree. No local data was changed.',
    )
  }
  return tree
}

async function managedTrees(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
  rootTreeSha: string,
): Promise<{
  workspace?: GithubTreeEntry
  planEntries: GithubTreeEntry[]
  invalidManagedRoot?: GithubTreeEntry
  invalidPlanDirectory?: GithubTreeEntry
}> {
  const root = await loadTree(client, repository, rootTreeSha)
  const managed = root.tree.find((entry) => entry.path === MANAGED_ROOT)
  if (!managed) return { planEntries: [] }
  if (managed.type !== 'tree') {
    return { planEntries: [], invalidManagedRoot: managed }
  }

  const managedTree = await loadTree(client, repository, managed.sha)
  const workspace = managedTree.tree.find(
    (entry) => entry.path === 'workspace.json',
  )
  const plans = managedTree.tree.find((entry) => entry.path === 'plans')
  if (!plans) return { workspace, planEntries: [] }
  if (plans.type !== 'tree') {
    return { workspace, planEntries: [], invalidPlanDirectory: plans }
  }

  const planTree = await loadTree(client, repository, plans.sha)
  return { workspace, planEntries: planTree.tree }
}

async function loadBlob(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
  entry: GithubTreeEntry,
): Promise<{ contents: string; blobSha: string }> {
  if (
    entry.type !== 'blob' ||
    (entry.size !== undefined && entry.size > MAXIMUM_PLAN_BYTES)
  ) {
    throw new Error('Managed plan files must be JSON blobs under 1 MB.')
  }
  const blob = await client.request<GithubBlobResponse>(
    `${repositoryPath(repository.owner, repository.name)}/git/blobs/${encodeURIComponent(entry.sha)}`,
  )
  if (blob.encoding !== 'base64' || blob.size > MAXIMUM_PLAN_BYTES) {
    throw new Error('Managed plan files must be base64 JSON under 1 MB.')
  }
  return { contents: decodeBase64Utf8(blob.content), blobSha: blob.sha }
}

export async function getRepositorySnapshot(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
): Promise<GithubRepositorySnapshot> {
  try {
    const headSha = await repositoryHead(client, repository)
    if (headSha === null) {
      return {
        repository,
        headSha: null,
        workspaceState: 'absent',
        projects: [],
        invalidFiles: [],
      }
    }

    const commit = await client.request<GithubCommitResponse>(
      `${repositoryPath(repository.owner, repository.name)}/git/commits/${encodeURIComponent(headSha)}`,
    )
    const { workspace, planEntries, invalidManagedRoot, invalidPlanDirectory } =
      await managedTrees(client, repository, commit.tree.sha)
    const invalidFiles: GithubInvalidRemoteFile[] = []
    let workspaceState: GithubRepositorySnapshot['workspaceState'] = 'absent'

    if (invalidManagedRoot) {
      workspaceState = 'invalid'
      invalidFiles.push({
        path: MANAGED_ROOT,
        blobSha: invalidManagedRoot.sha,
        reason: `${MANAGED_ROOT} must be a directory managed by rmplnr.`,
        githubUrl: githubFileUrl(repository, MANAGED_ROOT),
      })
    }

    if (workspace) {
      try {
        const loaded = await loadBlob(client, repository, workspace)
        workspaceState = workspaceSchema.safeParse(
          JSON.parse(loaded.contents) as unknown,
        ).success
          ? 'valid'
          : 'invalid'
      } catch {
        workspaceState = 'invalid'
      }
      if (workspaceState === 'invalid') {
        invalidFiles.push({
          path: GITHUB_WORKSPACE_PATH,
          blobSha: workspace.sha,
          reason: 'The rmplnr workspace marker is invalid.',
          githubUrl: githubFileUrl(repository, GITHUB_WORKSPACE_PATH),
        })
      }
    }

    if (invalidPlanDirectory) {
      invalidFiles.push({
        path: GITHUB_PLANS_PATH,
        blobSha: invalidPlanDirectory.sha,
        reason: 'The managed plans path must be a directory.',
        githubUrl: githubFileUrl(repository, GITHUB_PLANS_PATH),
      })
    }

    if (planEntries.length > MAXIMUM_MANAGED_FILES) {
      throw new GithubServerError(
        'invalid-remote',
        409,
        'This repository contains too many managed plan files.',
      )
    }

    const projects: GithubRemoteProject[] = []
    for (const entry of planEntries) {
      const path = `${GITHUB_PLANS_PATH}/${entry.path}`
      const githubUrl = githubFileUrl(repository, path)
      const expectedId = entry.path.endsWith('.json')
        ? entry.path.slice(0, -'.json'.length)
        : undefined

      try {
        if (!expectedId || !z.uuid().safeParse(expectedId).success) {
          throw new Error(
            'Managed plan filenames must be UUIDs ending in .json.',
          )
        }
        const loaded = await loadBlob(client, repository, entry)
        const parsed: unknown = JSON.parse(loaded.contents)
        const project = fromProjectRecord(ProjectRecordSchema.parse(parsed))
        if (project.id !== expectedId) {
          throw new Error('The plan ID does not match its filename.')
        }
        projects.push({
          project,
          path,
          blobSha: loaded.blobSha,
          contentHash: await hashProject(project),
          githubUrl,
        })
      } catch (error) {
        invalidFiles.push({
          path,
          blobSha: entry.sha,
          reason: error instanceof Error ? error.message : 'Invalid plan JSON.',
          githubUrl,
        })
      }
    }

    return {
      repository,
      headSha,
      workspaceState,
      projects,
      invalidFiles,
    }
  } catch (error) {
    if (error instanceof GithubServerError) throw error
    throwPublicGithubApiError(error)
  }
}

function protectedBranchError(): GithubServerError {
  return new GithubServerError(
    'protected-branch',
    409,
    'GitHub rejected a direct commit on this branch. Your plans are unchanged.',
  )
}

function throwWriteError(error: unknown): never {
  if (isGithubRateLimitError(error)) throwPublicGithubApiError(error)
  if (error instanceof GithubHttpError) {
    if (error.status === 409) {
      throw new GithubServerError(
        'stale-head',
        409,
        'The repository changed before the commit finished. Review it and try again.',
      )
    }
    if (error.status === 403 || error.status === 422) {
      throw protectedBranchError()
    }
  }
  throwPublicGithubApiError(error)
}

async function initializeEmptyRepository(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
): Promise<string> {
  try {
    const response = await client.request<GithubContentsCommitResponse>(
      `${repositoryPath(repository.owner, repository.name)}/contents/${GITHUB_WORKSPACE_PATH}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Initialize rmplnr workspace',
          content: encodeBase64Utf8(GITHUB_WORKSPACE_CONTENTS),
        }),
      },
    )
    return response.commit.sha
  } catch (error) {
    if (
      error instanceof GithubHttpError &&
      (error.status === 409 || error.status === 422)
    ) {
      const current = await repositoryHead(client, repository)
      if (current !== null) {
        throw new GithubServerError(
          'stale-head',
          409,
          'GitHub initialized this repository first. Review it and try again.',
          { headSha: current },
        )
      }
    }
    throwWriteError(error)
  }
}

async function assertHead(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
  expected: string,
): Promise<void> {
  const current = await repositoryHead(client, repository)
  if (current !== expected) {
    throw new GithubServerError(
      'stale-head',
      409,
      'GitHub has newer changes. Review them before committing.',
      { headSha: current },
    )
  }
}

export async function commitRepositoryChanges(
  client: GithubRequestClient,
  repository: GithubSelectedRepository,
  input: GithubCommitInput,
): Promise<GithubCommitResult> {
  if (!repository.canPush) throw protectedBranchError()
  if (input.writes.length === 0 && input.deletions.length === 0) {
    throw new GithubServerError(
      'no-changes',
      400,
      'There are no changes to commit.',
    )
  }

  let headSha = await repositoryHead(client, repository)
  if (headSha !== input.baseHeadSha) {
    throw new GithubServerError(
      'stale-head',
      409,
      'GitHub has newer changes. Review them before committing.',
      { headSha },
    )
  }

  if (headSha === null) {
    if (input.writes.length === 0) {
      throw new GithubServerError(
        'no-changes',
        400,
        'There are no files to add.',
      )
    }
    headSha = await initializeEmptyRepository(client, repository)
  }

  try {
    const parent = await client.request<GithubCommitResponse>(
      `${repositoryPath(repository.owner, repository.name)}/git/commits/${encodeURIComponent(headSha)}`,
    )
    const snapshot = await getRepositorySnapshot(client, repository)
    if (snapshot.headSha !== headSha) {
      throw new GithubServerError(
        'stale-head',
        409,
        'GitHub has newer changes. Review them before committing.',
        { headSha: snapshot.headSha },
      )
    }
    if (
      snapshot.workspaceState === 'invalid' ||
      snapshot.invalidFiles.length > 0
    ) {
      throw new GithubServerError(
        'invalid-remote',
        409,
        'Resolve invalid managed files on GitHub before committing.',
      )
    }

    const treeEntries: Array<Record<string, unknown>> = []
    if (snapshot.workspaceState === 'absent') {
      const workspaceBlob = await client.request<GithubCreatedObject>(
        `${repositoryPath(repository.owner, repository.name)}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: GITHUB_WORKSPACE_CONTENTS,
            encoding: 'utf-8',
          }),
        },
      )
      treeEntries.push({
        path: GITHUB_WORKSPACE_PATH,
        mode: '100644',
        type: 'blob',
        sha: workspaceBlob.sha,
      })
    }

    for (const record of input.writes) {
      const contents = serializeProjectRecord(record)
      if (new TextEncoder().encode(contents).byteLength > MAXIMUM_PLAN_BYTES) {
        throw new GithubServerError(
          'invalid-remote',
          413,
          `“${record.name}” is too large to commit.`,
        )
      }
      const blob = await client.request<GithubCreatedObject>(
        `${repositoryPath(repository.owner, repository.name)}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({ content: contents, encoding: 'utf-8' }),
        },
      )
      treeEntries.push({
        path: planPath(record.id),
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      })
    }

    for (const projectId of input.deletions) {
      treeEntries.push({
        path: planPath(projectId),
        mode: '100644',
        type: 'blob',
        sha: null,
      })
    }

    const tree = await client.request<GithubCreatedObject>(
      `${repositoryPath(repository.owner, repository.name)}/git/trees`,
      {
        method: 'POST',
        body: JSON.stringify({ base_tree: parent.tree.sha, tree: treeEntries }),
      },
    )
    if (tree.sha === parent.tree.sha) {
      throw new GithubServerError(
        'no-changes',
        400,
        'GitHub already has these changes.',
      )
    }

    const commit = await client.request<GithubCreatedObject>(
      `${repositoryPath(repository.owner, repository.name)}/git/commits`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: input.message,
          tree: tree.sha,
          parents: [headSha],
        }),
      },
    )

    await assertHead(client, repository, headSha)
    try {
      await client.request<unknown>(
        `${repositoryPath(repository.owner, repository.name)}/git/refs/heads/${branchPath(repository.defaultBranch)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: false }),
        },
      )
    } catch (error) {
      if (
        error instanceof GithubHttpError &&
        (error.status === 409 || error.status === 422)
      ) {
        const current = await repositoryHead(client, repository)
        if (current !== headSha) {
          throw new GithubServerError(
            'stale-head',
            409,
            'The repository changed before the commit finished. Review it and try again.',
            { headSha: current },
          )
        }
      }
      throw error
    }

    const nextSnapshot = await getRepositorySnapshot(client, repository)
    if (nextSnapshot.headSha !== commit.sha) {
      throw new GithubServerError(
        'stale-head',
        409,
        'The repository changed immediately after this commit. Review it before continuing.',
        { headSha: nextSnapshot.headSha },
      )
    }
    return {
      headSha: commit.sha,
      commitUrl: `${repository.htmlUrl}/commit/${commit.sha}`,
      snapshot: nextSnapshot,
    }
  } catch (error) {
    if (error instanceof GithubServerError) throw error
    throwWriteError(error)
  }
}
