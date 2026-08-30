import { z } from 'zod'

import { ProjectRecordSchema } from '#/lib/planner/types.ts'

import type { Project } from '#/lib/planner/types.ts'

export const GITHUB_API_VERSION = '2026-03-10' as const
export const GITHUB_WORKSPACE_PATH = '.rmplnr/workspace.json' as const
export const GITHUB_PLANS_PATH = '.rmplnr/plans' as const

export const githubRepositoryIdSchema = z
  .union([z.string(), z.number().int().positive()])
  .transform(String)
  .pipe(z.string().regex(/^[1-9]\d*$/))

export const beginGithubConnectionInputSchema = z.object({
  returnPath: z.string().max(500).optional(),
})

export const selectGithubRepositoryInputSchema = z.object({
  repositoryId: githubRepositoryIdSchema,
})

const gitObjectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{40,64}$/i, 'Invalid Git object ID')

export const githubCommitInputSchema = z
  .object({
    baseHeadSha: gitObjectIdSchema.nullable(),
    message: z.string().trim().min(1).max(200),
    writes: z.array(ProjectRecordSchema).max(250),
    deletions: z.array(z.uuid()).max(250),
  })
  .superRefine(({ writes, deletions }, context) => {
    const writeIds = new Set<string>()
    for (const [index, project] of writes.entries()) {
      if (writeIds.has(project.id)) {
        context.addIssue({
          code: 'custom',
          message: 'A plan can only be written once per commit.',
          path: ['writes', index, 'id'],
        })
      }
      writeIds.add(project.id)
    }

    const deletionIds = new Set<string>()
    for (const [index, id] of deletions.entries()) {
      if (deletionIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'A plan can only be deleted once per commit.',
          path: ['deletions', index],
        })
      }
      if (writeIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: 'A plan cannot be written and deleted together.',
          path: ['deletions', index],
        })
      }
      deletionIds.add(id)
    }
  })

export type GithubCommitInput = z.infer<typeof githubCommitInputSchema>

export interface GithubUserSummary {
  id: string
  login: string
  avatarUrl: string
  profileUrl: string
}

export interface GithubRepositorySummary {
  id: string
  installationId: string
  owner: string
  name: string
  fullName: string
  htmlUrl: string
  defaultBranch: string
  isPrivate: boolean
  canPush: boolean
}

export interface GithubSelectedRepository extends GithubRepositorySummary {
  accessState: 'active' | 'unknown' | 'revoked'
}

export type GithubConnectionStatus =
  | {
      status: 'disconnected'
      installUrl: string
    }
  | {
      status: 'connected' | 'access-revoked'
      user: GithubUserSummary
      repository: GithubSelectedRepository | null
      installUrl: string
    }

export interface GithubRemoteProject {
  project: Project
  path: string
  blobSha: string
  contentHash: string
  githubUrl: string
}

export interface GithubInvalidRemoteFile {
  path: string
  blobSha: string
  reason: string
  githubUrl: string
}

export interface GithubRepositorySnapshot {
  repository: GithubSelectedRepository
  headSha: string | null
  workspaceState: 'absent' | 'valid' | 'invalid'
  projects: GithubRemoteProject[]
  invalidFiles: GithubInvalidRemoteFile[]
}

export interface GithubCommitResult {
  headSha: string
  commitUrl: string
  snapshot: GithubRepositorySnapshot
}

export type GithubErrorCode =
  | 'not-connected'
  | 'repository-not-selected'
  | 'forbidden-origin'
  | 'access-revoked'
  | 'rate-limited'
  | 'stale-head'
  | 'protected-branch'
  | 'invalid-remote'
  | 'no-changes'
  | 'github-unavailable'
  | 'configuration-error'

export interface GithubErrorPayload {
  code: GithubErrorCode
  message: string
  retryAt?: string
  headSha?: string | null
}

export type GithubResult<T> =
  { ok: true; data: T } | { ok: false; error: GithubErrorPayload }
