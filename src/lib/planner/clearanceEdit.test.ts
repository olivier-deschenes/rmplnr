import { beforeEach, describe, expect, it } from 'bun:test'

import { closeWallPoints } from '#/lib/planner/geometry.ts'

import { plannerStore } from './store.ts'
import { clearancesFor } from './clearances.ts'

import type { Project, Selection } from './types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

/** A 400 x 300 room with a box in the middle of it and a door in the top wall. */
function plan(): Project {
  return {
    id: PLAN,
    name: 'Flat',
    spaces: [],
    walls: [
      {
        id: 'room',
        name: 'Living',
        points: closeWallPoints([
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
          { x: 0, y: 300 },
        ]),
      },
    ],
    furniture: [
      {
        id: 'box',
        kind: 'box',
        name: 'Box',
        x: 200,
        y: 150,
        w: 100,
        h: 60,
        rotation: 0,
      },
    ],
    openings: [
      {
        id: 'door',
        kind: 'door',
        runId: 'room',
        wall: 0,
        t: 0.25,
        width: 90,
        hinge: 'start',
        swing: 'in',
      },
    ],
  }
}

/** The gap now standing where `key` was measured, of the current selection. */
function gap(key: string): number | undefined {
  const state = plannerStore.state
  return clearancesFor(
    state.selection,
    state.walls,
    state.furniture,
    state.openings,
  ).find((clearance) => clearance.key === key)?.distance
}

function select(selection: Selection) {
  plannerStore.actions.select(selection)
}

beforeEach(() => {
  plannerStore.actions.closeProject()
  plannerStore.actions.setTool('move')
  plannerStore.actions.setCollide(true)
  plannerStore.actions.setUnits('metric')
  plannerStore.actions.loadLibrary({ version: 1, projects: [plan()] })
  plannerStore.actions.openProject(PLAN)
})

describe('setting a gap around furniture', () => {
  beforeEach(() => select({ type: 'furniture', id: 'box' }))

  it('moves the item until the gap measures what was asked for', () => {
    expect(gap('w')).toBe(144)

    expect(plannerStore.actions.setClearance('w', 50)).toEqual({ ok: true })

    expect(gap('w')).toBeCloseTo(50, 6)
    expect(plannerStore.state.furniture[0].x).toBeCloseTo(106, 6)
  })

  it('gives to the far side exactly what it takes from the near one', () => {
    const east = gap('e')!

    plannerStore.actions.setClearance('w', 50)

    expect(gap('e')).toBeCloseTo(east + 94, 6)
  })

  it('opens a gap as readily as it closes one', () => {
    plannerStore.actions.setClearance('n', 200)

    expect(gap('n')).toBeCloseTo(200, 6)
  })

  it('stops at what is in the way rather than moving through it', () => {
    // Widening the west gap backs the box east, and there is not 400 of room
    // to back into: it comes to rest against the east wall, and the gap left
    // behind is the one that is really there rather than the one asked for.
    plannerStore.actions.setClearance('w', 400)

    expect(gap('w')).toBeCloseTo(288, 6)
    expect(gap('e')).toBeUndefined()
    expect(plannerStore.state.furniture[0].x).toBeCloseTo(344, 6)
  })

  it('is one step to undo', () => {
    const before = plannerStore.state.furniture[0]

    plannerStore.actions.setClearance('w', 50)
    plannerStore.actions.sealHistory()
    plannerStore.actions.undo()

    expect(plannerStore.state.furniture[0]).toEqual(before)
  })
})

describe('setting a gap beside an opening', () => {
  beforeEach(() => select({ type: 'opening', id: 'door' }))

  it('slides the opening along its own wall', () => {
    expect(gap('start')).toBe(55)

    expect(plannerStore.actions.setClearance('start', 100)).toEqual({
      ok: true,
    })

    expect(gap('start')).toBeCloseTo(100, 6)
    expect(gap('end')).toBeCloseTo(210, 6)
  })
})

describe('setting a gap across a wall', () => {
  /** Takes the box out, leaving the top wall looking at the bottom one. */
  const clearTheFloor = () => {
    select({ type: 'furniture', id: 'box' })
    plannerStore.actions.deleteSelected()
    select({ type: 'wall', id: 'room', index: 0 })
  }

  beforeEach(() => select({ type: 'wall', id: 'room', index: 0 }))

  it('pushes the wall until the room measures what was asked for', () => {
    clearTheFloor()
    expect(gap('back')).toBe(288)

    expect(plannerStore.actions.setClearance('back', 200)).toEqual({ ok: true })

    expect(gap('back')).toBeCloseTo(200, 6)
    // The walls it turns into at its corners came with it; the far side of the
    // room stayed where it was.
    const run = plannerStore.state.walls.find((r) => r.id === 'room')!
    expect(run.points[0]).toEqual({ x: 0, y: 88 })
    expect(run.points[1]).toEqual({ x: 400, y: 88 })
    expect(run.points[2]).toEqual({ x: 400, y: 300 })
  })

  it('measures to whatever stands in front of it, not only to a wall', () => {
    // The box, not the far wall, is what the top wall is looking at.
    expect(gap('back')).toBe(114)

    plannerStore.actions.setClearance('back', 200)

    expect(gap('back')).toBeCloseTo(200, 6)
    expect(plannerStore.state.walls[0].points[0]).toEqual({ x: 0, y: -86 })
  })

  it('carries the openings cut into it', () => {
    clearTheFloor()
    plannerStore.actions.setClearance('back', 200)

    const door = plannerStore.state.openings.find((o) => o.id === 'door')!
    expect(door.t).toBeCloseTo(0.25, 6)
  })

  it('will not move a wall that is locked', () => {
    plannerStore.actions.setRunLocked('room', true)

    expect(plannerStore.actions.setClearance('back', 200)).toEqual({
      ok: false,
      error: 'Unlock Living to move this wall.',
    })
    expect(plannerStore.state.walls[0].points[0]).toEqual({ x: 0, y: 0 })
  })

  it('is one step to undo', () => {
    const before = plannerStore.state.walls

    plannerStore.actions.setClearance('back', 200)
    plannerStore.actions.sealHistory()
    plannerStore.actions.undo()

    expect(plannerStore.state.walls).toEqual(before)
  })
})

describe('a gap that cannot be set', () => {
  it('says so when the gap is no longer there', () => {
    select({ type: 'furniture', id: 'box' })

    expect(plannerStore.actions.setClearance('nowhere', 50)).toEqual({
      ok: false,
      error: 'That gap is no longer there to set.',
    })
  })

  it('says so when nothing is selected', () => {
    select(null)

    expect(plannerStore.actions.setClearance('w', 50).ok).toBe(false)
  })

  it('refuses a gap that runs the wrong way', () => {
    select({ type: 'furniture', id: 'box' })

    expect(plannerStore.actions.setClearance('w', -10)).toEqual({
      ok: false,
      error: 'Enter a gap of zero or more.',
    })
  })
})
