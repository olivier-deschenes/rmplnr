import { z } from 'zod'

import { GITHUB_WORKSPACE_STATE_VERSION } from './types.ts'

import type { GitHubSyncConflict, GitHubWorkspaceState } from './types.ts'

export const GITHUB_WORKSPACE_STORAGE_KEY = 'rmplnr.github.workspace.v1'

type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const contentHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const optionalContentHashSchema = contentHashSchema.optional()
const gitObjectIdSchema = z.string().regex(/^[0-9a-f]{40,64}$/)

const baselineSchema = z.object({
  blobSha: gitObjectIdSchema,
  contentHash: contentHashSchema,
})

const conflictSchema = z.object({
  kind: z.enum([
    'both-added',
    'both-modified',
    'local-modified-remote-deleted',
    'local-deleted-remote-modified',
    'invalid-remote',
  ]),
  projectId: z.uuid().optional(),
  path: z.string().min(1),
  baseContentHash: optionalContentHashSchema,
  localContentHash: optionalContentHashSchema,
  remoteContentHash: optionalContentHashSchema,
  remoteBlobSha: gitObjectIdSchema.optional(),
  error: z.string().min(1).optional(),
})

const workspaceStateSchema = z
  .object({
    schemaVersion: z.literal(GITHUB_WORKSPACE_STATE_VERSION),
    repositoryId: z.string().regex(/^[1-9]\d*$/),
    selectedProjectIds: z.array(z.uuid()),
    baseHeadSha: gitObjectIdSchema.nullable(),
    baseProjects: z.record(z.string(), baselineSchema),
    conflicts: z.array(conflictSchema),
  })
  .superRefine((state, context) => {
    if (
      new Set(state.selectedProjectIds).size !== state.selectedProjectIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Selected plan IDs must be unique',
        path: ['selectedProjectIds'],
      })
    }

    Object.keys(state.baseProjects).forEach((projectId) => {
      if (!z.uuid().safeParse(projectId).success) {
        context.addIssue({
          code: 'custom',
          message: 'Baseline keys must be plan UUIDs',
          path: ['baseProjects', projectId],
        })
      }
    })
  })

export function createGitHubWorkspaceState(
  repositoryId: string,
): GitHubWorkspaceState {
  return {
    schemaVersion: GITHUB_WORKSPACE_STATE_VERSION,
    repositoryId,
    selectedProjectIds: [],
    baseHeadSha: null,
    baseProjects: {},
    conflicts: [],
  }
}

export function readGitHubWorkspaceState(
  storage: WorkspaceStorage | undefined,
): GitHubWorkspaceState | null {
  if (!storage) return null

  try {
    const value: unknown = JSON.parse(
      storage.getItem(GITHUB_WORKSPACE_STORAGE_KEY) ?? 'null',
    )
    const result = workspaceStateSchema.safeParse(value)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function writeGitHubWorkspaceState(
  storage: WorkspaceStorage | undefined,
  state: GitHubWorkspaceState,
): void {
  try {
    storage?.setItem(GITHUB_WORKSPACE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Sync metadata can be rebuilt from GitHub; local plan edits come first.
  }
}

export function clearGitHubWorkspaceState(
  storage: WorkspaceStorage | undefined,
): void {
  try {
    storage?.removeItem(GITHUB_WORKSPACE_STORAGE_KEY)
  } catch {
    // A blocked storage adapter should not make disconnect fail.
  }
}

export function setGitHubProjectSelected(
  state: GitHubWorkspaceState,
  projectId: string,
  selected: boolean,
): GitHubWorkspaceState {
  const selectedIds = new Set(state.selectedProjectIds)
  if (selected) selectedIds.add(projectId)
  else selectedIds.delete(projectId)

  return {
    ...state,
    selectedProjectIds: [...selectedIds],
  }
}

export function hasGitHubSyncConflict(
  state: Pick<GitHubWorkspaceState, 'conflicts'>,
): boolean {
  return state.conflicts.length > 0
}

export function withGitHubSyncConflicts(
  state: GitHubWorkspaceState,
  conflicts: GitHubSyncConflict[],
): GitHubWorkspaceState {
  return { ...state, conflicts: [...conflicts] }
}
