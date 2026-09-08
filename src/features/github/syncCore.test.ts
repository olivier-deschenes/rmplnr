import { closeWallPoints } from '#/lib/planner/geometry.ts'
import { describe, expect, it } from 'bun:test'

import { serializeProject } from '#/lib/planner/planSerialization.ts'

import { deriveGitHubWorkspaceChanges } from './dirtyState.ts'
import { hashProject } from './hash.ts'
import {
  applyGitHubReconciliationPlan,
  planGitHubLocalDiscard,
  planGitHubReconciliation,
  resolveGitHubSyncConflict,
} from './reconciliation.ts'
import { createGitHubRemoteSnapshot } from './remoteSnapshot.ts'
import {
  createGitHubWorkspaceState,
  setGitHubProjectSelected,
} from './storage.ts'
import { getGitHubProjectPath } from './types.ts'

import type { GitHubRemoteSnapshot, GitHubWorkspaceState } from './types.ts'
import type { Project } from '#/lib/planner/types.ts'

const REPOSITORY_ID = '4815162342'
const PLAN_A = '11111111-1111-4111-8111-111111111111'
const PLAN_B = '22222222-2222-4222-8222-222222222222'

/** Distinct 40-character hex strings, so the shapes read like real Git ids. */
const sha = (seed: string) => seed.repeat(40).slice(0, 40)

function plan(id: string, name: string, runName = 'Living'): Project {
  return {
    spaces: [],
    id,
    name,
    walls: [
      {
        id: 'room-1',
        name: runName,
        points: closeWallPoints([
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
        ]),
      },
    ],
    furniture: [],
    openings: [],
  }
}

function remote(
  headSha: string,
  entries: Array<{ project: Project; blobSha?: string }>,
): Promise<GitHubRemoteSnapshot> {
  return createGitHubRemoteSnapshot(
    headSha,
    entries.map(({ project, blobSha }) => ({
      path: getGitHubProjectPath(project.id),
      blobSha: blobSha ?? sha('b'),
      contents: serializeProject(project),
    })),
  )
}

/** The state of a workspace that has just taken `projects` from the repository. */
async function synced(
  projects: Array<Project>,
  headSha = sha('a'),
): Promise<{ state: GitHubWorkspaceState; projects: Array<Project> }> {
  const snapshot = await remote(
    headSha,
    projects.map((project) => ({ project })),
  )
  const reconciled = await planGitHubReconciliation(
    createGitHubWorkspaceState(REPOSITORY_ID),
    [],
    snapshot,
  )
  const applied = applyGitHubReconciliationPlan([], reconciled)
  return { state: applied.state, projects: applied.projects }
}

describe('createGitHubRemoteSnapshot', () => {
  it('reads a well-formed managed file', async () => {
    const snapshot = await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }])
    expect(snapshot.invalidFiles).toEqual([])
    expect(snapshot.projects[PLAN_A]?.project.name).toBe('Flat')
  })

  it('rejects a file whose plan id does not match its name', async () => {
    const snapshot = await createGitHubRemoteSnapshot(sha('a'), [
      {
        path: getGitHubProjectPath(PLAN_B),
        blobSha: sha('b'),
        contents: serializeProject(plan(PLAN_A, 'Flat')),
      },
    ])
    expect(Object.keys(snapshot.projects)).toEqual([])
    expect(snapshot.invalidFiles[0].error).toMatch(
      /does not match its filename/,
    )
  })

  it('rejects a managed path that is not a plan UUID', async () => {
    const snapshot = await createGitHubRemoteSnapshot(sha('a'), [
      {
        path: '.rmplnr/plans/notes.json',
        blobSha: sha('b'),
        contents: serializeProject(plan(PLAN_A, 'Flat')),
      },
    ])
    expect(snapshot.invalidFiles).toHaveLength(1)
  })

  it('reports unreadable JSON rather than throwing', async () => {
    const snapshot = await createGitHubRemoteSnapshot(sha('a'), [
      {
        path: getGitHubProjectPath(PLAN_A),
        blobSha: sha('b'),
        contents: 'not json',
      },
    ])
    expect(snapshot.invalidFiles[0].projectId).toBe(PLAN_A)
  })
})

describe('planGitHubReconciliation', () => {
  it('adds a plan that only GitHub has', async () => {
    const snapshot = await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }])
    const reconciled = await planGitHubReconciliation(
      createGitHubWorkspaceState(REPOSITORY_ID),
      [],
      snapshot,
    )

    expect(reconciled.changes.additions).toEqual([PLAN_A])
    expect(reconciled.projectUpserts).toHaveLength(1)
    expect(reconciled.conflicts).toEqual([])
    expect(reconciled.nextState.selectedProjectIds).toEqual([PLAN_A])
  })

  it('links a local plan that already matches the remote one', async () => {
    const local = plan(PLAN_A, 'Flat')
    const snapshot = await remote(sha('a'), [{ project: local }])
    const reconciled = await planGitHubReconciliation(
      createGitHubWorkspaceState(REPOSITORY_ID),
      [local],
      snapshot,
    )

    expect(reconciled.changes.links).toEqual([PLAN_A])
    expect(reconciled.projectUpserts).toEqual([])
  })

  it('conflicts when the same plan was drawn on in both places', async () => {
    const base = plan(PLAN_A, 'Flat')
    const { state } = await synced([base])
    const snapshot = await remote(sha('c'), [
      { project: plan(PLAN_A, 'Flat (theirs)'), blobSha: sha('d') },
    ])
    const reconciled = await planGitHubReconciliation(
      state,
      [plan(PLAN_A, 'Flat (mine)')],
      snapshot,
    )

    expect(reconciled.conflicts).toHaveLength(1)
    expect(reconciled.conflicts[0].kind).toBe('both-modified')
    expect(reconciled.canCommitAfterApply).toBe(false)
  })

  it('converges when both sides happened to make the same change', async () => {
    const { state } = await synced([plan(PLAN_A, 'Flat')])
    const same = plan(PLAN_A, 'Flat (revised)')
    const snapshot = await remote(sha('c'), [
      { project: same, blobSha: sha('d') },
    ])
    const reconciled = await planGitHubReconciliation(state, [same], snapshot)

    expect(reconciled.conflicts).toEqual([])
    expect(reconciled.changes.converged).toEqual([PLAN_A])
  })

  it('conflicts when a plan edited here was deleted on GitHub', async () => {
    const { state } = await synced([plan(PLAN_A, 'Flat')])
    const reconciled = await planGitHubReconciliation(
      state,
      [plan(PLAN_A, 'Flat (mine)')],
      await remote(sha('e'), []),
    )

    expect(reconciled.conflicts[0].kind).toBe('local-modified-remote-deleted')
  })

  it('unlinks — never deletes — a plan GitHub no longer has', async () => {
    const local = plan(PLAN_A, 'Flat')
    const { state } = await synced([local])
    const reconciled = await planGitHubReconciliation(
      state,
      [local],
      await remote(sha('e'), []),
    )
    const applied = applyGitHubReconciliationPlan([local], reconciled)

    expect(reconciled.changes.remoteDeletions).toEqual([PLAN_A])
    expect(applied.projects).toHaveLength(1)
    expect(applied.state.selectedProjectIds).toEqual([])
    expect(applied.state.baseProjects[PLAN_A]).toBeUndefined()
  })

  it('carries an invalid remote file through as a conflict', async () => {
    const snapshot = await createGitHubRemoteSnapshot(sha('a'), [
      {
        path: getGitHubProjectPath(PLAN_A),
        blobSha: sha('b'),
        contents: 'not json',
      },
    ])
    const reconciled = await planGitHubReconciliation(
      createGitHubWorkspaceState(REPOSITORY_ID),
      [],
      snapshot,
    )

    expect(reconciled.conflicts[0].kind).toBe('invalid-remote')
    expect(reconciled.canCommitAfterApply).toBe(false)
  })

  it('leaves the state it was given alone', async () => {
    const state = createGitHubWorkspaceState(REPOSITORY_ID)
    const before = JSON.stringify(state)
    await planGitHubReconciliation(
      state,
      [],
      await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }]),
    )

    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('resolveGitHubSyncConflict', () => {
  /** Walks a conflict out of the reconciler so the shapes stay real. */
  async function conflictOver(
    state: GitHubWorkspaceState,
    localProjects: Array<Project>,
    snapshot: GitHubRemoteSnapshot,
  ) {
    const reconciled = await planGitHubReconciliation(
      state,
      localProjects,
      snapshot,
    )
    expect(reconciled.conflicts).toHaveLength(1)
    return reconciled.conflicts[0]
  }

  it("takes GitHub's copy into the library when both sides were edited", async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const mine = plan(PLAN_A, 'Flat', 'Studio')
    const theirs = plan(PLAN_A, 'Flat', 'Kitchen')
    const snapshot = await remote(sha('c'), [
      { project: theirs, blobSha: sha('d') },
    ])
    const conflict = await conflictOver(base.state, [mine], snapshot)
    expect(conflict.kind).toBe('both-modified')

    const settled = resolveGitHubSyncConflict(
      base.state,
      [mine],
      snapshot,
      conflict,
      'remote',
    )
    expect(settled?.projectUpserts).toEqual([theirs])
    expect(settled?.state.conflicts).toEqual([])
    expect(settled?.state.baseProjects[PLAN_A]?.blobSha).toBe(sha('d'))

    // Nothing is left waiting: the library now holds exactly what GitHub has.
    const after = await deriveGitHubWorkspaceChanges(settled!.state, [theirs])
    expect(after.hasChanges).toBe(false)
  })

  it('leaves the local edit waiting as an update when this browser wins', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const mine = plan(PLAN_A, 'Flat', 'Studio')
    const snapshot = await remote(sha('c'), [
      { project: plan(PLAN_A, 'Flat', 'Kitchen'), blobSha: sha('d') },
    ])
    const conflict = await conflictOver(base.state, [mine], snapshot)

    const settled = resolveGitHubSyncConflict(
      base.state,
      [mine],
      snapshot,
      conflict,
      'local',
    )
    expect(settled?.projectUpserts).toEqual([])

    const after = await deriveGitHubWorkspaceChanges(settled!.state, [mine])
    expect(after.updated).toEqual([PLAN_A])
    expect(after.canCommit).toBe(true)
  })

  it('re-conflicts with nothing once the choice is made', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const mine = plan(PLAN_A, 'Flat', 'Studio')
    const snapshot = await remote(sha('c'), [
      { project: plan(PLAN_A, 'Flat', 'Kitchen'), blobSha: sha('d') },
    ])
    const conflict = await conflictOver(base.state, [mine], snapshot)
    const settled = resolveGitHubSyncConflict(
      base.state,
      [mine],
      snapshot,
      conflict,
      'local',
    )

    const replanned = await planGitHubReconciliation(
      settled!.state,
      [mine],
      snapshot,
    )
    expect(replanned.conflicts).toEqual([])
  })

  it('brings a plan back into the browser it was deleted from', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const theirs = plan(PLAN_A, 'Flat', 'Kitchen')
    const snapshot = await remote(sha('c'), [
      { project: theirs, blobSha: sha('d') },
    ])
    const conflict = await conflictOver(base.state, [], snapshot)
    expect(conflict.kind).toBe('local-deleted-remote-modified')

    const settled = resolveGitHubSyncConflict(
      base.state,
      [],
      snapshot,
      conflict,
      'remote',
    )
    expect(settled?.projectUpserts).toEqual([theirs])
    expect(settled?.state.selectedProjectIds).toEqual([PLAN_A])

    const after = await deriveGitHubWorkspaceChanges(settled!.state, [theirs])
    expect(after.hasChanges).toBe(false)
  })

  it('carries the deletion to GitHub when the browser wins instead', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const snapshot = await remote(sha('c'), [
      { project: plan(PLAN_A, 'Flat', 'Kitchen'), blobSha: sha('d') },
    ])
    const conflict = await conflictOver(base.state, [], snapshot)

    const settled = resolveGitHubSyncConflict(
      base.state,
      [],
      snapshot,
      conflict,
      'local',
    )
    const after = await deriveGitHubWorkspaceChanges(settled!.state, [])
    expect(after.deleted).toEqual([PLAN_A])
    expect(after.canCommit).toBe(true)
  })

  it('puts a plan back on GitHub that was deleted there but edited here', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const mine = plan(PLAN_A, 'Flat', 'Studio')
    const snapshot = await remote(sha('c'), [])
    const conflict = await conflictOver(base.state, [mine], snapshot)
    expect(conflict.kind).toBe('local-modified-remote-deleted')

    const settled = resolveGitHubSyncConflict(
      base.state,
      [mine],
      snapshot,
      conflict,
      'local',
    )
    const after = await deriveGitHubWorkspaceChanges(settled!.state, [mine])
    expect(after.added).toEqual([PLAN_A])
  })

  it('accepts a GitHub deletion without touching the local plan', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const mine = plan(PLAN_A, 'Flat', 'Studio')
    const snapshot = await remote(sha('c'), [])
    const conflict = await conflictOver(base.state, [mine], snapshot)

    const settled = resolveGitHubSyncConflict(
      base.state,
      [mine],
      snapshot,
      conflict,
      'remote',
    )
    expect(settled?.projectUpserts).toEqual([])
    expect(settled?.state.baseProjects[PLAN_A]).toBeUndefined()
    expect(settled?.state.selectedProjectIds).toEqual([])

    // The plan is still the user's; it has only stopped being GitHub's.
    const after = await deriveGitHubWorkspaceChanges(settled!.state, [mine])
    expect(after.hasChanges).toBe(false)
  })

  it('refuses a file GitHub cannot read, whichever side is asked for', async () => {
    const snapshot = await createGitHubRemoteSnapshot(sha('c'), [
      {
        path: getGitHubProjectPath(PLAN_A),
        blobSha: sha('d'),
        contents: 'not json',
      },
    ])
    const conflict = await conflictOver(
      createGitHubWorkspaceState(REPOSITORY_ID),
      [],
      snapshot,
    )
    expect(conflict.kind).toBe('invalid-remote')

    for (const resolution of ['remote', 'local'] as const) {
      expect(
        resolveGitHubSyncConflict(
          createGitHubWorkspaceState(REPOSITORY_ID),
          [],
          snapshot,
          conflict,
          resolution,
        ),
      ).toBeNull()
    }
  })

  it('leaves the state it was given alone', async () => {
    const base = await synced([plan(PLAN_A, 'Flat')])
    const frozen = structuredClone(base.state)
    const mine = plan(PLAN_A, 'Flat', 'Studio')
    const snapshot = await remote(sha('c'), [
      { project: plan(PLAN_A, 'Flat', 'Kitchen'), blobSha: sha('d') },
    ])
    const conflict = await conflictOver(base.state, [mine], snapshot)

    resolveGitHubSyncConflict(base.state, [mine], snapshot, conflict, 'remote')
    expect(base.state).toEqual(frozen)
  })
})

describe('deriveGitHubWorkspaceChanges', () => {
  it('finds nothing to do straight after a sync', async () => {
    const { state, projects } = await synced([plan(PLAN_A, 'Flat')])
    const changes = await deriveGitHubWorkspaceChanges(state, projects)

    expect(changes.hasChanges).toBe(false)
    expect(changes.unchanged).toEqual([PLAN_A])
  })

  it('counts a local edit as one update', async () => {
    const { state } = await synced([plan(PLAN_A, 'Flat')])
    const changes = await deriveGitHubWorkspaceChanges(state, [
      plan(PLAN_A, 'Flat', 'Bedroom'),
    ])

    expect(changes.updated).toEqual([PLAN_A])
    expect(changes.changeCount).toBe(1)
    expect(changes.canCommit).toBe(true)
  })

  it('counts a newly selected plan as an addition', async () => {
    const state = setGitHubProjectSelected(
      createGitHubWorkspaceState(REPOSITORY_ID),
      PLAN_B,
      true,
    )
    const changes = await deriveGitHubWorkspaceChanges(state, [
      plan(PLAN_B, 'House'),
    ])

    expect(changes.added).toEqual([PLAN_B])
  })

  it('counts an unselected plan as a removal', async () => {
    const local = plan(PLAN_A, 'Flat')
    const { state } = await synced([local])
    const changes = await deriveGitHubWorkspaceChanges(
      setGitHubProjectSelected(state, PLAN_A, false),
      [local],
    )

    expect(changes.deleted).toEqual([PLAN_A])
    expect(changes.canCommit).toBe(true)
  })

  it('blocks committing while a conflict stands', async () => {
    const { state, projects } = await synced([plan(PLAN_A, 'Flat')])
    const changes = await deriveGitHubWorkspaceChanges(
      {
        ...state,
        conflicts: [
          {
            kind: 'both-modified',
            projectId: PLAN_A,
            path: getGitHubProjectPath(PLAN_A),
          },
        ],
      },
      projects.map((project) => ({ ...project, name: 'Flat (mine)' })),
    )

    expect(changes.hasChanges).toBe(true)
    expect(changes.blockedByConflicts).toBe(true)
    expect(changes.canCommit).toBe(false)
  })
})

describe('planGitHubLocalDiscard', () => {
  it('finds nothing to do when the library already matches GitHub', async () => {
    const { state, projects } = await synced([plan(PLAN_A, 'Flat')])
    const discard = await planGitHubLocalDiscard(
      state,
      projects,
      await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }]),
    )

    expect(discard.hasWork).toBe(false)
    expect(discard.projectUpserts).toEqual([])
    expect(discard.nextState.selectedProjectIds).toEqual([PLAN_A])
  })

  it("puts a local edit back to the repository's copy", async () => {
    const { state } = await synced([plan(PLAN_A, 'Flat')])
    const discard = await planGitHubLocalDiscard(
      state,
      [plan(PLAN_A, 'Flat', 'Bedroom')],
      await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }]),
    )

    expect(discard.reverted).toEqual([PLAN_A])
    expect(discard.recovered).toEqual([])
    expect(discard.unlinked).toEqual([])
    expect(discard.projectUpserts).toHaveLength(1)
    expect(discard.projectUpserts[0]?.walls[0]?.name).toBe('Living')
  })

  it('brings back a plan that was deleted from the library', async () => {
    const { state } = await synced([plan(PLAN_A, 'Flat')])
    const discard = await planGitHubLocalDiscard(
      state,
      [],
      await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }]),
    )

    expect(discard.recovered).toEqual([PLAN_A])
    expect(discard.projectUpserts[0]?.id).toBe(PLAN_A)
    expect(discard.nextState.selectedProjectIds).toEqual([PLAN_A])
  })

  it('puts a plan taken out of sync back into it', async () => {
    const local = plan(PLAN_A, 'Flat')
    const { state } = await synced([local])
    const discard = await planGitHubLocalDiscard(
      setGitHubProjectSelected(state, PLAN_A, false),
      [local],
      await remote(sha('a'), [{ project: local }]),
    )

    expect(discard.recovered).toEqual([PLAN_A])
    expect(discard.nextState.selectedProjectIds).toEqual([PLAN_A])
    // The drawing already matches, so there is nothing to write into the library.
    expect(discard.projectUpserts).toEqual([])
  })

  it('unlinks a plan GitHub has never had rather than deleting it', async () => {
    const { state, projects } = await synced([plan(PLAN_A, 'Flat')])
    const added = plan(PLAN_B, 'House')
    const discard = await planGitHubLocalDiscard(
      setGitHubProjectSelected(state, PLAN_B, true),
      [...projects, added],
      await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }]),
    )

    expect(discard.unlinked).toEqual([PLAN_B])
    expect(discard.projectUpserts).toEqual([])
    expect(discard.nextState.selectedProjectIds).toEqual([PLAN_A])
    expect(discard.nextState.baseProjects[PLAN_B]).toBeUndefined()
  })

  it('settles a conflict that had a side to take', async () => {
    const { state } = await synced([plan(PLAN_A, 'Flat')])
    const discard = await planGitHubLocalDiscard(
      {
        ...state,
        conflicts: [
          {
            kind: 'both-modified',
            projectId: PLAN_A,
            path: getGitHubProjectPath(PLAN_A),
          },
        ],
      },
      [plan(PLAN_A, 'Flat', 'Bedroom')],
      await remote(sha('b'), [{ project: plan(PLAN_A, 'Flat', 'Kitchen') }]),
    )

    expect(discard.nextState.conflicts).toEqual([])
    expect(discard.projectUpserts[0]?.walls[0]?.name).toBe('Kitchen')
    expect(discard.nextState.baseHeadSha).toBe(sha('b'))
  })

  it('leaves an unreadable managed file blocking commits', async () => {
    const { state, projects } = await synced([plan(PLAN_A, 'Flat')])
    const conflicts = [
      {
        kind: 'invalid-remote' as const,
        path: `${'.rmplnr/plans'}/not-a-plan.json`,
        error: 'Invalid plan JSON.',
      },
    ]
    const discard = await planGitHubLocalDiscard(
      { ...state, conflicts },
      projects,
      await remote(sha('a'), [{ project: plan(PLAN_A, 'Flat') }]),
    )

    expect(discard.nextState.conflicts).toEqual(conflicts)
  })

  it('repairs a baseline written down by an older build', async () => {
    // A plan identical to GitHub's, whose recorded hash came from a build that
    // serialized plans differently. `deriveGitHubWorkspaceChanges` reads that
    // as an edit, and the head has not moved, so reconciliation never looks.
    const local = plan(PLAN_A, 'Flat')
    const { state } = await synced([local])
    const stale = {
      ...state,
      baseProjects: {
        [PLAN_A]: { blobSha: sha('c'), contentHash: 'f'.repeat(64) },
      },
    }
    expect(
      (await deriveGitHubWorkspaceChanges(stale, [local])).updated,
    ).toEqual([PLAN_A])

    const snapshot = await remote(sha('a'), [{ project: local }])
    const discard = await planGitHubLocalDiscard(stale, [local], snapshot)

    expect(discard.hasWork).toBe(true)
    expect(discard.realigned).toEqual([PLAN_A])
    // The drawing already matched, so nothing is written into the library.
    expect(discard.projectUpserts).toEqual([])
    expect(
      (await deriveGitHubWorkspaceChanges(discard.nextState, [local]))
        .hasChanges,
    ).toBe(false)
  })

  it('reports a corrected record apart from a discarded edit', async () => {
    const { state } = await synced([
      plan(PLAN_A, 'Flat'),
      plan(PLAN_B, 'House'),
    ])
    const stale = {
      ...state,
      baseProjects: {
        ...state.baseProjects,
        [PLAN_B]: { blobSha: sha('c'), contentHash: 'f'.repeat(64) },
      },
    }
    const discard = await planGitHubLocalDiscard(
      stale,
      [plan(PLAN_A, 'Flat', 'Bedroom'), plan(PLAN_B, 'House')],
      await remote(sha('a'), [
        { project: plan(PLAN_A, 'Flat') },
        { project: plan(PLAN_B, 'House') },
      ]),
    )

    expect(discard.reverted).toEqual([PLAN_A])
    expect(discard.realigned).toEqual([PLAN_B])
  })

  it('puts back only the plan it is given', async () => {
    const { state } = await synced([
      plan(PLAN_A, 'Flat'),
      plan(PLAN_B, 'House'),
    ])
    const discard = await planGitHubLocalDiscard(
      state,
      [plan(PLAN_A, 'Flat', 'Bedroom'), plan(PLAN_B, 'House', 'Attic')],
      await remote(sha('a'), [
        { project: plan(PLAN_A, 'Flat') },
        { project: plan(PLAN_B, 'House') },
      ]),
      [PLAN_A],
    )

    expect(discard.reverted).toEqual([PLAN_A])
    expect(discard.projectUpserts.map((project) => project.id)).toEqual([
      PLAN_A,
    ])
  })

  it('leaves a plan outside the scope waiting to commit', async () => {
    const { state } = await synced([
      plan(PLAN_A, 'Flat'),
      plan(PLAN_B, 'House'),
    ])
    const edited = [
      plan(PLAN_A, 'Flat', 'Bedroom'),
      plan(PLAN_B, 'House', 'Attic'),
    ]
    const discard = await planGitHubLocalDiscard(
      state,
      edited,
      await remote(sha('a'), [
        { project: plan(PLAN_A, 'Flat') },
        { project: plan(PLAN_B, 'House') },
      ]),
      [PLAN_A],
    )
    const changes = await deriveGitHubWorkspaceChanges(discard.nextState, [
      plan(PLAN_A, 'Flat'),
      plan(PLAN_B, 'House', 'Attic'),
    ])

    expect(changes.updated).toEqual([PLAN_B])
  })

  it('unlinks only the scoped addition, leaving the other selected', async () => {
    const state = {
      ...createGitHubWorkspaceState(REPOSITORY_ID),
      selectedProjectIds: [PLAN_A, PLAN_B],
    }
    const discard = await planGitHubLocalDiscard(
      state,
      [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House')],
      await remote(sha('a'), []),
      [PLAN_A],
    )

    expect(discard.unlinked).toEqual([PLAN_A])
    expect(discard.nextState.selectedProjectIds).toEqual([PLAN_B])
  })

  it('leaves a conflict outside the scope standing', async () => {
    const { state } = await synced([
      plan(PLAN_A, 'Flat'),
      plan(PLAN_B, 'House'),
    ])
    const conflicts = [
      {
        kind: 'both-modified' as const,
        projectId: PLAN_B,
        path: getGitHubProjectPath(PLAN_B),
      },
    ]
    const discard = await planGitHubLocalDiscard(
      { ...state, conflicts },
      [plan(PLAN_A, 'Flat', 'Bedroom'), plan(PLAN_B, 'House', 'Attic')],
      await remote(sha('a'), [
        { project: plan(PLAN_A, 'Flat') },
        { project: plan(PLAN_B, 'House') },
      ]),
      [PLAN_A],
    )

    expect(discard.nextState.conflicts).toEqual(conflicts)
  })

  it('leaves the reconciled state with nothing waiting to commit', async () => {
    const { state, projects } = await synced([
      plan(PLAN_A, 'Flat'),
      plan(PLAN_B, 'House'),
    ])
    const edited = projects.map((project) =>
      project.id === PLAN_A ? plan(PLAN_A, 'Flat', 'Bedroom') : project,
    )
    const snapshot = await remote(sha('a'), [
      { project: plan(PLAN_A, 'Flat') },
      { project: plan(PLAN_B, 'House') },
    ])
    const discard = await planGitHubLocalDiscard(state, edited, snapshot)

    const applied = edited.map(
      (project) =>
        discard.projectUpserts.find((upsert) => upsert.id === project.id) ??
        project,
    )
    const changes = await deriveGitHubWorkspaceChanges(
      discard.nextState,
      applied,
    )

    expect(changes.hasChanges).toBe(false)
  })
})

describe('hashProject', () => {
  it('gives two plans that draw the same thing the same hash', async () => {
    expect(await hashProject(plan(PLAN_A, 'Flat'))).toBe(
      await hashProject(plan(PLAN_A, 'Flat')),
    )
  })

  it('changes when the plan does', async () => {
    expect(await hashProject(plan(PLAN_A, 'Flat'))).not.toBe(
      await hashProject(plan(PLAN_A, 'Flat', 'Bedroom')),
    )
  })
})
