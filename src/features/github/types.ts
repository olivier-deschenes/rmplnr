import type { Project } from '#/lib/planner/types.ts'

export const GITHUB_WORKSPACE_STATE_VERSION = 1 as const
export const GITHUB_PLAN_DIRECTORY = '.rmplnr/plans'

export interface GitHubProjectBaseline {
  /** The Git blob SHA at the last accepted repository head. */
  blobSha: string
  /** SHA-256 of the parsed plan's canonical JSON. */
  contentHash: string
}

export type GitHubSyncConflictKind =
  | 'both-added'
  | 'both-modified'
  | 'local-modified-remote-deleted'
  | 'local-deleted-remote-modified'
  | 'invalid-remote'

export interface GitHubSyncConflict {
  kind: GitHubSyncConflictKind
  /** Missing only when an invalid managed file has no usable plan ID. */
  projectId?: string
  path: string
  baseContentHash?: string
  localContentHash?: string
  remoteContentHash?: string
  remoteBlobSha?: string
  error?: string
}

/** Browser-only metadata. Plan contents remain in the planner library. */
export interface GitHubWorkspaceState {
  schemaVersion: typeof GITHUB_WORKSPACE_STATE_VERSION
  repositoryId: string
  selectedProjectIds: string[]
  baseHeadSha: string | null
  baseProjects: Partial<Record<string, GitHubProjectBaseline>>
  conflicts: GitHubSyncConflict[]
}

export interface GitHubRemoteFileInput {
  path: string
  blobSha: string
  contents: string
}

export interface GitHubInvalidRemoteFile {
  path: string
  blobSha: string
  projectId?: string
  error: string
}

export interface GitHubRemoteProject extends GitHubProjectBaseline {
  path: string
  project: Project
}

export interface GitHubRemoteSnapshot {
  headSha: string | null
  projects: Partial<Record<string, GitHubRemoteProject>>
  invalidFiles: GitHubInvalidRemoteFile[]
}

export interface GitHubWorkspaceChanges {
  added: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
  changeCount: number
  hasChanges: boolean
  blockedByConflicts: boolean
  canCommit: boolean
}

export interface GitHubReconciliationChanges {
  additions: string[]
  updates: string[]
  links: string[]
  /** These browser plans are kept and become local-only when applied. */
  remoteDeletions: string[]
  converged: string[]
}

/**
 * A pure review result. Nothing reaches browser storage until a caller applies
 * `projectUpserts` and persists `nextState` after user confirmation.
 */
export interface GitHubReconciliationPlan {
  headSha: string | null
  changes: GitHubReconciliationChanges
  projectUpserts: Project[]
  conflicts: GitHubSyncConflict[]
  invalidFiles: GitHubInvalidRemoteFile[]
  nextState: GitHubWorkspaceState
  hasRemoteChanges: boolean
  canCommitAfterApply: boolean
}

export function getGitHubProjectPath(projectId: string): string {
  return `${GITHUB_PLAN_DIRECTORY}/${projectId}.json`
}
