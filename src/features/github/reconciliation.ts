import { hashProjects } from './hash.ts'
import { getGitHubProjectPath } from './types.ts'

import type {
  GitHubConflictResolution,
  GitHubProjectBaseline,
  GitHubReconciliationChanges,
  GitHubReconciliationPlan,
  GitHubRemoteProject,
  GitHubRemoteSnapshot,
  GitHubSyncConflict,
  GitHubWorkspaceState,
} from './types.ts'
import type { Project } from '#/lib/planner/types.ts'

function baselineFromRemote(
  remote: GitHubRemoteProject,
): GitHubProjectBaseline {
  return {
    blobSha: remote.blobSha,
    contentHash: remote.contentHash,
  }
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function createConflict(conflict: GitHubSyncConflict): GitHubSyncConflict {
  return conflict
}

/**
 * Builds the review shown before remote data is accepted. The input state and
 * plans are never mutated.
 */
export async function planGitHubReconciliation(
  state: GitHubWorkspaceState,
  localProjects: Iterable<Project>,
  remoteSnapshot: GitHubRemoteSnapshot,
): Promise<GitHubReconciliationPlan> {
  const localProjectList = [...localProjects]
  const localById = new Map(
    localProjectList.map((project) => [project.id, project]),
  )
  const localHashes = await hashProjects(localProjectList)
  const selectedIds = new Set(state.selectedProjectIds)
  const nextBaseProjects = { ...state.baseProjects }
  const projectUpserts: Project[] = []
  const conflicts: GitHubSyncConflict[] = []
  const changes: GitHubReconciliationChanges = {
    additions: [],
    updates: [],
    links: [],
    remoteDeletions: [],
    converged: [],
  }

  const invalidProjectIds = new Set<string>()
  for (const invalidFile of remoteSnapshot.invalidFiles) {
    if (invalidFile.projectId) invalidProjectIds.add(invalidFile.projectId)
    conflicts.push(
      createConflict({
        kind: 'invalid-remote',
        ...(invalidFile.projectId === undefined
          ? {}
          : { projectId: invalidFile.projectId }),
        path: invalidFile.path,
        remoteBlobSha: invalidFile.blobSha,
        error: invalidFile.error,
      }),
    )
  }

  for (const [projectId, baseline] of Object.entries(state.baseProjects)) {
    if (!baseline) continue
    if (invalidProjectIds.has(projectId)) continue

    const remote = remoteSnapshot.projects[projectId]
    const local = localById.get(projectId)
    const localHash = localHashes[projectId]
    const selected = selectedIds.has(projectId)

    if (!remote) {
      if (!selected || !local) {
        delete nextBaseProjects[projectId]
        selectedIds.delete(projectId)
        if (local) changes.remoteDeletions.push(projectId)
        else changes.converged.push(projectId)
        continue
      }

      if (localHash !== baseline.contentHash) {
        conflicts.push(
          createConflict({
            kind: 'local-modified-remote-deleted',
            projectId,
            path: getGitHubProjectPath(projectId),
            baseContentHash: baseline.contentHash,
            localContentHash: localHash,
          }),
        )
        continue
      }

      delete nextBaseProjects[projectId]
      selectedIds.delete(projectId)
      changes.remoteDeletions.push(projectId)
      continue
    }

    const remoteChanged = remote.contentHash !== baseline.contentHash
    if (!selected || !local || !localHash) {
      if (remoteChanged) {
        conflicts.push(
          createConflict({
            kind: 'local-deleted-remote-modified',
            projectId,
            path: remote.path,
            baseContentHash: baseline.contentHash,
            ...(localHash === undefined ? {} : { localContentHash: localHash }),
            remoteContentHash: remote.contentHash,
            remoteBlobSha: remote.blobSha,
          }),
        )
      }
      continue
    }

    const localChanged = localHash !== baseline.contentHash
    if (localChanged && remoteChanged) {
      if (localHash === remote.contentHash) {
        nextBaseProjects[projectId] = baselineFromRemote(remote)
        changes.converged.push(projectId)
      } else {
        conflicts.push(
          createConflict({
            kind: 'both-modified',
            projectId,
            path: remote.path,
            baseContentHash: baseline.contentHash,
            localContentHash: localHash,
            remoteContentHash: remote.contentHash,
            remoteBlobSha: remote.blobSha,
          }),
        )
      }
      continue
    }

    if (remoteChanged) {
      projectUpserts.push(remote.project)
      nextBaseProjects[projectId] = baselineFromRemote(remote)
      changes.updates.push(projectId)
      continue
    }

    // This also picks up a manual reformat whose canonical content is unchanged.
    nextBaseProjects[projectId] = baselineFromRemote(remote)
  }

  for (const [projectId, remote] of Object.entries(remoteSnapshot.projects)) {
    if (!remote) continue
    if (state.baseProjects[projectId]) continue

    const local = localById.get(projectId)
    const localHash = localHashes[projectId]
    if (!local || !localHash) {
      projectUpserts.push(remote.project)
      selectedIds.add(projectId)
      nextBaseProjects[projectId] = baselineFromRemote(remote)
      changes.additions.push(projectId)
      continue
    }

    if (localHash === remote.contentHash) {
      selectedIds.add(projectId)
      nextBaseProjects[projectId] = baselineFromRemote(remote)
      changes.links.push(projectId)
      continue
    }

    conflicts.push(
      createConflict({
        kind: 'both-added',
        projectId,
        path: remote.path,
        localContentHash: localHash,
        remoteContentHash: remote.contentHash,
        remoteBlobSha: remote.blobSha,
      }),
    )
  }

  const normalizedChanges: GitHubReconciliationChanges = {
    additions: sortedUnique(changes.additions),
    updates: sortedUnique(changes.updates),
    links: sortedUnique(changes.links),
    remoteDeletions: sortedUnique(changes.remoteDeletions),
    converged: sortedUnique(changes.converged),
  }
  const sortedConflicts = [...conflicts].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  const nextState: GitHubWorkspaceState = {
    ...state,
    selectedProjectIds: [...selectedIds].sort(),
    baseHeadSha: remoteSnapshot.headSha,
    baseProjects: nextBaseProjects,
    conflicts: sortedConflicts,
  }
  const changeCount =
    normalizedChanges.additions.length +
    normalizedChanges.updates.length +
    normalizedChanges.links.length +
    normalizedChanges.remoteDeletions.length +
    normalizedChanges.converged.length

  return {
    headSha: remoteSnapshot.headSha,
    changes: normalizedChanges,
    projectUpserts,
    conflicts: sortedConflicts,
    invalidFiles: [...remoteSnapshot.invalidFiles],
    nextState,
    hasRemoteChanges:
      state.baseHeadSha !== remoteSnapshot.headSha ||
      changeCount > 0 ||
      sortedConflicts.length > 0,
    canCommitAfterApply: sortedConflicts.length === 0,
  }
}

export interface GitHubConflictResolutionResult {
  state: GitHubWorkspaceState
  /** Plans to write into the library — in practice at most one. */
  projectUpserts: Project[]
}

function sameConflict(
  left: GitHubSyncConflict,
  right: GitHubSyncConflict,
): boolean {
  return left.path === right.path && left.kind === right.kind
}

/**
 * Settles one conflict by saying which side wins. Nothing here touches GitHub.
 *
 * Taking GitHub's copy is immediate: the file is already parsed and hashed in
 * the snapshot, so it can be written straight into the library. Keeping this
 * browser's copy is a promise instead — the baseline is moved onto GitHub's
 * current blob, which leaves the local plan reading as an ordinary edit (or,
 * with nothing local, as a deletion), and the next commit is what carries it.
 *
 * Returns `null` for a conflict the browser cannot settle on its own: an
 * unreadable managed file has no copy to choose between.
 */
export function resolveGitHubSyncConflict(
  state: GitHubWorkspaceState,
  localProjects: Iterable<Project>,
  remoteSnapshot: GitHubRemoteSnapshot,
  conflict: GitHubSyncConflict,
  resolution: GitHubConflictResolution,
): GitHubConflictResolutionResult | null {
  const projectId = conflict.projectId
  if (!projectId || conflict.kind === 'invalid-remote') return null

  const remote = remoteSnapshot.projects[projectId]
  const local = [...localProjects].find((project) => project.id === projectId)
  const selectedIds = new Set(state.selectedProjectIds)
  const baseProjects = { ...state.baseProjects }
  const projectUpserts: Project[] = []

  if (resolution === 'remote') {
    if (remote) {
      projectUpserts.push(remote.project)
      baseProjects[projectId] = baselineFromRemote(remote)
      selectedIds.add(projectId)
    } else {
      // GitHub deleted it. A local plan is never deleted on the user's behalf;
      // it just stops being something this repository knows about.
      delete baseProjects[projectId]
      selectedIds.delete(projectId)
    }
  } else if (remote) {
    baseProjects[projectId] = baselineFromRemote(remote)
    if (local) selectedIds.add(projectId)
    else selectedIds.delete(projectId)
  } else if (local) {
    // With no baseline the plan reads as an addition, which puts back the file
    // GitHub deleted.
    delete baseProjects[projectId]
    selectedIds.add(projectId)
  } else {
    return null
  }

  return {
    state: {
      ...state,
      selectedProjectIds: [...selectedIds].sort(),
      baseProjects,
      conflicts: state.conflicts.filter(
        (other) => !sameConflict(other, conflict),
      ),
    },
    projectUpserts,
  }
}

/**
 * Applies only reviewed additions and updates. Remote deletions intentionally
 * remain in the returned local list and are merely unlinked in `nextState`.
 */
export function applyGitHubReconciliationPlan(
  localProjects: Iterable<Project>,
  plan: GitHubReconciliationPlan,
): { projects: Project[]; state: GitHubWorkspaceState } {
  const projects = [...localProjects]
  const indexById = new Map(
    projects.map((project, index) => [project.id, index]),
  )

  for (const project of plan.projectUpserts) {
    const index = indexById.get(project.id)
    if (index === undefined) {
      indexById.set(project.id, projects.length)
      projects.push(project)
    } else {
      projects[index] = project
    }
  }

  return { projects, state: plan.nextState }
}
