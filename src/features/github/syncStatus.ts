import type { GitHubWorkspaceChanges } from './types.ts'
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
        detail: 'A plan changed in both places. Resolve it on GitHub.',
      }
  }
}
