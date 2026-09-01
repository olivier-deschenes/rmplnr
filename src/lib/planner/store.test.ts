import { beforeEach, describe, expect, it } from 'bun:test'

import { currentProjects, plannerStore } from './store.ts'
import { closetSize, placeCloset } from './closets.ts'
import { translatePolygon } from './geometry.ts'
import { wallAt } from './openings.ts'
import {
  parseRmplnrFile,
  serializeLibraryBackup,
  serializeProject,
} from './planSerialization.ts'
import { snapTargets } from './snapping.ts'
import { sharedWalls, wallGaps } from './walls.ts'
import { FURNITURE_KINDS, FURNITURE_PRESETS } from './presets.ts'

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

function connectedRectangle(): Project {
  const room: Project['rooms'][number] = {
    id: 'room-rect',
    name: 'Living',
    points: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ],
  }
  const neighbour: Project['rooms'][number] = {
    id: 'room-neighbour',
    name: 'Study',
    points: [
      { x: 0, y: -200 },
      { x: 400, y: -200 },
      { x: 400, y: 0 },
      { x: 0, y: 0 },
    ],
  }
  const hostWall = wallAt(room.points, 0)!
  const placed = placeCloset(
    hostWall,
    { roomId: room.id, wall: 0, t: 0.7 },
    100,
    60,
  )
  const closet: Project['rooms'][number] = {
    id: 'closet-rect',
    kind: 'closet',
    name: 'Coats',
    points: placed.points,
    attachment: placed.attachment,
  }

  return {
    id: PLAN_C,
    name: 'Connected rooms',
    rooms: [room, neighbour, closet],
    furniture: [],
    openings: [
      {
        id: 'door-host',
        kind: 'door',
        roomId: room.id,
        wall: 0,
        t: 0.25,
        width: 90,
        hinge: 'start',
        swing: 'in',
      },
      {
        id: 'window-neighbour',
        kind: 'window',
        roomId: neighbour.id,
        wall: 2,
        t: 0.5,
        width: 80,
        hinge: 'start',
        swing: 'in',
      },
      {
        id: 'door-closet',
        kind: 'sliding-door',
        roomId: closet.id,
        wall: 0,
        t: 0.5,
        width: 100,
        hinge: 'start',
        swing: 'in',
      },
    ],
  }
}

beforeEach(() => {
  plannerStore.actions.closeProject()
  plannerStore.actions.setCollide(true)
  plannerStore.actions.setUnits('metric')
  plannerStore.actions.setCustomFurniturePresets([])
  plannerStore.actions.loadLibrary({
    version: 1,
    projects: [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House')],
  })
})

describe('furniture catalogue', () => {
  beforeEach(() => plannerStore.actions.openProject(PLAN_A))

  it('adds every built-in preset at its exact metric footprint', () => {
    for (const kind of FURNITURE_KINDS) {
      plannerStore.actions.addFurniture(kind)
      const item = plannerStore.state.furniture.at(-1)!
      const preset = FURNITURE_PRESETS[kind]

      expect(item).toMatchObject({
        kind,
        w: preset.w,
        h: preset.h,
        collides: preset.collides,
      })
    }

    expect(FURNITURE_KINDS).toEqual(
      expect.arrayContaining([
        'bed',
        'desk',
        'chair',
        'dresser',
        'tv',
        'appliance',
        'radiator',
        'column',
        'rug',
      ]),
    )
    expect(FURNITURE_PRESETS).toMatchObject({
      bed: { w: 150, h: 200 },
      desk: { w: 120, h: 60 },
      chair: { w: 50, h: 50 },
      dresser: { w: 120, h: 50 },
      tv: { w: 120, h: 20 },
      appliance: { w: 60, h: 60 },
      radiator: { w: 100, h: 15 },
      column: { w: 30, h: 30 },
      rug: { w: 200, h: 300, collides: false },
    })
  })

  it('saves, renames, reuses and deletes a custom preset', () => {
    plannerStore.actions.addFurniture('desk')
    const desk = plannerStore.state.furniture[0]
    plannerStore.actions.updateFurniture(desk.id, {
      name: 'Writing desk',
      w: 135,
      h: 72,
      collides: false,
    })

    const presetId = plannerStore.actions.saveFurniturePreset(desk.id)
    expect(presetId).not.toBeNull()
    expect(plannerStore.state.customFurniturePresets[0]).toMatchObject({
      id: presetId,
      name: 'Writing desk',
      kind: 'desk',
      w: 135,
      h: 72,
      collides: false,
    })

    expect(
      plannerStore.actions.renameFurniturePreset(presetId!, 'Studio desk'),
    ).toBe(true)
    plannerStore.actions.addCustomFurniture(presetId!)

    const reused = plannerStore.state.furniture.at(-1)!
    expect(reused.id).not.toBe(presetId)
    expect(reused).toMatchObject({
      name: 'Studio desk',
      kind: 'desk',
      w: 135,
      h: 72,
      collides: false,
    })

    plannerStore.actions.deleteFurniturePreset(presetId!)
    expect(plannerStore.state.customFurniturePresets).toEqual([])
    expect(plannerStore.state.furniture).toContainEqual(reused)
  })

  it('allows soft footprints to overlap while solid furniture stays apart', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [{ ...plan(PLAN_A, 'Flat'), rooms: [] }],
    })
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.setSize(800, 600)
    plannerStore.actions.setViewport({ tx: 0, ty: 0, scale: 1 })

    plannerStore.actions.addFurniture('rug')
    plannerStore.actions.addFurniture('table')
    const [rug, table] = plannerStore.state.furniture
    expect({ x: table.x, y: table.y }).toEqual({ x: rug.x, y: rug.y })

    plannerStore.actions.addFurniture('sofa')
    const sofa = plannerStore.state.furniture[2]
    expect({ x: sofa.x, y: sofa.y }).not.toEqual({ x: table.x, y: table.y })

    plannerStore.actions.updateFurniture(table.id, { collides: false })
    plannerStore.actions.updateFurniture(table.id, { x: sofa.x, y: sofa.y })
    expect(plannerStore.state.furniture[1]).toMatchObject({
      x: sofa.x,
      y: sofa.y,
      collides: false,
    })
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

describe('project names', () => {
  beforeEach(() => plannerStore.actions.openProject(PLAN_A))

  it('trims a valid name and keeps it when a blank rename is attempted', () => {
    plannerStore.actions.renameProject('  Main floor  ')
    plannerStore.actions.renameProject('   ')

    expect(currentProjects(plannerStore.state)[0].name).toBe('Main floor')
  })
})

describe('responsive canvas framing', () => {
  beforeEach(() => {
    plannerStore.actions.setSize(1000, 800)
    plannerStore.actions.openProject(PLAN_A)
  })

  it('re-fits the plan when the canvas changes size', () => {
    plannerStore.actions.panBy(73, -41)
    plannerStore.actions.setSize(600, 400)
    const resized = plannerStore.state.viewport

    plannerStore.actions.panBy(20, 30)
    plannerStore.actions.fit()

    expect(plannerStore.state.size).toEqual({ width: 600, height: 400 })
    expect(plannerStore.state.viewport).toEqual(resized)
  })

  it('keeps the current view for a duplicate resize notification', () => {
    plannerStore.actions.setSize(600, 400)
    plannerStore.actions.panBy(50, 25)
    const moved = plannerStore.state.viewport

    plannerStore.actions.setSize(600, 400)

    expect(plannerStore.state.viewport).toEqual(moved)
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

describe('JSON import and restore', () => {
  it('imports one exported plan into an empty library', () => {
    plannerStore.actions.loadLibrary({ version: 1, projects: [] })
    const parsed = parseRmplnrFile(
      serializeProject(plan(PLAN_C, 'Imported plan')),
    )
    if (parsed.kind !== 'project') throw new Error('Expected one plan')

    const id = plannerStore.actions.importProject(parsed.project, 'replace')

    expect(id).toBe(PLAN_C)
    expect(currentProjects(plannerStore.state)).toEqual([parsed.project])
  })

  it('replaces a duplicate plan under the same id', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addFurniture('table')
    const incoming = plan(PLAN_A, 'Flat from file', 'Bedroom')

    const id = plannerStore.actions.importProject(incoming, 'replace')

    expect(id).toBe(PLAN_A)
    expect(currentProjects(plannerStore.state)).toHaveLength(2)
    expect(plannerStore.state.rooms[0].name).toBe('Bedroom')
    expect(plannerStore.state.furniture).toEqual([])
    expect(plannerStore.state.history.past).toEqual([])
  })

  it('keeps a duplicate as a copy with a fresh id', () => {
    const imported = plannerStore.actions.importProject(
      plan(PLAN_A, 'Flat'),
      'copy',
    )
    const projects = currentProjects(plannerStore.state)

    expect(imported).not.toBe(PLAN_A)
    expect(projects).toHaveLength(3)
    expect(projects.find((project) => project.id === imported)?.name).toBe(
      'Flat copy',
    )
    expect(projects.filter((project) => project.id === PLAN_A)).toHaveLength(1)
  })

  it('restores the complete backup in its original order and with its ids', () => {
    const backup = parseRmplnrFile(
      serializeLibraryBackup([
        plan(PLAN_C, 'Cabin'),
        plan(PLAN_A, 'Flat restored', 'Bedroom'),
      ]),
    )
    if (backup.kind !== 'library') throw new Error('Expected a library')
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addFurniture('sofa')

    plannerStore.actions.restoreBackup(backup.library)

    expect(currentProjects(plannerStore.state)).toEqual(backup.library.projects)
    expect(
      currentProjects(plannerStore.state).map((project) => project.id),
    ).toEqual([PLAN_C, PLAN_A])
    expect(plannerStore.state.rooms[0].name).toBe('Bedroom')
    expect(plannerStore.state.furniture).toEqual([])
    expect(plannerStore.state.history.past).toEqual([])
  })

  it('leaves every existing plan alone when validation fails', () => {
    const before = currentProjects(plannerStore.state)
    const invalid = JSON.stringify({
      schemaVersion: 1,
      kind: 'rmplnr-library',
      projects: [
        {
          schemaVersion: 1,
          id: PLAN_C,
          name: 'Broken',
          rooms: [{ id: 'bad', name: 'Bad', points: [] }],
          furniture: [],
          openings: [],
        },
      ],
    })

    expect(() => parseRmplnrFile(invalid)).toThrow(
      'not a valid rmplnr library backup',
    )
    expect(currentProjects(plannerStore.state)).toEqual(before)
  })
})

describe('closets', () => {
  it('adds an open-front closet and an independent sliding door', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)

    const closet = plannerStore.state.rooms.find(
      (room) => room.kind === 'closet',
    )
    expect(closet).toBeDefined()
    if (!closet) throw new Error('Closet was not added')
    expect(closet.attachment).toEqual({
      roomId: 'room-1',
      wall: 0,
      t: 0.5,
    })
    expect(closet.points.slice(0, 2).every((point) => point.y === 0)).toBe(true)
    expect(closet.points.slice(2).every((point) => point.y < 0)).toBe(true)

    const opening = plannerStore.state.openings.find(
      (candidate) => candidate.roomId === closet.id,
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

  it('stays open when its independently selectable door is removed', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)
    const closet = plannerStore.state.rooms.find(
      (room) => room.kind === 'closet',
    )!
    const door = plannerStore.state.openings.find(
      (opening) => opening.roomId === closet.id,
    )!

    plannerStore.actions.select({ type: 'opening', id: door.id })
    plannerStore.actions.deleteSelected()

    expect(plannerStore.state.rooms).toContainEqual(closet)
    expect(plannerStore.state.openings).toEqual([])
    expect(wallGaps(plannerStore.state.rooms, [], closet.id, 0)).toContainEqual(
      [0, 1],
    )
    expect(wallGaps(plannerStore.state.rooms, [], 'room-1', 0)).toContainEqual([
      0.275, 0.725,
    ])
  })

  it('resizes the closet and fits the door riding on its front', () => {
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
        (opening) => opening.roomId === resized.id,
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

describe('exact wall dimensions', () => {
  it('keeps a rectangle wall, its neighbour, openings, and closet connected', () => {
    const project = connectedRectangle()
    plannerStore.actions.loadLibrary({ version: 1, projects: [project] })
    plannerStore.actions.openProject(project.id)
    plannerStore.actions.select({ type: 'wall', id: 'room-rect', index: 0 })
    const before = plannerStore.state.rooms

    const result = plannerStore.actions.setWallDimensions('room-rect', 0, {
      length: 500,
    })

    expect(result).toEqual({ ok: true })
    const room = plannerStore.state.rooms.find(
      (candidate) => candidate.id === 'room-rect',
    )!
    const neighbour = plannerStore.state.rooms.find(
      (candidate) => candidate.id === 'room-neighbour',
    )!
    const closet = plannerStore.state.rooms.find(
      (candidate) => candidate.id === 'closet-rect',
    )!
    expect(wallAt(room.points, 0)?.length).toBeCloseTo(500, 8)
    expect(wallAt(neighbour.points, 2)?.length).toBeCloseTo(500, 8)
    expect(
      sharedWalls(plannerStore.state.rooms, room.id, 0).some(
        (share) => share.roomId === neighbour.id && share.wall === 2,
      ),
    ).toBe(true)
    expect(closetSize(closet)).toEqual({ width: 100, depth: 60 })
    expect(closet.attachment).toMatchObject({
      roomId: room.id,
      wall: 0,
      t: 0.7,
    })
    expect(
      plannerStore.state.openings.map(({ id, roomId, wall, t, width }) => ({
        id,
        roomId,
        wall,
        t,
        width,
      })),
    ).toEqual([
      {
        id: 'door-host',
        roomId: room.id,
        wall: 0,
        t: 0.25,
        width: 90,
      },
      {
        id: 'window-neighbour',
        roomId: neighbour.id,
        wall: 2,
        t: 0.5,
        width: 80,
      },
      {
        id: 'door-closet',
        roomId: closet.id,
        wall: 0,
        t: 0.5,
        width: 100,
      },
    ])
    expect(plannerStore.state.history.past).toHaveLength(1)

    plannerStore.actions.undo()
    expect(plannerStore.state.rooms).toEqual(before)
    expect(plannerStore.state.selection).toEqual({
      type: 'wall',
      id: 'room-rect',
      index: 0,
    })

    plannerStore.actions.redo()
    const redone = plannerStore.state.rooms.find(
      (candidate) => candidate.id === 'room-rect',
    )!
    expect(wallAt(redone.points, 0)?.length).toBeCloseTo(500, 8)
    expect(plannerStore.state.history.past).toHaveLength(1)
  })

  it('rejects an irregular-room edit that cannot preserve its opening', () => {
    const project: Project = {
      id: PLAN_C,
      name: 'Irregular room',
      rooms: [
        {
          id: 'room-irregular',
          name: 'Loft',
          points: [
            { x: 0, y: 0 },
            { x: 280, y: 0 },
            { x: 360, y: 120 },
            { x: 230, y: 260 },
            { x: 40, y: 190 },
          ],
        },
      ],
      furniture: [],
      openings: [
        {
          id: 'wide-window',
          kind: 'window',
          roomId: 'room-irregular',
          wall: 0,
          t: 0.5,
          width: 100,
          hinge: 'start',
          swing: 'in',
        },
      ],
    }
    plannerStore.actions.loadLibrary({ version: 1, projects: [project] })
    plannerStore.actions.openProject(project.id)
    plannerStore.actions.select({
      type: 'wall',
      id: 'room-irregular',
      index: 0,
    })
    const before = plannerStore.state

    const result = plannerStore.actions.setWallDimensions('room-irregular', 0, {
      length: 80,
    })

    expect(result).toEqual({
      ok: false,
      error: 'Window in Loft is wider than the edited wall.',
    })
    expect(plannerStore.state).toBe(before)
    expect(plannerStore.state.history.past).toEqual([])
  })
})

describe('locked rooms', () => {
  beforeEach(() => {
    plannerStore.actions.openProject(PLAN_A)
  })

  it('locks a room as it is drawn', () => {
    plannerStore.actions.beginRect({ x: 0, y: 0 })
    plannerStore.actions.updateRect({ x: 200, y: 100 })
    plannerStore.actions.commitRect()

    const drawn = plannerStore.state.rooms.at(-1)!
    expect(drawn.locked).toBe(true)
  })

  it('holds its outline and itself until it is unlocked', () => {
    plannerStore.actions.setRoomLocked('room-1', true)
    const before = plannerStore.state.rooms[0]

    plannerStore.actions.updateRoom('room-1', {
      points: translatePolygon(before.points, 100, 50),
    })
    plannerStore.actions.moveVertex('room-1', 0, { x: 50, y: 50 })
    plannerStore.actions.nudgeSelection(10, 0)
    plannerStore.actions.select({ type: 'room', id: 'room-1' })
    plannerStore.actions.deleteSelected()

    expect(plannerStore.state.rooms[0].points).toEqual(before.points)
    expect(plannerStore.state.rooms).toHaveLength(1)

    // A rename still goes through, and so does the outline once it is let go.
    plannerStore.actions.updateRoom('room-1', { name: 'Kitchen' })
    expect(plannerStore.state.rooms[0].name).toBe('Kitchen')

    plannerStore.actions.setRoomLocked('room-1', false)
    plannerStore.actions.updateRoom('room-1', {
      points: translatePolygon(before.points, 100, 50),
    })
    expect(plannerStore.state.rooms[0].points).toEqual(
      translatePolygon(before.points, 100, 50),
    )
  })
})
