import { closeWallPoints } from '#/lib/planner/geometry.ts'
import { describe, expect, it } from 'bun:test'

import { clearancesFor } from './clearances.ts'
import { placeCloset } from './closets.ts'
import { wallAt } from './openings.ts'

import type { Clearance } from './clearances.ts'
import type { Furniture, Opening, WallRun } from './types.ts'

/** A 400 x 300 room, its walls 12 thick about the outline below. */
const ROOM: WallRun = {
  id: 'run',
  name: 'Living',
  points: closeWallPoints([
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ]),
}

function box(over: Partial<Furniture> = {}): Furniture {
  return {
    id: 'box',
    kind: 'box',
    name: 'Box',
    x: 200,
    y: 150,
    w: 100,
    h: 60,
    rotation: 0,
    ...over,
  }
}

function door(over: Partial<Opening> = {}): Opening {
  return {
    id: 'door',
    kind: 'door',
    runId: 'run',
    wall: 0,
    t: 0.25,
    width: 90,
    hinge: 'start',
    swing: 'in',
    ...over,
  }
}

/** The clearances by the face or jamb they were measured off. */
function by(clearances: Array<Clearance>): Record<string, number> {
  return Object.fromEntries(
    clearances.map(({ key, distance }) => [
      key,
      Math.round(distance * 100) / 100,
    ]),
  )
}

describe('furniture clearances', () => {
  it('measures each face to the wall it faces', () => {
    const item = box()
    const found = clearancesFor(
      { type: 'furniture', id: 'box' },
      [ROOM],
      [item],
      [],
    )
    // Half the wall's thickness stands inside the outline it is drawn about.
    expect(by(found)).toEqual({ n: 114, e: 144, s: 114, w: 144 })
  })

  it('measures to a neighbour before the wall behind it', () => {
    const found = clearancesFor(
      { type: 'furniture', id: 'box' },
      [ROOM],
      [box(), box({ id: 'other', x: 340, w: 100 })],
      [],
    )
    expect(by(found).e).toBe(40)
    expect(by(found).w).toBe(144)
  })

  it('stands the dimension over what the face actually meets', () => {
    const found = clearancesFor(
      { type: 'furniture', id: 'box' },
      [ROOM],
      // Only the corners of the two overlap: the near edge of the neighbour
      // covers the last 10 cm of the box's south face and no more of it.
      [box(), box({ id: 'other', x: 290, y: 240, w: 100, h: 80 })],
      [],
    )
    const south = found.find((clearance) => clearance.key === 's')!
    expect(south.distance).toBe(20)
    expect(south.from.x).toBe(245)
  })

  it('turns with the item it belongs to', () => {
    const found = by(
      clearancesFor(
        { type: 'furniture', id: 'box' },
        [ROOM],
        [box({ rotation: 90 })],
        [],
      ),
    )
    // The face that was looking up the page now looks across it, and it is
    // the item's own depth that stands between its middle and the wall.
    expect(found.n).toBe(164)
    expect(found.e).toBe(94)
  })

  it('says nothing about a face that is already up against something', () => {
    const found = clearancesFor(
      { type: 'furniture', id: 'box' },
      [ROOM],
      [box({ x: 56 })],
      [],
    )
    expect(Object.keys(by(found)).sort()).toEqual(['e', 'n', 's'])
  })

  it('measures through a doorway rather than into it', () => {
    const item = box({ y: 100, h: 60 })
    const opening = door({ t: 0.5, width: 200 })
    const found = clearancesFor(
      { type: 'furniture', id: 'box' },
      [ROOM],
      [item],
      [opening],
    )
    // The wall the north face was looking at has a hole where it was looking.
    expect(found.some((clearance) => clearance.key === 'n')).toBe(false)
  })
})

describe('opening clearances', () => {
  it('measures each jamb to the corner beyond it', () => {
    const opening = door()
    const found = clearancesFor(
      { type: 'opening', id: 'door' },
      [ROOM],
      [],
      [opening],
    )
    expect(by(found)).toEqual({ start: 55, end: 255 })
  })

  it('stops at the next opening along the same wall', () => {
    const found = clearancesFor(
      { type: 'opening', id: 'door' },
      [ROOM],
      [],
      [door(), door({ id: 'window', kind: 'window', t: 0.75, width: 100 })],
    )
    expect(by(found)).toEqual({ start: 55, end: 105 })
  })

  it('has nothing to say about an opening whose wall has gone', () => {
    expect(
      clearancesFor({ type: 'opening', id: 'door' }, [], [], [door()]),
    ).toEqual([])
  })
})

describe('closet clearances', () => {
  const wall = wallAt(ROOM.points, 0)!
  const placed = placeCloset(wall, { runId: ROOM.id, wall: 0, t: 0.5 }, 180, 60)
  const closet: WallRun = {
    id: 'closet',
    kind: 'closet',
    name: 'Closet',
    points: placed.points,
    attachment: placed.attachment,
  }

  it('measures its front along the wall it hangs on', () => {
    const found = clearancesFor(
      { type: 'run', id: 'closet' },
      [ROOM, closet],
      [],
      [],
    )
    expect(by(found)).toEqual({ start: 110, end: 110 })
  })

  it('leaves an ordinary room alone', () => {
    expect(
      clearancesFor({ type: 'run', id: 'run' }, [ROOM, closet], [], []),
    ).toEqual([])
  })
})
