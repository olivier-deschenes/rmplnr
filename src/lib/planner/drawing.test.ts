import { beforeEach, describe, expect, it } from 'bun:test'

import { blockersFor, fits } from './collision.ts'
import {
  closingIssue,
  draftPoints,
  nearestOpenEnd,
  straightPoint,
} from './drawing.ts'
import { wallLabels } from './dimensions.ts'
import { nearestWall, roomWallAt, wallCount } from './openings.ts'
import { parseRmplnrFile, serializeProject } from './planSerialization.ts'
import {
  currentProjects,
  plannerStore,
  saveNow,
  startAutosave,
} from './store.ts'
import { RoomSchema } from './types.ts'
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
      { id: ID, name: 'Wall test', rooms: [], furniture: [], openings: [] },
    ],
  })
  actions.openProject(ID)
  actions.setStraightWalls(false)
  actions.setTool('room')
})

function draw(count = 3) {
  for (const point of points.slice(0, count)) actions.addDraftPoint(point)
  return plannerStore.state.rooms[0]
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
      expect(saved.projects[0].rooms[0]).toMatchObject({
        closed: false,
        points: points.slice(0, 2),
      })
      actions.closeProject()
      actions.loadLibrary(saved)
      actions.openProject(ID)
      expect(wallCount(plannerStore.state.rooms[0])).toBe(1)
      expect(plannerStore.state.draft).toBeNull()
    } finally {
      stop()
    }
  })

  it('stops after a single wall without closing or deleting it', () => {
    const room = draw(2)
    actions.cancelDraft()
    expect(plannerStore.state.tool).toBe('select')
    expect(plannerStore.state.draft).toBeNull()
    expect(plannerStore.state.rooms).toEqual([room])
    expect(room.closed).toBe(false)
  })

  it('keeps walls when switching tools and allows a separate run', () => {
    const room = draw()
    actions.setTool('rect')
    expect(plannerStore.state.rooms).toEqual([room])
    actions.setTool('room')
    actions.addDraftPoint({ x: 700, y: 0 })
    actions.addDraftPoint({ x: 700, y: 300 })
    expect(plannerStore.state.rooms).toHaveLength(2)
    expect(plannerStore.state.rooms[0]).toEqual(room)
  })

  it('continues from the actual endpoint after resizing a paused wall', () => {
    const room = draw(2)
    actions.cancelDraft()
    expect(actions.setWallDimensions(room.id, 0, { length: 525 })).toEqual({
      ok: true,
    })
    actions.continueWalls(room.id)
    expect(
      draftPoints(plannerStore.state.rooms, plannerStore.state.draft).at(-1),
    ).toEqual({ x: 525, y: 0 })
    actions.addDraftPoint({ x: 525, y: 300 })
    expect(plannerStore.state.rooms[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 525, y: 0 },
      { x: 525, y: 300 },
    ])
  })

  it('reads length edits immediately while the pen is still down', () => {
    const room = draw(2)
    actions.setWallDimensions(room.id, 0, { length: 320, angle: 90 })
    const end = draftPoints(
      plannerStore.state.rooms,
      plannerStore.state.draft,
    ).at(-1)!
    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(320)
  })

  it('extends the first end without moving a door to the new wall', () => {
    const room = draw()
    actions.cancelDraft()
    actions.addOpening('door', room.id, 0, 0.5)
    const opening = plannerStore.state.openings[0]
    actions.continueWalls(room.id, 'start')
    actions.addDraftPoint({ x: -200, y: 0 })
    expect(plannerStore.state.rooms[0].points).toEqual([
      { x: -200, y: 0 },
      ...points,
    ])
    expect(plannerStore.state.openings[0]).toEqual({ ...opening, wall: 1 })
    actions.popDraftPoint()
    expect(plannerStore.state.rooms[0].points).toEqual(points)
    expect(plannerStore.state.openings[0]).toEqual(opening)
  })

  it('undoes and redoes one wall at a time, including the first wall', () => {
    draw()
    actions.undo()
    expect(plannerStore.state.rooms[0].points).toEqual(points.slice(0, 2))
    actions.undo()
    expect(plannerStore.state.rooms).toEqual([])
    actions.redo()
    actions.redo()
    expect(plannerStore.state.rooms[0].points).toEqual(points)
  })

  it('removes a middle wall into two resumable runs and restores it with undo', () => {
    const room = draw()
    actions.addDraftPoint({ x: 0, y: 300 })
    actions.cancelDraft()
    expect(actions.removeWall(room.id, 1)).toEqual({ ok: true })
    expect(plannerStore.state.rooms.map((r) => r.points)).toEqual([
      points.slice(0, 2),
      [
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
    ])
    expect(plannerStore.state.rooms.every((r) => r.closed === false)).toBe(true)
    actions.undo()
    expect(plannerStore.state.rooms).toHaveLength(1)
    expect(wallCount(plannerStore.state.rooms[0])).toBe(3)
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
    expect(plannerStore.state.rooms[0].closed).not.toBe(false)
    expect(wallCount(plannerStore.state.rooms[0])).toBe(3)
    actions.undo()
    expect(plannerStore.state.rooms[0].closed).toBe(false)
    expect(wallCount(plannerStore.state.rooms[0])).toBe(2)
    expect(plannerStore.state.tool).toBe('room')
    actions.redo()
    expect(plannerStore.state.rooms[0].closed).not.toBe(false)
  })

  it('does not discard a single wall when asked to close too early', () => {
    const room = draw(2)
    expect(actions.commitDraft().ok).toBe(false)
    expect(plannerStore.state.rooms).toEqual([room])
  })

  it('locks new walls to both axes and requires a straight closing wall', () => {
    actions.setStraightWalls(true)
    actions.addDraftPoint({ x: 0, y: 0 })
    actions.addDraftPoint({ x: 400, y: 12 })
    actions.addDraftPoint({ x: 412, y: 300 })
    expect(plannerStore.state.rooms[0].points).toEqual(points)
    expect(actions.commitDraft().ok).toBe(false)
    actions.addDraftPoint({ x: 0, y: 295 })
    expect(actions.commitDraft().ok).toBe(true)
    expect(plannerStore.state.rooms[0].points.at(-1)).toEqual({ x: 0, y: 300 })
  })

  it('allows angled walls with the toggle off, without changing earlier walls', () => {
    const room = draw(2)
    actions.addDraftPoint({ x: 570, y: 125 })
    expect(plannerStore.state.rooms[0].points).toEqual([
      ...room.points,
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
    const room = draw()
    expect(wallPath([room], [], room)).toBe('M0,0 L400,0 L400,300')
    expect(roomWallAt(room, 2)).toBeNull()
    expect(nearestWall([room], { x: 200, y: 150 }, 10)).toBeNull()
    const labels = wallLabels(
      [room],
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
        blockersFor([room], [], []),
      ),
    ).toBe(true)
  })

  it('exports and imports open walls while older rooms remain closed', () => {
    draw(2)
    const project = currentProjects(plannerStore.state)[0]
    const parsed = parseRmplnrFile(serializeProject(project))
    expect(parsed).toEqual({ kind: 'project', project })
    expect(
      RoomSchema.safeParse({ ...project.rooms[0], closed: undefined }).success,
    ).toBe(false)
    expect(
      RoomSchema.safeParse({ id: 'old', name: 'Old room', points }).success,
    ).toBe(true)
  })

  it('finds both open ends and skips locked or completed rooms', () => {
    const room = draw()
    expect(nearestOpenEnd([room], { x: 1, y: 1 }, 10)?.end).toBe('start')
    expect(nearestOpenEnd([room], { x: 403, y: 299 }, 10)?.end).toBe('end')
    expect(
      nearestOpenEnd([{ ...room, locked: true }], points[0], 10),
    ).toBeNull()
    expect(
      nearestOpenEnd([{ ...room, closed: true }], points[0], 10),
    ).toBeNull()
    expect(closingIssue(points, true)).not.toBeNull()
  })
})
