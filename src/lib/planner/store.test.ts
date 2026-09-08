import {
  closeWallPoints,
  polygonBounds,
  scalePolygon,
  slideWall,
  translatePolygon,
} from '#/lib/planner/geometry.ts'
import { beforeEach, describe, expect, it } from 'bun:test'

import { currentProjects, plannerStore } from './store.ts'
import { closetSize, placeCloset } from './closets.ts'
import { enclosuresOf } from './enclosures.ts'
import { openingEnds, openingWall, wallAt } from './openings.ts'
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

function connectedRectangle(): Project {
  const run: Project['walls'][number] = {
    id: 'room-rect',
    name: 'Living',
    points: closeWallPoints([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ]),
  }
  const neighbour: Project['walls'][number] = {
    id: 'room-neighbour',
    name: 'Study',
    points: closeWallPoints([
      { x: 0, y: -200 },
      { x: 400, y: -200 },
      { x: 400, y: 0 },
      { x: 0, y: 0 },
    ]),
  }
  const hostWall = wallAt(run.points, 0)!
  const placed = placeCloset(
    hostWall,
    { runId: run.id, wall: 0, t: 0.7 },
    100,
    60,
  )
  const closet: Project['walls'][number] = {
    id: 'closet-rect',
    kind: 'closet',
    name: 'Coats',
    points: placed.points,
    attachment: placed.attachment,
  }

  return {
    spaces: [],
    id: PLAN_C,
    name: 'Connected rooms',
    walls: [run, neighbour, closet],
    furniture: [],
    openings: [
      {
        id: 'door-host',
        kind: 'door',
        runId: run.id,
        wall: 0,
        t: 0.25,
        width: 90,
        hinge: 'start',
        swing: 'in',
      },
      {
        id: 'window-neighbour',
        kind: 'window',
        runId: neighbour.id,
        wall: 2,
        t: 0.5,
        width: 80,
        hinge: 'start',
        swing: 'in',
      },
      {
        id: 'door-closet',
        kind: 'sliding-door',
        runId: closet.id,
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
  // The pointer tool outlives a plan being closed, so it is put back by hand:
  // a test that reaches for `edit` must not leave it there for the next one.
  plannerStore.actions.setTool('move')
  plannerStore.actions.setCollide(true)
  plannerStore.actions.setUnits('metric')
  plannerStore.actions.setCustomFurniturePresets([])
  plannerStore.actions.loadLibrary({
    version: 1,
    projects: [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House')],
  })
})

describe('the pointer tools', () => {
  beforeEach(() => plannerStore.actions.openProject(PLAN_A))

  it('starts on move, so nothing is resized by a slip of the hand', () => {
    expect(plannerStore.state.tool).toBe('move')
  })

  it('hands a drawing tool back to whichever pointer tool was in hand', () => {
    plannerStore.actions.setTool('edit')
    plannerStore.actions.setTool('run')
    expect(plannerStore.state.pointerTool).toBe('edit')

    plannerStore.actions.addDraftPoint({ x: 0, y: 0 })
    plannerStore.actions.addDraftPoint({ x: 400, y: 0 })
    plannerStore.actions.addDraftPoint({ x: 400, y: 300 })
    plannerStore.actions.commitDraft()

    expect(plannerStore.state.tool).toBe('edit')
  })

  it('puts a drawing tool down without disturbing the pointer it comes back to', () => {
    plannerStore.actions.setTool('run')
    plannerStore.actions.addDraftPoint({ x: 0, y: 0 })

    plannerStore.actions.putToolDown()

    expect(plannerStore.state.tool).toBe('move')
    expect(plannerStore.state.draft).toBeNull()
  })

  it('remembers the pointer tool across a plan being opened', () => {
    plannerStore.actions.setTool('edit')
    plannerStore.actions.openProject(PLAN_B)

    expect(plannerStore.state.tool).toBe('edit')
  })
})

describe('furniture catalogue', () => {
  beforeEach(() => plannerStore.actions.openProject(PLAN_A))

  it('puts down an unfinished outline when adding furniture', () => {
    plannerStore.actions.setTool('run')
    plannerStore.actions.addDraftPoint({ x: 20, y: 20 })
    plannerStore.actions.addDraftPoint({ x: 180, y: 20 })
    plannerStore.actions.addFurniture('desk')

    expect(plannerStore.state.tool).toBe('move')
    expect(plannerStore.state.draft).toBeNull()
    expect(plannerStore.state.rect).toBeNull()
    expect(plannerStore.state.selection?.type).toBe('furniture')
    plannerStore.actions.undo()
    expect(plannerStore.state.furniture).toHaveLength(0)
  })

  it('clears an unfinished outline when adding a custom preset', () => {
    plannerStore.actions.addFurniture('desk')
    const presetId = plannerStore.actions.saveFurniturePreset(
      plannerStore.state.furniture[0].id,
    )!
    plannerStore.actions.setTool('run')
    plannerStore.actions.addDraftPoint({ x: 20, y: 20 })
    plannerStore.actions.addCustomFurniture(presetId)

    expect(plannerStore.state.draft).toBeNull()
    expect(plannerStore.state.tool).toBe('move')
    expect(plannerStore.state.furniture).toHaveLength(2)
  })

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

  it('adds a measured footprint as one undoable plan item', () => {
    plannerStore.actions.setSize(800, 600)
    plannerStore.actions.setViewport({ tx: 0, ty: 0, scale: 1 })

    plannerStore.actions.addFurnitureFootprint({
      name: 'KIVIK 3-seat sofa',
      kind: 'sofa',
      w: 228,
      h: 95,
      collides: true,
    })

    const item = plannerStore.state.furniture[0]
    expect(item).toMatchObject({
      name: 'KIVIK 3-seat sofa',
      kind: 'sofa',
      w: 228,
      h: 95,
      rotation: 0,
      collides: true,
    })
    expect(typeof item.id).toBe('string')
    expect(plannerStore.state.selection).toEqual({
      type: 'furniture',
      id: item.id,
    })
    expect(plannerStore.state.history.past.at(-1)?.text).toBe(
      'Added KIVIK 3-seat sofa',
    )

    plannerStore.actions.undo()
    expect(plannerStore.state.furniture).toEqual([])
  })

  it('adds a whole AI import — rooms and furniture — as one undoable step', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [{ ...plan(PLAN_A, 'Flat'), walls: [] }],
    })
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.setSize(800, 600)
    plannerStore.actions.setViewport({ tx: 0, ty: 0, scale: 1 })

    plannerStore.actions.addPlanImport({
      rooms: [
        { name: 'Living room', w: 450, h: 380, x: 0, y: 0 },
        { name: 'Kitchen', w: 300, h: 380, x: 450, y: 0 },
      ],
      furniture: [
        { name: 'KIVIK sofa', kind: 'sofa', w: 228, h: 95, collides: true },
        { name: 'Dining table', kind: 'table', w: 140, h: 80, collides: true },
      ],
    })

    const walls = plannerStore.state.walls
    expect(plannerStore.state.spaces.map((space) => space.name)).toEqual([
      'Living room',
      'Kitchen',
    ])
    // Every imported room lands unlocked, ready to be put where it belongs,
    // and the two the response placed side by side stay side by side.
    expect(walls.some((run) => run.locked)).toBe(false)
    const [living, kitchen] = walls.map((run) => polygonBounds(run.points))
    expect(living.w).toBe(450)
    expect(kitchen.x).toBe(living.x + living.w)
    expect(kitchen.y).toBe(living.y)

    const furniture = plannerStore.state.furniture
    expect(furniture.map((item) => item.name)).toEqual([
      'KIVIK sofa',
      'Dining table',
    ])
    expect(plannerStore.state.selection).toEqual({
      type: 'furniture',
      id: furniture[1].id,
    })
    expect(plannerStore.state.tool).toBe('move')
    expect(plannerStore.state.history.past.at(-1)?.text).toBe(
      'Added 2 rooms and 2 pieces of furniture',
    )

    plannerStore.actions.undo()
    expect(plannerStore.state.walls).toEqual([])
    expect(plannerStore.state.furniture).toEqual([])
  })

  it('renames an imported room that clashes and selects a room-only import', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [plan(PLAN_A, 'Flat', 'Living room')],
    })
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.setSize(800, 600)
    plannerStore.actions.setViewport({ tx: 0, ty: 0, scale: 1 })

    plannerStore.actions.addPlanImport({
      rooms: [{ name: 'Living room', w: 400, h: 300 }],
      furniture: [],
    })

    expect(plannerStore.state.spaces.at(-1)?.name).toBe('Living room copy')
    expect(plannerStore.state.selection).toEqual({
      type: 'enclosure',
      id: enclosuresOf(
        plannerStore.state.walls,
        plannerStore.state.spaces,
      ).find((floor) => floor.space?.name === 'Living room copy')!.key,
    })
    expect(plannerStore.state.history.past.at(-1)?.text).toBe('Added 1 room')
  })

  it('allows soft footprints to overlap while solid furniture stays apart', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [{ ...plan(PLAN_A, 'Flat'), walls: [] }],
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

  it('moves freely during a drag and settles an overlapping drop', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [
        {
          ...plan(PLAN_A, 'Flat'),
          walls: [],
          furniture: [
            {
              id: 'table',
              kind: 'table',
              name: 'Table',
              x: 100,
              y: 100,
              w: 100,
              h: 100,
              rotation: 0,
              collides: true,
            },
            {
              id: 'sofa',
              kind: 'sofa',
              name: 'Sofa',
              x: 300,
              y: 100,
              w: 100,
              h: 100,
              rotation: 0,
              collides: true,
            },
            {
              id: 'chair',
              kind: 'chair',
              name: 'Chair',
              x: 600,
              y: 100,
              w: 100,
              h: 100,
              rotation: 0,
              collides: true,
            },
          ],
        },
      ],
    })
    plannerStore.actions.openProject(PLAN_A)

    const origin = plannerStore.state.furniture[0]
    plannerStore.actions.previewFurnitureMove('table', 300, 100)
    expect(plannerStore.state.furniture[0]).toMatchObject({ x: 300, y: 100 })

    plannerStore.actions.finishFurnitureTransform('table', origin)
    expect(plannerStore.state.furniture[0].x).toBeCloseTo(200, 3)
    expect(plannerStore.state.furniture[0].y).toBeCloseTo(100, 3)

    const secondOrigin = plannerStore.state.furniture[0]
    plannerStore.actions.previewFurnitureMove('table', 600, 100)
    plannerStore.actions.finishFurnitureTransform('table', secondOrigin)
    expect(plannerStore.state.furniture[0].x).toBeCloseTo(500, 3)
  })

  it('keeps a clear drop after moving through another object', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [
        {
          ...plan(PLAN_A, 'Flat'),
          walls: [],
          furniture: [
            {
              id: 'table',
              kind: 'table',
              name: 'Table',
              x: 100,
              y: 100,
              w: 100,
              h: 100,
              rotation: 0,
              collides: true,
            },
            {
              id: 'sofa',
              kind: 'sofa',
              name: 'Sofa',
              x: 300,
              y: 100,
              w: 100,
              h: 100,
              rotation: 0,
              collides: true,
            },
          ],
        },
      ],
    })
    plannerStore.actions.openProject(PLAN_A)

    const origin = plannerStore.state.furniture[0]
    plannerStore.actions.previewFurnitureMove('table', 500, 100)
    plannerStore.actions.finishFurnitureTransform('table', origin)

    expect(plannerStore.state.furniture[0]).toMatchObject({ x: 500, y: 100 })
  })

  it('previews a turn freely and resolves its collision only when finished', () => {
    plannerStore.actions.closeProject()
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [
        {
          ...plan(PLAN_A, 'Flat'),
          walls: [],
          furniture: [
            {
              id: 'desk',
              kind: 'desk',
              name: 'Desk',
              x: 100,
              y: 100,
              w: 100,
              h: 50,
              rotation: 0,
              collides: true,
            },
            {
              id: 'chair',
              kind: 'chair',
              name: 'Chair',
              x: 100,
              y: 165,
              w: 50,
              h: 50,
              rotation: 0,
              collides: true,
            },
          ],
        },
      ],
    })
    plannerStore.actions.openProject(PLAN_A)

    const origin = plannerStore.state.furniture[0]
    plannerStore.actions.previewFurnitureRotation('desk', 90)

    expect(plannerStore.state.furniture[0].rotation).toBe(90)

    plannerStore.actions.finishFurnitureTransform('desk', origin)

    expect(plannerStore.state.furniture[0].rotation).toBeGreaterThan(0)
    expect(plannerStore.state.furniture[0].rotation).toBeLessThan(90)
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
    expect(plannerStore.state.walls[0].name).toBe('Living')
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

    expect(plannerStore.state.walls[0].name).toBe('Bedroom')
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
    expect(plannerStore.state.walls[0].name).toBe('Bedroom')
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
    expect(plannerStore.state.walls[0].name).toBe('Bedroom')
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
          walls: [{ id: 'bad', name: 'Bad', points: closeWallPoints([]) }],
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

    const closet = plannerStore.state.walls.find((run) => run.kind === 'closet')
    expect(closet).toBeDefined()
    if (!closet) throw new Error('Closet was not added')
    expect(closet.attachment).toEqual({
      runId: 'room-1',
      wall: 0,
      t: 0.5,
    })
    expect(closet.points.slice(0, 2).every((point) => point.y === 0)).toBe(true)
    expect(closet.points.slice(2, 4).every((point) => point.y < 0)).toBe(true)

    const opening = plannerStore.state.openings.find(
      (candidate) => candidate.runId === closet.id,
    )
    expect(opening).toMatchObject({
      kind: 'sliding-door',
      runId: closet.id,
      wall: 0,
      t: 0.5,
    })
    expect(plannerStore.state.selection).toEqual({
      type: 'run',
      id: closet.id,
    })
  })

  it('stays open when its independently selectable door is removed', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)
    const closet = plannerStore.state.walls.find(
      (run) => run.kind === 'closet',
    )!
    const door = plannerStore.state.openings.find(
      (opening) => opening.runId === closet.id,
    )!

    plannerStore.actions.select({ type: 'opening', id: door.id })
    plannerStore.actions.deleteSelected()

    expect(plannerStore.state.walls).toContainEqual(closet)
    expect(plannerStore.state.openings).toEqual([])
    expect(wallGaps(plannerStore.state.walls, [], closet.id, 0)).toContainEqual(
      [0, 1],
    )
    expect(wallGaps(plannerStore.state.walls, [], 'room-1', 0)).toContainEqual([
      0.275, 0.725,
    ])
  })

  it('resizes the closet and fits the door riding on its front', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)
    const closet = plannerStore.state.walls.find(
      (run) => run.kind === 'closet',
    )!

    plannerStore.actions.updateCloset(closet.id, { width: 120, depth: 80 })

    const resized = plannerStore.state.walls.find(
      (run) => run.id === closet.id,
    )!
    expect(closetSize(resized)).toEqual({ width: 120, depth: 80 })
    expect(
      plannerStore.state.openings.find(
        (opening) => opening.runId === resized.id,
      )?.width,
    ).toBe(120)
  })

  it('follows its host room and is deleted with it', () => {
    plannerStore.actions.openProject(PLAN_A)
    plannerStore.actions.addCloset('room-1', 0, 0.5)
    const before = plannerStore.state.walls.find(
      (run) => run.kind === 'closet',
    )!
    expect(snapTargets(plannerStore.state.walls, 'room-1')).toEqual({
      xs: [],
      ys: [],
    })

    const host = plannerStore.state.walls.find((run) => run.id === 'room-1')!
    plannerStore.actions.updateRun('room-1', {
      points: translatePolygon(host.points, 100, 50),
    })
    const moved = plannerStore.state.walls.find((run) => run.id === before.id)!
    expect(moved.points).toEqual(translatePolygon(before.points, 100, 50))

    plannerStore.actions.select({ type: 'run', id: 'room-1' })
    plannerStore.actions.deleteSelected()
    expect(plannerStore.state.walls).toEqual([])
    expect(plannerStore.state.openings).toEqual([])
  })
})

describe('exact wall dimensions', () => {
  it('keeps a rectangle wall, its neighbour, openings, and closet connected', () => {
    const project = connectedRectangle()
    plannerStore.actions.loadLibrary({ version: 1, projects: [project] })
    plannerStore.actions.openProject(project.id)
    plannerStore.actions.select({ type: 'wall', id: 'room-rect', index: 0 })
    const before = plannerStore.state.walls

    const result = plannerStore.actions.setWallDimensions('room-rect', 0, {
      length: 500,
    })

    expect(result).toEqual({ ok: true })
    const run = plannerStore.state.walls.find(
      (candidate) => candidate.id === 'room-rect',
    )!
    const neighbour = plannerStore.state.walls.find(
      (candidate) => candidate.id === 'room-neighbour',
    )!
    const closet = plannerStore.state.walls.find(
      (candidate) => candidate.id === 'closet-rect',
    )!
    expect(wallAt(run.points, 0)?.length).toBeCloseTo(500, 8)
    expect(wallAt(neighbour.points, 2)?.length).toBeCloseTo(500, 8)
    expect(
      sharedWalls(plannerStore.state.walls, run.id, 0).some(
        (share) => share.runId === neighbour.id && share.wall === 2,
      ),
    ).toBe(true)
    expect(closetSize(closet)).toEqual({ width: 100, depth: 60 })
    // The wall grew from 400 to 500 past everything standing on it: the
    // closet's centre stays at 280 cm from the corner that did not move.
    expect(closet.attachment).toMatchObject({
      runId: run.id,
      wall: 0,
      t: 0.56,
    })
    expect(
      plannerStore.state.openings.map(({ id, runId, wall, t, width }) => ({
        id,
        runId,
        wall,
        t,
        width,
      })),
    ).toEqual([
      {
        id: 'door-host',
        runId: run.id,
        wall: 0,
        t: 0.2,
        width: 90,
      },
      {
        id: 'window-neighbour',
        runId: neighbour.id,
        wall: 2,
        t: 0.6,
        width: 80,
      },
      {
        id: 'door-closet',
        runId: closet.id,
        wall: 0,
        t: 0.5,
        width: 100,
      },
    ])
    expect(plannerStore.state.history.past).toHaveLength(1)

    plannerStore.actions.undo()
    expect(plannerStore.state.walls).toEqual(before)
    expect(plannerStore.state.selection).toEqual({
      type: 'wall',
      id: 'room-rect',
      index: 0,
    })

    plannerStore.actions.redo()
    const redone = plannerStore.state.walls.find(
      (candidate) => candidate.id === 'room-rect',
    )!
    expect(wallAt(redone.points, 0)?.length).toBeCloseTo(500, 8)
    expect(plannerStore.state.history.past).toHaveLength(1)
  })

  it('rejects an irregular-room edit that cannot preserve its opening', () => {
    const project: Project = {
      spaces: [],
      id: PLAN_C,
      name: 'Irregular room',
      walls: [
        {
          id: 'room-irregular',
          name: 'Loft',
          points: closeWallPoints([
            { x: 0, y: 0 },
            { x: 280, y: 0 },
            { x: 360, y: 120 },
            { x: 230, y: 260 },
            { x: 40, y: 190 },
          ]),
        },
      ],
      furniture: [],
      openings: [
        {
          id: 'wide-window',
          kind: 'window',
          runId: 'room-irregular',
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

/** A room with a canted corner, a window on the wall beside it, and a neighbour. */
function cantedRun(): Project {
  return {
    spaces: [],
    id: PLAN_C,
    name: 'Canted plan',
    walls: [
      {
        id: 'room-canted',
        name: 'Living',
        points: closeWallPoints([
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 200 },
          { x: 300, y: 300 },
          { x: 0, y: 300 },
        ]),
      },
      {
        id: 'room-study',
        name: 'Study',
        points: closeWallPoints([
          { x: 0, y: -200 },
          { x: 400, y: -200 },
          { x: 400, y: 0 },
          { x: 0, y: 0 },
        ]),
      },
      {
        // Sits against the cant, so its wall 2 and the canted room's wall 2
        // are the two leaves of one party wall.
        id: 'room-nook',
        name: 'Nook',
        points: closeWallPoints([
          { x: 400, y: 200 },
          { x: 400, y: 300 },
          { x: 300, y: 300 },
        ]),
      },
    ],
    furniture: [],
    openings: [
      {
        id: 'window-side',
        kind: 'window',
        runId: 'room-canted',
        wall: 1,
        t: 0.5,
        width: 80,
        hinge: 'start',
        swing: 'in',
      },
      {
        id: 'window-nook',
        kind: 'window',
        runId: 'room-nook',
        wall: 2,
        t: 0.5,
        width: 80,
        hinge: 'start',
        swing: 'in',
      },
      {
        // Cut into the canted room's side of the party wall, and therefore a
        // hole through the nook's side of it too.
        id: 'door-cant',
        kind: 'door',
        runId: 'room-canted',
        wall: 2,
        t: 0.25,
        width: 60,
        hinge: 'start',
        swing: 'in',
      },
    ],
  }
}

function openCanted() {
  const project = cantedRun()
  plannerStore.actions.loadLibrary({ version: 1, projects: [project] })
  plannerStore.actions.openProject(project.id)
}

describe('locked rooms', () => {
  beforeEach(() => {
    plannerStore.actions.openProject(PLAN_A)
  })

  it('leaves a room unlocked as it is drawn', () => {
    plannerStore.actions.beginRect({ x: 0, y: 0 })
    plannerStore.actions.updateRect({ x: 200, y: 100 })
    plannerStore.actions.commitRect()

    const drawn = plannerStore.state.walls.at(-1)!
    expect(drawn.locked).not.toBe(true)
  })

  it('holds its outline and itself until it is unlocked', () => {
    plannerStore.actions.setRunLocked('room-1', true)
    const before = plannerStore.state.walls[0]

    plannerStore.actions.updateRun('room-1', {
      points: translatePolygon(before.points, 100, 50),
    })
    plannerStore.actions.moveVertex('room-1', 0, { x: 50, y: 50 })
    plannerStore.actions.nudgeSelection(10, 0)
    plannerStore.actions.select({ type: 'run', id: 'room-1' })
    plannerStore.actions.deleteSelected()

    expect(plannerStore.state.walls[0].points).toEqual(before.points)
    expect(plannerStore.state.walls).toHaveLength(1)

    // A rename still goes through, and so does the outline once it is let go.
    plannerStore.actions.updateRun('room-1', { name: 'Kitchen' })
    expect(plannerStore.state.walls[0].name).toBe('Kitchen')

    plannerStore.actions.setRunLocked('room-1', false)
    plannerStore.actions.updateRun('room-1', {
      points: translatePolygon(before.points, 100, 50),
    })
    expect(plannerStore.state.walls[0].points).toEqual(
      translatePolygon(before.points, 100, 50),
    )
  })
})

describe('locked spaces the walls close in', () => {
  const PLAN_WALLED = '44444444-4444-4444-8444-444444444444'

  /** A drawn room, and a run out from its left wall and back onto it. */
  function walledInSpace(): Project {
    return {
      id: PLAN_WALLED,
      name: 'Walled in',
      spaces: [],
      furniture: [],
      openings: [],
      walls: [
        {
          id: 'room-main',
          name: 'Living',
          points: closeWallPoints([
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
            { x: 0, y: 300 },
          ]),
        },
        {
          id: 'run-1',
          name: 'Walls 1',

          points: [
            { x: 0, y: 0 },
            { x: -200, y: 0 },
            { x: -200, y: 150 },
            { x: 0, y: 150 },
          ],
        },
      ],
    }
  }

  beforeEach(() => {
    plannerStore.actions.loadLibrary({
      version: 1,
      projects: [walledInSpace()],
    })
    plannerStore.actions.openProject(PLAN_WALLED)
  })

  const spaceKey = () =>
    enclosuresOf(plannerStore.state.walls, plannerStore.state.spaces).find(
      (floor) => floor.centre.x < 0,
    )!.key

  it('holds every run that closes the space in, and lets them all go again', () => {
    const key = spaceKey()

    plannerStore.actions.setEnclosureLocked(key, true)

    expect(plannerStore.state.walls.map((run) => run.locked)).toEqual([
      true,
      true,
    ])
    expect(plannerStore.state.history.past.at(-1)?.text).toBe(
      'Locked Unnamed room',
    )

    // The space is still the same space: neither run would move.
    plannerStore.actions.moveVertex('run-1', 1, { x: -300, y: 0 })
    plannerStore.actions.moveVertex('room-main', 3, { x: 0, y: 400 })
    expect(spaceKey()).toBe(key)

    plannerStore.actions.setEnclosureLocked(key, false)

    expect(plannerStore.state.walls.some((run) => run.locked)).toBe(false)
    plannerStore.actions.moveVertex('run-1', 1, { x: -300, y: 0 })
    expect(spaceKey()).not.toBe(key)
  })

  it('names the space it holds in the history when the space has a name', () => {
    const key = spaceKey()
    plannerStore.actions.updateEnclosure(key, { name: 'Pantry' })

    plannerStore.actions.setEnclosureLocked(spaceKey(), true)

    expect(plannerStore.state.history.past.at(-1)?.text).toBe('Locked Pantry')
  })

  it('leaves the plan alone when the space is already held', () => {
    plannerStore.actions.setEnclosureLocked(spaceKey(), true)
    const before = plannerStore.state

    plannerStore.actions.setEnclosureLocked(spaceKey(), true)

    expect(plannerStore.state).toBe(before)
  })

  it('changes nothing for a key no space answers to any more', () => {
    const before = plannerStore.state

    plannerStore.actions.setEnclosureLocked('not a space', true)

    expect(plannerStore.state).toBe(before)
  })
})

describe('the style brush', () => {
  beforeEach(() => plannerStore.actions.openProject(PLAN_A))

  /** Two items, the first coloured, both of them selectable by id. */
  function pair(): [string, string] {
    plannerStore.actions.addFurniture('chair')
    const source = plannerStore.state.furniture.at(-1)!.id
    plannerStore.actions.addFurniture('table')
    const target = plannerStore.state.furniture.at(-1)!.id
    plannerStore.actions.updateFurniture(source, { color: '#ff0000' })
    plannerStore.actions.sealHistory()
    return [source, target]
  }

  const colorOf = (id: string) =>
    plannerStore.state.furniture.find((item) => item.id === id)?.color

  it('carries one colour onto another item and is spent there', () => {
    const [source, target] = pair()
    plannerStore.actions.select({ type: 'furniture', id: source })

    plannerStore.actions.pickUpStyle(source)
    expect(plannerStore.state.brush).toEqual({
      color: '#ff0000',
      sticky: false,
    })

    plannerStore.actions.paintFurniture(target)

    expect(colorOf(target)).toBe('#ff0000')
    // Spent on the one item, and the selection left where it was: the panel
    // goes on describing what the colour came from.
    expect(plannerStore.state.brush).toBeNull()
    expect(plannerStore.state.selection).toEqual({
      type: 'furniture',
      id: source,
    })
    expect(plannerStore.state.history.past.at(-1)?.text).toBe(
      'Recoloured Table 1',
    )

    plannerStore.actions.undo()
    expect(colorOf(target)).toBeUndefined()
  })

  it('stays in hand while it is held down, and paints each item its own step', () => {
    const [source, target] = pair()
    plannerStore.actions.addFurniture('chair')
    const third = plannerStore.state.furniture.at(-1)!.id

    plannerStore.actions.pickUpStyle(source, true)
    plannerStore.actions.paintFurniture(target)
    expect(plannerStore.state.brush).toEqual({ color: '#ff0000', sticky: true })
    plannerStore.actions.paintFurniture(third)

    expect(colorOf(target)).toBe('#ff0000')
    expect(colorOf(third)).toBe('#ff0000')

    // Each item painted comes back on its own.
    plannerStore.actions.undo()
    expect(colorOf(third)).toBeUndefined()
    expect(colorOf(target)).toBe('#ff0000')

    plannerStore.actions.dropStyle()
    expect(plannerStore.state.brush).toBeNull()
  })

  /* The default colour is a colour too: the brush paints a plain item back. */
  it('carries the default colour as readily as a chosen one', () => {
    const [source, target] = pair()
    plannerStore.actions.updateFurniture(target, { color: '#00ff00' })
    plannerStore.actions.sealHistory()

    plannerStore.actions.pickUpStyle(target)
    plannerStore.actions.paintFurniture(source)
    expect(colorOf(source)).toBe('#00ff00')

    plannerStore.actions.addFurniture('box')
    const plain = plannerStore.state.furniture.at(-1)!.id
    plannerStore.actions.pickUpStyle(plain)
    plannerStore.actions.paintFurniture(source)

    expect(colorOf(source)).toBeUndefined()
  })

  it('comes back to the pointer tool, and is put down by reaching for another', () => {
    const [source] = pair()
    plannerStore.actions.setTool('edit')
    plannerStore.actions.setTool('run')

    plannerStore.actions.pickUpStyle(source)
    expect(plannerStore.state.tool).toBe('edit')

    plannerStore.actions.setTool('rect')
    expect(plannerStore.state.brush).toBeNull()
  })

  it('is put down when another plan is opened', () => {
    const [source] = pair()
    plannerStore.actions.pickUpStyle(source, true)

    plannerStore.actions.openProject(PLAN_B)

    expect(plannerStore.state.brush).toBeNull()
  })
})

describe('a room made bigger', () => {
  const ROOM = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ]

  function opened(): Project {
    return {
      spaces: [],
      id: PLAN_C,
      name: 'Openings',
      walls: [{ id: 'room-1', name: 'Living', points: closeWallPoints(ROOM) }],
      furniture: [],
      openings: [
        {
          id: 'window-top',
          kind: 'window',
          runId: 'room-1',
          wall: 0,
          t: 0.25,
          width: 100,
          hinge: 'start',
          swing: 'in',
        },
        {
          id: 'door-right',
          kind: 'door',
          runId: 'room-1',
          wall: 1,
          t: 0.5,
          width: 90,
          hinge: 'start',
          swing: 'in',
        },
      ],
    }
  }

  /** Where an opening's centre actually stands in the plan. */
  function centreOf(id: string) {
    const opening = plannerStore.state.openings.find((o) => o.id === id)!
    const wall = openingWall(plannerStore.state.walls, opening)!
    const { centre } = openingEnds(wall, opening)
    return {
      x: Math.round(centre.x * 1e6) / 1e6,
      y: Math.round(centre.y * 1e6) / 1e6,
    }
  }

  beforeEach(() => {
    plannerStore.actions.loadLibrary({ version: 1, projects: [opened()] })
    plannerStore.actions.openProject(PLAN_C)
  })

  it('leaves the openings on the walls that stretched where they were put', () => {
    const run = plannerStore.state.walls[0]
    plannerStore.actions.updateRun('room-1', {
      points: scalePolygon(run.points, 600, 300),
    })

    // The top wall grew to the right past the window, which has not budged.
    expect(centreOf('window-top')).toEqual({ x: 100, y: 0 })
    // The right wall itself moved, and the door in it went with the wall.
    expect(centreOf('door-right')).toEqual({ x: 600, y: 150 })
  })

  it('holds them when a wall is pushed out', () => {
    const run = plannerStore.state.walls[0]
    plannerStore.actions.moveWall('room-1', 1, slideWall(run.points, 1, 200))

    expect(centreOf('window-top')).toEqual({ x: 100, y: 0 })
    expect(centreOf('door-right')).toEqual({ x: 600, y: 150 })
  })

  it('holds them when a corner is dragged out', () => {
    plannerStore.actions.moveVertex('room-1', 1, { x: 700, y: 0 })

    expect(centreOf('window-top')).toEqual({ x: 100, y: 0 })
  })

  it('still carries them along when the whole room is moved', () => {
    const run = plannerStore.state.walls[0]
    plannerStore.actions.updateRun('room-1', {
      points: translatePolygon(run.points, 100, 50),
    })

    expect(centreOf('window-top')).toEqual({ x: 200, y: 50 })
    expect(centreOf('door-right')).toEqual({ x: 500, y: 200 })
  })

  it('holds an attached closet on the wall that grew under it', () => {
    plannerStore.actions.addCloset('room-1', 2, 0.5)
    const closet = plannerStore.state.walls.find((r) => r.kind === 'closet')!
    const before = polygonBounds(closet.points)

    const run = plannerStore.state.walls.find((r) => r.id === 'room-1')!
    plannerStore.actions.updateRun('room-1', {
      points: scalePolygon(run.points, 600, 300),
    })

    const after = polygonBounds(
      plannerStore.state.walls.find((r) => r.id === closet.id)!.points,
    )
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.w).toBeCloseTo(before.w, 6)
  })
})

it('removes a wall directly, preserving the other walls and supporting undo', () => {
  openCanted()
  const before = plannerStore.state.walls
  const wallCount = before.reduce(
    (count, run) => count + run.points.length - 1,
    0,
  )
  expect(plannerStore.actions.removeWall('room-canted', 2)).toEqual({
    ok: true,
  })
  expect(
    plannerStore.state.walls.reduce(
      (count, run) => count + run.points.length - 1,
      0,
    ),
  ).toBe(wallCount - 2)
  plannerStore.actions.undo()
  expect(plannerStore.state.walls).toEqual(before)
})
