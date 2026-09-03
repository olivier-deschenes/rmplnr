import type { GitHubSyncConflict, GitHubWorkspaceChanges } from './types.ts'
import type { GitHubSyncDisplayState } from './useGithubSync.ts'

/**
 * The traffic light shown on the commit button. `ok` means there is nothing to
 * do, `warn` means the user has work waiting, and `bad` means commits are
 * blocked until something is resolved.
 */
export type GitHubSyncTone = 'ok' | 'warn' | 'bad' | 'busy' | 'idle'

export interface GitHubSyncStatus {
  tone: GitHubSyncTone
  /** Terse enough for the toolbar button. */
  label: string
  /** Full status name, used as the dialog heading. */
  title: string
  /** One line saying what, if anything, the user should do. */
  detail: string
}

/** Tailwind background for a tone's indicator square. */
export const syncToneBackground: Record<GitHubSyncTone, string> = {
  ok: 'bg-sync-ok',
  warn: 'bg-sync-warn',
  bad: 'bg-sync-bad',
  busy: 'bg-muted-foreground',
  idle: 'bg-muted-foreground/40',
}

function pendingLabel(changes: GitHubWorkspaceChanges): string {
  const parts = [
    changes.added.length > 0 ? `${changes.added.length} added` : null,
    changes.updated.length > 0 ? `${changes.updated.length} updated` : null,
    changes.deleted.length > 0 ? `${changes.deleted.length} removed` : null,
  ].filter((part) => part !== null)
  return parts.join(', ')
}

export function describeGitHubSync(
  state: GitHubSyncDisplayState,
  changes: GitHubWorkspaceChanges,
): GitHubSyncStatus {
  switch (state) {
    case 'disconnected':
      return {
        tone: 'idle',
        label: 'Off',
        title: 'GitHub sync is off',
        detail: 'Connect an account to commit plans to a repository.',
      }
    case 'local-only':
      return {
        tone: 'idle',
        label: 'No repo',
        title: 'No repository chosen',
        detail: 'Pick a repository to start committing plans.',
      }
    case 'up-to-date':
      return {
        tone: 'ok',
        label: 'Synced',
        title: 'Everything is committed',
        detail: 'Every synced plan matches GitHub. Nothing to do.',
      }
    case 'pending-changes':
      return {
        tone: 'warn',
        label:
          changes.changeCount === 1
            ? '1 change'
            : `${changes.changeCount} changes`,
        title: 'Changes waiting to commit',
        detail: pendingLabel(changes),
      }
    case 'remote-update':
      return {
        tone: 'warn',
        label: 'Review',
        title: 'GitHub changed',
        detail: 'Review the incoming changes before they touch this browser.',
      }
    case 'committing':
      return {
        tone: 'busy',
        label: 'Committing',
        title: 'Committing to GitHub',
        detail: 'Writing the selected plans to the repository.',
      }
    case 'offline':
      return {
        tone: 'warn',
        label: 'Offline',
        title: 'Offline',
        detail: 'Reconnect to see GitHub changes and commit again.',
      }
    case 'access-revoked':
      return {
        tone: 'bad',
        label: 'Access revoked',
        title: 'GitHub access was revoked',
        detail: 'Your browser plans are unchanged. Reconnect to resume sync.',
      }
    case 'conflict':
      return {
        tone: 'bad',
        label: 'Conflict',
        title: 'Conflict blocks commits',
        detail: 'Choose which copy to keep before committing again.',
      }
  }
}

export interface GitHubConflictCopy {
  /** What is actually in conflict, said in the order it happened. */
  summary: string
  /** What each choice does here, or `null` when it is not on offer. */
  remote: string | null
  local: string | null
  /** Shown instead of the choices when neither side can settle it. */
  manual: string | null
}

/**
 * A conflict in words. The kinds are not interchangeable — "both of you drew
 * on it" and "you deleted it, GitHub kept editing" want different sentences
 * and different buttons — so each gets its own.
 */
export function describeGitHubConflict(
  conflict: GitHubSyncConflict,
  hasLocalPlan: boolean,
): GitHubConflictCopy {
  switch (conflict.kind) {
    case 'both-added':
      return {
        summary:
          'This plan was started here and on GitHub under the same ID, and the two are different.',
        remote: "Replace this browser's copy with GitHub's.",
        local:
          "Keep this browser's copy and overwrite GitHub on the next commit.",
        manual: null,
      }
    case 'both-modified':
      return {
        summary:
          'This plan was edited here and on GitHub since the last sync, in different ways.',
        remote: "Discard the edits made here and take GitHub's copy.",
        local:
          'Keep the edits made here and overwrite GitHub on the next commit.',
        manual: null,
      }
    case 'local-modified-remote-deleted':
      return {
        summary: 'This plan was edited here, and deleted on GitHub.',
        remote:
          'Accept the deletion. The plan stays in this browser and stops syncing.',
        local: 'Put the plan back on GitHub on the next commit.',
        manual: null,
      }
    case 'local-deleted-remote-modified':
      return {
        summary: hasLocalPlan
          ? 'This plan was taken out of sync here, and edited on GitHub afterwards.'
          : 'This plan is no longer in this browser, and was edited on GitHub afterwards.',
        remote: hasLocalPlan
          ? "Sync it again, starting from GitHub's copy."
          : "Bring the plan back into this browser from GitHub's copy.",
        local: 'Delete it from GitHub on the next commit.',
        manual: null,
      }
    case 'invalid-remote':
      return {
        summary:
          'A file in the plans folder on GitHub is not a plan this app can read, so it cannot be compared with anything here.',
        remote: null,
        local: null,
        manual:
          'Fix the JSON or move the file out of the plans folder on GitHub. Commits stay blocked until it reads as a plan or is gone.',
      }
  }
}

/** Whether this conflict can be settled from the browser at all. */
export function isGitHubConflictResolvable(
  conflict: GitHubSyncConflict,
): boolean {
  return conflict.kind !== 'invalid-remote' && conflict.projectId !== undefined
}
