import { beforeEach, describe, expect, it } from 'bun:test'

import { enclosuresOf, planFloors, wallLines } from './enclosures.ts'
import { closeWallPoints, rectPolygon, slideWall } from './geometry.ts'
import { placeCloset } from './closets.ts'
import { openingEnds, openingWall, runWallAt, wallAt } from './openings.ts'
import { parseProjectFile, serializeProject } from './planSerialization.ts'
import { currentProjects, plannerStore } from './store.ts'
import { LibrarySchema, PlanSchema, ProjectRecordSchema } from './types.ts'
import { removeWallGeometry } from './walls.ts'

import type { Point, Project, WallRun } from './types.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const RECT = rectPolygon({ x: 0, y: 0 }, { x: 400, y: 300 })
const actions = plannerStore.actions
const floors = () =>
  enclosuresOf(plannerStore.state.walls, plannerStore.state.spaces)
const room = {
  id: 'old-room',
  name: 'Living',
  color: '#809080',
  points: RECT,
  locked: true,
}
const door = {
  id: 'door',
  roomId: room.id,
  wall: 3,
  t: 0.25,
  width: 80,
  kind: 'door',
  hinge: 'start',
  swing: 'in',
} as const
function legacy() {
  return {
    schemaVersion: 1,
    id: ID,
    name: 'Old plan',
    rooms: [room],
    furniture: [],
    openings: [door],
  }
}
function open(walls: Array<WallRun> = []) {
  actions.closeProject()
  const project: Project = {
    id: ID,
    name: 'Plan',
    walls,
    furniture: [],
    openings: [],
    spaces: [],
  }
  actions.loadLibrary({ version: 1, projects: [project] })
  actions.openProject(ID)
}
function rectangle() {
  actions.beginRect({ x: 0, y: 0 })
  actions.updateRect({ x: 400, y: 300 })
  actions.commitRect()
  return plannerStore.state.walls[0]
}

beforeEach(() => {
  actions.closeProject()
  actions.setTool('move')
  actions.setStraightWalls(false)
  open()
})

describe('walls as the saved model', () => {
  it('draws rectangles as four explicit walls with a separate floor label', () => {
    const run = rectangle()
    expect(run.points).toEqual([...RECT, RECT[0]])
    expect(run).not.toHaveProperty('closed')
    expect(run).not.toHaveProperty('color')
    expect(floors()).toHaveLength(1)
    expect(floors()[0].space?.name).toBe('Room 1')
    expect(plannerStore.state.selection?.type).toBe('enclosure')
    const saved = JSON.parse(
      serializeProject(currentProjects(plannerStore.state)[0]),
    )
    expect(saved.schemaVersion).toBe(2)
    expect(saved).not.toHaveProperty('rooms')
    expect(saved.walls[0].points).toHaveLength(5)
  })

  it('removes any rectangle wall directly and restores it with undo', () => {
    for (const index of [0, 1, 2, 3]) {
      open()
      const run = rectangle()
      expect(actions.removeWall(run.id, index)).toEqual({ ok: true })
      expect(floors()).toHaveLength(0)
      expect(wallLines(plannerStore.state.walls)).toHaveLength(3)
      actions.undo()
      expect(floors()).toHaveLength(1)
      expect(floors()[0].space?.name).toBe('Room 1')
      actions.redo()
      expect(floors()).toHaveLength(0)
    }
  })

  it('derives two floors when an existing floor is divided', () => {
    rectangle()
    actions.addDraftPoint({ x: 200, y: 0 })
    actions.addDraftPoint({ x: 200, y: 300 })
    actions.cancelDraft()
    expect(floors().map((floor) => floor.area)).toEqual([60000, 60000])
    expect(planFloors(plannerStore.state.walls).area).toBe(120000)
    const divider = plannerStore.state.walls.at(-1)!
    actions.removeWall(divider.id, 0)
    expect(floors()).toHaveLength(1)
  })

  it('keeps an attached closet label with its walls when renamed and moved', () => {
    const run = rectangle()
    actions.addCloset(run.id, 0, 0.3)
    const closet = plannerStore.state.walls.at(-1)!
    actions.updateRun(closet.id, { name: 'Coats' })
    actions.updateCloset(closet.id, { t: 0.75 })
    expect(
      floors().filter((floor) => floor.space?.name === 'Coats'),
    ).toHaveLength(1)
    expect(
      floors().find((floor) => floor.space?.name === 'Coats')!.centre.x,
    ).toBeGreaterThan(200)
    actions.setRunLocked(closet.id, true)
    const before = plannerStore.state.walls
    actions.updateCloset(closet.id, { t: 0.25 })
    expect(plannerStore.state.walls).toEqual(before)
  })

  it('does not count nested enclosed floor area twice', () => {
    const walls = [
      { id: 'outer', name: 'Walls 1', points: closeWallPoints(RECT) },
      {
        id: 'inner',
        name: 'Walls 2',
        points: closeWallPoints(
          rectPolygon({ x: 100, y: 100 }, { x: 200, y: 200 }),
        ),
      },
    ]
    expect(planFloors(walls)).toEqual({ count: 2, area: 120000 })
    const named = enclosuresOf(walls, [
      { id: 'label', name: 'Cupboard', seed: { x: 150, y: 150 } },
    ])
    expect(named.find((floor) => floor.space)?.area).toBe(10000)
  })

  it('keeps the first and last endpoint joined while dragging and resizing walls', () => {
    const run = rectangle()
    actions.moveWall(run.id, 0, slideWall(run.points, 0, 30))
    let changed = plannerStore.state.walls[0]
    expect(changed.points[0]).toEqual(changed.points.at(-1)!)
    expect(floors()).toHaveLength(1)
    expect(actions.setWallDimensions(run.id, 3, { length: 340 }).ok).toBe(true)
    changed = plannerStore.state.walls[0]
    expect(changed.points[0]).toEqual(changed.points.at(-1)!)
    expect(floors()).toHaveLength(1)
  })

  it('moves endpoints and T junctions attached to an edited wall', () => {
    open([
      {
        id: 'across',
        name: 'Walls 1',
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
      },
      {
        id: 'corner',
        name: 'Walls 2',
        points: [
          { x: 400, y: 0 },
          { x: 400, y: 300 },
        ],
      },
      {
        id: 'branch',
        name: 'Walls 3',
        points: [
          { x: 200, y: 0 },
          { x: 200, y: -100 },
        ],
      },
    ])
    expect(actions.setWallDimensions('across', 0, { length: 500 }).ok).toBe(
      true,
    )
    expect(plannerStore.state.walls[1].points[0]).toEqual({ x: 500, y: 0 })
    expect(plannerStore.state.walls[2].points[0]).toEqual({ x: 250, y: 0 })
    actions.setRunLocked('corner', true)
    const before = plannerStore.state.walls
    expect(actions.setWallDimensions('across', 0, { length: 600 }).ok).toBe(
      false,
    )
    expect(plannerStore.state.walls).toEqual(before)
  })

  it('removes both copies of a shared wall so adjacent floors become one', () => {
    open([
      { id: 'left', name: 'Walls 1', points: closeWallPoints(RECT) },
      {
        id: 'right',
        name: 'Walls 2',
        points: closeWallPoints(
          rectPolygon({ x: 400, y: 0 }, { x: 800, y: 300 }),
        ),
      },
    ])
    expect(floors()).toHaveLength(2)
    expect(actions.removeWall('left', 1).ok).toBe(true)
    expect(floors()).toHaveLength(1)
    expect(floors()[0].area).toBe(240000)
    actions.undo()
    expect(floors()).toHaveLength(2)
    actions.setRunLocked('right', true)
    expect(actions.removeWall('left', 1).ok).toBe(false)
    expect(floors()).toHaveLength(2)
  })

  it('cuts only the shared portion of a longer wall and remaps remaining openings', () => {
    const walls = [
      {
        id: 'short',
        name: 'Walls 1',
        points: [
          { x: 100, y: 0 },
          { x: 200, y: 0 },
        ],
      },
      {
        id: 'long',
        name: 'Walls 2',
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
        ],
      },
    ]
    const opening = { ...door, runId: 'long', wall: 0, t: 0.8, width: 50 }
    const result = removeWallGeometry(walls, [opening], 'short', 0)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(wallLines(result.walls)).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 200, y: 0 }, b: { x: 400, y: 0 } },
    ])
    expect(
      openingEnds(
        openingWall(result.walls, result.openings[0])!,
        result.openings[0],
      ).centre,
    ).toEqual({ x: 320, y: 0 })
  })
})

describe('version 1 plan migration', () => {
  it('preserves geometry, labels, colour, locks and the implicit closing wall', () => {
    const migrated = parseProjectFile(JSON.stringify(legacy()))
    expect(migrated.walls[0]).toEqual({
      id: room.id,
      name: 'Walls 1',
      points: [...RECT, RECT[0]],
      locked: true,
    })
    expect(
      enclosuresOf(migrated.walls, migrated.spaces)[0].space,
    ).toMatchObject({ name: room.name, color: room.color })
    expect(migrated.openings[0].runId).toBe(room.id)
    const before = openingEnds(wallAt(RECT, 3, true)!, door)
    const after = openingEnds(
      openingWall(migrated.walls, migrated.openings[0])!,
      migrated.openings[0],
    )
    expect(after).toEqual(before)
    expect(parseProjectFile(serializeProject(migrated))).toEqual(migrated)
  })

  it('migrates browser libraries and the original single-plan format', () => {
    const { schemaVersion: _version, ...project } = legacy()
    expect(
      LibrarySchema.parse({ version: 1, projects: [project] }).projects[0]
        .walls,
    ).toHaveLength(1)
    expect(
      PlanSchema.parse({ ...project, version: 1 }).walls[0].points,
    ).toHaveLength(5)
  })

  it('preserves an unfinished run without inventing its closing wall', () => {
    const old = legacy()
    const migrated = parseProjectFile(
      JSON.stringify({
        ...old,
        rooms: [{ ...room, points: RECT.slice(0, 3), closed: false }],
      }),
    )
    expect(migrated.walls[0].points).toEqual(RECT.slice(0, 3))
    expect(enclosuresOf(migrated.walls)).toEqual([])
    expect(migrated.spaces).toEqual([])
  })

  it('keeps doors and attached closets in place on a counterclockwise room', () => {
    const points = [RECT[0], ...RECT.slice(1).reverse()]
    const frame = wallAt(points, 1, true)!
    const placed = placeCloset(
      frame,
      { runId: room.id, wall: 1, t: 0.7 },
      100,
      60,
    )
    const oldDoor = { ...door, wall: 1 }
    const old = {
      ...legacy(),
      rooms: [
        { ...room, points },
        {
          id: 'closet',
          name: 'Coats',
          kind: 'closet',
          points: placed.points.slice(0, -1),
          attachment: { roomId: room.id, wall: 1, t: 0.7 },
        },
      ],
      openings: [oldDoor],
    }
    const migrated = parseProjectFile(JSON.stringify(old))
    const opening = migrated.openings[0]
    const before = openingEnds(frame, oldDoor)
    const after = openingEnds(openingWall(migrated.walls, opening)!, opening)
    expect(after.centre).toEqual(before.centre)
    expect(after.start).toEqual(before.end)
    expect(after.end).toEqual(before.start)
    expect(opening.hinge).toBe('end')
    const closet = migrated.walls[1]
    const attachment = closet.attachment!
    const restored = placeCloset(
      runWallAt(migrated.walls[0], attachment.wall)!,
      attachment,
      100,
      60,
    )
    const sorted = (p: Array<Point>) =>
      p
        .slice(0, -1)
        .map((point) => `${point.x},${point.y}`)
        .sort()
    expect(sorted(restored.points)).toEqual(sorted(placed.points))
    expect(
      enclosuresOf(migrated.walls, migrated.spaces)
        .map((floor) => floor.space?.name)
        .sort(),
    ).toEqual(['Coats', 'Living'])
  })

  it('rejects unknown versions and malformed legacy room geometry', () => {
    expect(
      ProjectRecordSchema.safeParse({ ...legacy(), schemaVersion: 99 }).success,
    ).toBe(false)
    expect(
      ProjectRecordSchema.safeParse({
        ...legacy(),
        rooms: [{ ...room, points: RECT.slice(0, 2) }],
      }).success,
    ).toBe(false)
  })
})
