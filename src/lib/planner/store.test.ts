import { beforeEach, describe, expect, it } from 'bun:test'

import { currentProjects, plannerStore } from './store.ts'
import { closetSize } from './closets.ts'
import { translatePolygon } from './geometry.ts'
import { snapTargets } from './snapping.ts'

import type { Project } from './types.ts'

const PLAN_A = '11111111-1111-4111-8111-111111111111'
const PLAN_B = '22222222-2222-4222-8222-222222222222'
const PLAN_C = '33333333-3333-4333-8333-333333333333'

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

beforeEach(() => {
  plannerStore.actions.closeProject()
  plannerStore.actions.loadLibrary({
    version: 1,
    projects: [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House')],
  })
})

describe('currentProjects', () => {
  it('brings the open plan up to date with what is being drawn', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addFurniture('sofa')

    expect(plannerStore.state.projects[0].furniture).toEqual([])
    expect(currentProjects(plannerStore.state)[0].furniture).toHaveLength(1)
  })

  it('reads straight through when nothing is open', () => {
    expect(currentProjects(plannerStore.state)).toEqual(
      plannerStore.state.projects,
    )
  })
})

describe('upsertProjects', () => {
  it('replaces a plan that is not the one open', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.upsertProjects([plan(PLAN_B, 'House (from GitHub)')])

    const projects = currentProjects(plannerStore.state)
    expect(projects.find((p) => p.id === PLAN_B)?.name).toBe(
      'House (from GitHub)',
    )
    expect(plannerStore.state.rooms[0].name).toBe('Living')
  })

  it('adds a plan the library has never seen', () => {
    plannerStore.actions.upsertProjects([plan(PLAN_C, 'New from GitHub')])

    expect(currentProjects(plannerStore.state)).toHaveLength(3)
  })

  it('redraws the open plan when it is the one that changed', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addFurniture('table')
    plannerStore.actions.upsertProjects([
      plan(PLAN_A, 'Flat (from GitHub)', 'Bedroom'),
    ])

    expect(plannerStore.state.rooms[0].name).toBe('Bedroom')
    expect(plannerStore.state.furniture).toEqual([])
  })

  it('clears the history so an undo cannot cross the seam', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addFurniture('table')
    expect(plannerStore.state.history.past.length).toBeGreaterThan(0)

    plannerStore.actions.upsertProjects([plan(PLAN_A, 'Flat', 'Bedroom')])

    expect(plannerStore.state.history.past).toEqual([])
    expect(plannerStore.state.history.future).toEqual([])
    expect(plannerStore.state.selection).toBeNull()
  })

  it('does nothing at all when given nothing', () => {
    const before = plannerStore.state
    plannerStore.actions.upsertProjects([])

    expect(plannerStore.state).toBe(before)
  })
})

describe('closets', () => {
  it('adds an exterior closet with sliding doors by default', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)

    const closet = plannerStore.state.rooms.find(
      (room) => room.kind === 'closet',
    )
    expect(closet).toBeDefined()
    if (!closet) throw new Error('Closet was not added')
    expect(closet.attachment).toMatchObject({
      roomId: 'room-1',
      wall: 0,
      t: 0.5,
    })
    expect(closet.points.slice(0, 2).every((point) => point.y === 0)).toBe(true)
    expect(closet.points.slice(2).every((point) => point.y < 0)).toBe(true)

    const opening = plannerStore.state.openings.find(
      (candidate) => candidate.id === closet.attachment?.openingId,
    )
    expect(opening).toMatchObject({
      kind: 'sliding-door',
      roomId: closet.id,
      wall: 0,
      t: 0.5,
    })
    expect(plannerStore.state.selection).toEqual({
      type: 'room',
      id: closet.id,
    })
  })

  it('resizes the closet and fits its opening to the shared wall', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)
    const closet = plannerStore.state.rooms.find(
      (room) => room.kind === 'closet',
    )!

    plannerStore.actions.updateCloset(closet.id, { width: 120, depth: 80 })

    const resized = plannerStore.state.rooms.find(
      (room) => room.id === closet.id,
    )!
    expect(closetSize(resized)).toEqual({ width: 120, depth: 80 })
    expect(
      plannerStore.state.openings.find(
        (opening) => opening.id === resized.attachment?.openingId,
      )?.width,
    ).toBe(120)
  })

  it('follows its host room and is deleted with it', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)
    const before = plannerStore.state.rooms.find(
      (room) => room.kind === 'closet',
    )!
    expect(snapTargets(plannerStore.state.rooms, 'room-1')).toEqual({
      xs: [],
      ys: [],
    })

    const host = plannerStore.state.rooms.find((room) => room.id === 'room-1')!
    plannerStore.actions.updateRoom('room-1', {
      points: translatePolygon(host.points, 100, 50),
    })
    const moved = plannerStore.state.rooms.find(
      (room) => room.id === before.id,
    )!
    expect(moved.points).toEqual(translatePolygon(before.points, 100, 50))

    plannerStore.actions.select({ type: 'room', id: 'room-1' })
    plannerStore.actions.deleteSelected()
    expect(plannerStore.state.rooms).toEqual([])
    expect(plannerStore.state.openings).toEqual([])
  })
})
