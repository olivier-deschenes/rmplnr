import { closeWallPoints, loopsBack } from '#/lib/planner/geometry.ts'
import { beforeEach, describe, expect, it } from 'bun:test'

import { blockersFor, fits } from './collision.ts'
import {
  closingIssue,
  draftPoints,
  nearestOpenEnd,
  straightPoint,
} from './drawing.ts'
import { wallLabels } from './dimensions.ts'
import { enclosuresOf } from './enclosures.ts'
import { nearestWall, runWallAt, wallCount } from './openings.ts'
import { parseRmplnrFile, serializeProject } from './planSerialization.ts'
import {
  currentProjects,
  plannerStore,
  saveNow,
  startAutosave,
} from './store.ts'
import { WallRunSchema } from './types.ts'
import { wallPath } from './walls.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const actions = plannerStore.actions
const points = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 300 },
]

beforeEach(() => {
  actions.closeProject()
  actions.loadLibrary({
    version: 1,
    projects: [
      {
        id: ID,
        name: 'Wall test',
        walls: [],
        furniture: [],
        openings: [],
        spaces: [],
      },
    ],
  })
  actions.openProject(ID)
  actions.setStraightWalls(false)
  actions.setTool('run')
})

function draw(count = 3) {
  for (const point of points.slice(0, count)) actions.addDraftPoint(point)
  return plannerStore.state.walls[0]
}

describe('drawing walls', () => {
  it('saves each wall before the pen is put down, and reloads an unfinished run', () => {
    const writes = new Map<string, string>()
    const storage = {
      getItem: (key: string) => writes.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.set(key, value)
      },
    }
    const stop = startAutosave({
      storage,
      lifecycle: new EventTarget(),
      debounceMs: 60_000,
    })
    try {
      draw(2)
      saveNow()
      const saved = JSON.parse(storage.getItem('rmplnr.projects.v1')!)
      expect(saved.projects[0].walls[0]).toMatchObject({
        points: points.slice(0, 2),
      })
      actions.closeProject()
      actions.loadLibrary(saved)
      actions.openProject(ID)
      expect(wallCount(plannerStore.state.walls[0])).toBe(1)
      expect(plannerStore.state.draft).toBeNull()
    } finally {
      stop()
    }
  })

  it('stops after a single wall without closing or deleting it', () => {
    const run = draw(2)
    actions.cancelDraft()
    expect(plannerStore.state.draft).toBeNull()
    expect(plannerStore.state.walls).toEqual([run])
    expect(loopsBack(run.points)).toBe(false)
  })

  it('keeps the pen in hand, so the next click starts the next run', () => {
    const run = draw(2)
    actions.cancelDraft()
    // Still the wall tool: walls go up all over a plan, in runs that have
    // nothing to do with each other.
    expect(plannerStore.state.tool).toBe('run')
    actions.addDraftPoint({ x: 900, y: 900 })
    actions.addDraftPoint({ x: 900, y: 1200 })
    expect(plannerStore.state.walls).toHaveLength(2)
    expect(plannerStore.state.walls[0]).toEqual(run)
  })

  it('lets a run of walls cross back over itself', () => {
    actions.addDraftPoint({ x: 0, y: 0 })
    actions.addDraftPoint({ x: 300, y: 0 })
    actions.addDraftPoint({ x: 300, y: 300 })
    // Back across the run's own first wall, which used to be refused and now
    // encloses a room.
    expect(actions.addDraftPoint({ x: 150, y: -150 })).toEqual({ ok: true })
    expect(wallCount(plannerStore.state.walls[0])).toBe(3)
  })

  it('still refuses a wall laid straight back over the one before it', () => {
    actions.addDraftPoint({ x: 0, y: 0 })
    actions.addDraftPoint({ x: 300, y: 0 })
    const result = actions.addDraftPoint({ x: 100, y: 0 })
    expect(result.ok).toBe(false)
  })

  it('keeps walls when switching tools and allows a separate run', () => {
    const run = draw()
    actions.setTool('rect')
    expect(plannerStore.state.walls).toEqual([run])
    actions.setTool('run')
    actions.addDraftPoint({ x: 700, y: 0 })
    actions.addDraftPoint({ x: 700, y: 300 })
    expect(plannerStore.state.walls).toHaveLength(2)
    expect(plannerStore.state.walls[0]).toEqual(run)
  })

  it('continues from the actual endpoint after resizing a paused wall', () => {
    const run = draw(2)
    actions.cancelDraft()
    expect(actions.setWallDimensions(run.id, 0, { length: 525 })).toEqual({
      ok: true,
    })
    actions.continueWalls(run.id)
    expect(
      draftPoints(plannerStore.state.walls, plannerStore.state.draft).at(-1),
    ).toEqual({ x: 525, y: 0 })
    actions.addDraftPoint({ x: 525, y: 300 })
    expect(plannerStore.state.walls[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 525, y: 0 },
      { x: 525, y: 300 },
    ])
  })

  it('reads length edits immediately while the pen is still down', () => {
    const run = draw(2)
    actions.setWallDimensions(run.id, 0, { length: 320, angle: 90 })
    const end = draftPoints(
      plannerStore.state.walls,
      plannerStore.state.draft,
    ).at(-1)!
    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(320)
  })

  it('extends the first end without moving a door to the new wall', () => {
    const run = draw()
    actions.cancelDraft()
    actions.addOpening('door', run.id, 0, 0.5)
    const opening = plannerStore.state.openings[0]
    actions.continueWalls(run.id, 'start')
    actions.addDraftPoint({ x: -200, y: 0 })
    expect(plannerStore.state.walls[0].points).toEqual([
      { x: -200, y: 0 },
      ...points,
    ])
    expect(plannerStore.state.openings[0]).toEqual({ ...opening, wall: 1 })
    actions.popDraftPoint()
    expect(plannerStore.state.walls[0].points).toEqual(points)
    expect(plannerStore.state.openings[0]).toEqual(opening)
  })

  it('undoes and redoes one wall at a time, including the first wall', () => {
    draw()
    actions.undo()
    expect(plannerStore.state.walls[0].points).toEqual(points.slice(0, 2))
    actions.undo()
    expect(plannerStore.state.walls).toEqual([])
    actions.redo()
    actions.redo()
    expect(plannerStore.state.walls[0].points).toEqual(points)
  })

  it('removes a middle wall into two resumable runs and restores it with undo', () => {
    const run = draw()
    actions.addDraftPoint({ x: 0, y: 300 })
    actions.cancelDraft()
    expect(actions.removeWall(run.id, 1)).toEqual({ ok: true })
    expect(plannerStore.state.walls.map((r) => r.points)).toEqual([
      points.slice(0, 2),
      [
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
    ])
    expect(plannerStore.state.walls.every((r) => !('closed' in r))).toBe(true)
    actions.undo()
    expect(plannerStore.state.walls).toHaveLength(1)
    expect(wallCount(plannerStore.state.walls[0])).toBe(3)
  })

  it('ignores duplicate endpoints and rejects walls that double back', () => {
    draw(2)
    const before = plannerStore.state
    actions.addDraftPoint({ x: 400, y: 0 })
    expect(plannerStore.state).toBe(before)
    expect(actions.addDraftPoint({ x: 200, y: 0 }).ok).toBe(false)
    expect(plannerStore.state).toBe(before)
  })

  it('closes only on request and can undo the closing wall', () => {
    draw()
    expect(actions.commitDraft()).toEqual({ ok: true })
    expect(loopsBack(plannerStore.state.walls[0].points)).toBe(true)
    expect(wallCount(plannerStore.state.walls[0])).toBe(3)
    actions.undo()
    expect(loopsBack(plannerStore.state.walls[0].points)).toBe(false)
    expect(wallCount(plannerStore.state.walls[0])).toBe(2)
    expect(plannerStore.state.tool).toBe('run')
    actions.redo()
    expect(loopsBack(plannerStore.state.walls[0].points)).toBe(true)
  })

  it('does not discard a single wall when asked to close too early', () => {
    const run = draw(2)
    expect(actions.commitDraft().ok).toBe(false)
    expect(plannerStore.state.walls).toEqual([run])
  })

  it('locks new walls to both axes and requires a straight closing wall', () => {
    actions.setStraightWalls(true)
    actions.addDraftPoint({ x: 0, y: 0 })
    actions.addDraftPoint({ x: 400, y: 12 })
    actions.addDraftPoint({ x: 412, y: 300 })
    expect(plannerStore.state.walls[0].points).toEqual(points)
    expect(actions.commitDraft().ok).toBe(false)
    actions.addDraftPoint({ x: 0, y: 295 })
    expect(actions.commitDraft().ok).toBe(true)
    expect(plannerStore.state.walls[0].points.at(-2)).toEqual({ x: 0, y: 300 })
  })

  it('allows angled walls with the toggle off, without changing earlier walls', () => {
    const run = draw(2)
    actions.addDraftPoint({ x: 570, y: 125 })
    expect(plannerStore.state.walls[0].points).toEqual([
      ...run.points,
      { x: 570, y: 125 },
    ])
    expect(straightPoint({ x: 3.7, y: 9.2 }, { x: 99, y: 10 })).toEqual({
      x: 99,
      y: 9.2,
    })
  })
})

describe('open walls throughout the plan', () => {
  it('never renders, measures, selects, or collides with an implicit closing wall', () => {
    const run = draw()
    expect(wallPath([run], [], run)).toBe('M0,0 L400,0 L400,300')
    expect(runWallAt(run, 2)).toBeNull()
    expect(nearestWall([run], { x: 200, y: 150 }, 10)).toBeNull()
    const labels = wallLabels(
      [run],
      [],
      [],
      { tx: 100, ty: 100, scale: 1 },
      'metric',
      { width: 800, height: 600 },
    )
    expect(labels.map((label) => label.wall).sort()).toEqual([0, 1])
    expect(
      fits(
        {
          id: 'box',
          name: 'Box',
          kind: 'box',
          x: 200,
          y: 150,
          w: 40,
          h: 40,
          rotation: 0,
        },
        blockersFor([run], [], []),
      ),
    ).toBe(true)
  })

  it('exports and imports open walls while older rooms remain closed', () => {
    draw(2)
    const project = currentProjects(plannerStore.state)[0]
    const parsed = parseRmplnrFile(serializeProject(project))
    expect(parsed).toEqual({ kind: 'project', project })
    expect(WallRunSchema.safeParse(project.walls[0]).success).toBe(true)
    expect(
      WallRunSchema.safeParse({ id: 'old', name: 'Old room', points }).success,
    ).toBe(true)
  })

  it('finds both open ends and skips locked or completed rooms', () => {
    const run = draw()
    expect(nearestOpenEnd([run], { x: 1, y: 1 }, 10)?.end).toBe('start')
    expect(nearestOpenEnd([run], { x: 403, y: 299 }, 10)?.end).toBe('end')
    expect(nearestOpenEnd([{ ...run, locked: true }], points[0], 10)).toBeNull()
    expect(
      nearestOpenEnd(
        [{ ...run, points: closeWallPoints(run.points) }],
        points[0],
        10,
      ),
    ).toBeNull()
    expect(closingIssue(points, true)).not.toBeNull()
  })
})

describe('walls, rooms and the spaces between them', () => {
  /** A closed 400x300 room at the origin, and nothing else. */
  const HOST = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ]

  /** Three walls out from the host's left wall and back onto it. */
  function walledOff() {
    // A fresh library only lands on a project that is not already open.
    actions.closeProject()
    actions.loadLibrary({
      version: 1,
      projects: [
        {
          id: ID,
          name: 'Wall test',
          walls: [
            { id: 'host', name: 'Living', points: closeWallPoints(HOST) },
          ],
          furniture: [],
          openings: [],
          spaces: [],
        },
      ],
    })
    actions.openProject(ID)
    actions.setTool('run')
    actions.addDraftPoint({ x: 0, y: 0 })
    actions.addDraftPoint({ x: -200, y: 0 })
    actions.addDraftPoint({ x: -200, y: 150 })
    actions.addDraftPoint({ x: 0, y: 150 })
    actions.cancelDraft()
    return plannerStore.state.walls[1]
  }

  it('calls a run of walls walls, and a closed one a room', () => {
    draw(2)
    expect(plannerStore.state.walls[0].name).toBe('Walls 1')
    draw(3)
    expect(actions.commitDraft()).toEqual({ ok: true })
    expect(plannerStore.state.walls[0].name).toBe('Walls 1')
  })

  it('keeps a name somebody chose when the run is closed', () => {
    const run = draw(3)
    actions.updateRun(run.id, { name: 'Porch' })
    expect(actions.commitDraft()).toEqual({ ok: true })
    expect(plannerStore.state.walls.map((r) => r.name)).toEqual(['Porch'])
  })

  it('reads a room out of walls run back onto a room already drawn', () => {
    walledOff()
    const space = enclosuresOf(plannerStore.state.walls).find(
      (floor) => floor.centre.x < 0,
    )!
    expect(space).toBeDefined()
    expect(space.area).toBeCloseTo(200 * 150, 4)
    expect(space.space).toBeNull()

    // Naming it is what puts it on the plan, and it survives a round trip.
    actions.updateEnclosure(space.key, { name: 'Pantry', color: '#123456' })
    const named = enclosuresOf(
      plannerStore.state.walls,
      plannerStore.state.spaces,
    ).find((floor) => floor.centre.x < 0)!
    expect(named.space?.name).toBe('Pantry')
    expect(named.space?.color).toBe('#123456')

    const project = currentProjects(plannerStore.state).find(
      (p) => p.id === ID,
    )!
    expect(parseRmplnrFile(serializeProject(project))).toEqual({
      kind: 'project',
      project,
    })
  })

  it('carries a name across a wall of the space being moved', () => {
    const run = walledOff()
    actions.updateEnclosure(
      enclosuresOf(plannerStore.state.walls).find(
        (floor) => floor.centre.x < 0,
      )!.key,
      {
        name: 'Pantry',
      },
    )
    // Push the far wall out by half a metre; the name goes with the space.
    actions.moveVertex(run.id, 1, { x: -250, y: 0 })
    actions.moveVertex(run.id, 2, { x: -250, y: 150 })
    const moved = enclosuresOf(
      plannerStore.state.walls,
      plannerStore.state.spaces,
    ).find((floor) => floor.centre.x < 0)!
    expect(moved.space?.name).toBe('Pantry')
    expect(moved.area).toBeCloseTo(250 * 150, 4)
  })

  it('takes the name back off a space without touching its walls', () => {
    walledOff()
    const key = enclosuresOf(plannerStore.state.walls).find(
      (floor) => floor.centre.x < 0,
    )!.key
    actions.updateEnclosure(key, { name: 'Pantry' })
    expect(plannerStore.state.spaces).toHaveLength(1)

    actions.select({ type: 'enclosure', id: key })
    actions.deleteSelected()
    expect(plannerStore.state.spaces).toEqual([])
    // The walls that closed it are still standing, so the space still is.
    expect(enclosuresOf(plannerStore.state.walls)).toHaveLength(2)
  })
})
