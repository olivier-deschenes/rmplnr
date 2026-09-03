import { describe, expect, it } from 'bun:test'

import { describeGitHubConflict, describeGitHubSync } from './syncStatus.ts'

import type { GitHubSyncConflict, GitHubWorkspaceChanges } from './types.ts'

const conflict = (kind: GitHubSyncConflict['kind']): GitHubSyncConflict => ({
  kind,
  projectId: '11111111-1111-4111-8111-111111111111',
  path: '.rmplnr/plans/11111111-1111-4111-8111-111111111111.json',
})

describe('GitHub conflict copy', () => {
  it('recommends preserving a newer GitHub edit over deleting it', () => {
    const copy = describeGitHubConflict(
      conflict('local-deleted-remote-modified'),
      false,
    )

    expect(copy.remoteLabel).toBe('Restore from GitHub')
    expect(copy.localLabel).toBe('Delete from GitHub')
    expect(copy.recommended).toBe('remote')
    expect(copy.destructive).toBe('local')
  })

  it('does not invent a recommendation when both copies contain edits', () => {
    const copy = describeGitHubConflict(conflict('both-modified'), true)

    expect(copy.remoteLabel).toBe('Use GitHub version')
    expect(copy.localLabel).toBe('Keep browser version')
    expect(copy.recommended).toBeNull()
    expect(copy.destructive).toBeNull()
  })
})

describe('GitHub conflict status', () => {
  it('describes the user decision instead of the implementation block', () => {
    const changes: GitHubWorkspaceChanges = {
      added: [],
      updated: [],
      deleted: [],
      unchanged: [],
      changeCount: 0,
      hasChanges: false,
      blockedByConflicts: true,
      canCommit: false,
    }

    expect(describeGitHubSync('conflict', changes)).toMatchObject({
      title: 'GitHub changes need your decision',
      detail: 'Choose what should happen to each plan before committing again.',
    })
  })
})
