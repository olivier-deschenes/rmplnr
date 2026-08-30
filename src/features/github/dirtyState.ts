import { hashProjects } from './hash.ts'

import type { GitHubWorkspaceChanges, GitHubWorkspaceState } from './types.ts'
import type { Project } from '#/lib/planner/types.ts'

export function deriveGitHubWorkspaceChangesFromHashes(
  state: GitHubWorkspaceState,
  localContentHashes: Readonly<Partial<Record<string, string>>>,
): GitHubWorkspaceChanges {
  const selected = new Set(state.selectedProjectIds)
  const added: string[] = []
  const updated: string[] = []
  const deleted: string[] = []
  const unchanged: string[] = []

  for (const projectId of selected) {
    const localHash = localContentHashes[projectId]
    const baseline = state.baseProjects[projectId]

    if (!localHash) {
      if (baseline) deleted.push(projectId)
      continue
    }

    if (!baseline) added.push(projectId)
    else if (localHash !== baseline.contentHash) updated.push(projectId)
    else unchanged.push(projectId)
  }

  for (const projectId of Object.keys(state.baseProjects)) {
    if (!selected.has(projectId)) deleted.push(projectId)
  }

  added.sort()
  updated.sort()
  deleted.sort()
  unchanged.sort()

  const changeCount = added.length + updated.length + deleted.length
  const blockedByConflicts = state.conflicts.length > 0

  return {
    added,
    updated,
    deleted,
    unchanged,
    changeCount,
    hasChanges: changeCount > 0,
    blockedByConflicts,
    canCommit: changeCount > 0 && !blockedByConflicts,
  }
}

export async function deriveGitHubWorkspaceChanges(
  state: GitHubWorkspaceState,
  projects: Iterable<Project>,
): Promise<GitHubWorkspaceChanges> {
  return deriveGitHubWorkspaceChangesFromHashes(
    state,
    await hashProjects(projects),
  )
}
