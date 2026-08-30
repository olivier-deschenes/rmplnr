import { describe, expect, it } from 'bun:test'

import { serializeProject } from '#/lib/planner/planSerialization.ts'

import { deriveGitHubWorkspaceChanges } from './dirtyState.ts'
import { hashProject } from './hash.ts'
import {
  applyGitHubReconciliationPlan,
  planGitHubReconciliation,
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

function plan(id: string, name: string, roomName = 'Living'): Project {
  return {
    id,
    name,
    rooms: [
      {
        id: 'room-1',
        name: roomName,
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
        ],
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
