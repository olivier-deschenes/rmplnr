import { closeWallPoints, polygonArea } from './geometry.ts'
import { describe, expect, it } from 'bun:test'

import {
  enclosureAt,
  enclosureLocked,
  enclosureWalls,
  closetFloor,
  enclosuresOf,
  planFloors,
  wallLoops,
} from './enclosures.ts'

import type { Point, WallRun, Space } from './types.ts'

function run(id: string, points: Array<Point>, closed = true): WallRun {
  return {
    id,
    name: id,
    points: closed ? closeWallPoints(points) : points,
  }
}

function rect(x: number, y: number, w: number, h: number): Array<Point> {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

/** Areas of every loop found, largest first, so a test can read them off. */
function areas(walls: Array<WallRun>): Array<number> {
  return wallLoops(walls)
    .map(polygonArea)
    .sort((a, b) => b - a)
}

describe('wallLoops', () => {
  it('finds the one loop a closed room makes', () => {
    expect(areas([run('a', rect(0, 0, 100, 200))])).toEqual([20_000])
  })

  it('finds nothing in a run of walls that closes nothing', () => {
    expect(
      areas([
        run(
          'a',
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
          false,
        ),
      ]),
    ).toEqual([])
  })

  it('closes three open walls against a wall already there', () => {
    const closed = run('a', rect(0, 0, 400, 300))
    // Out from the left wall, round, and back onto it higher up.
    const open = run(
      'b',
      [
        { x: 0, y: 0 },
        { x: -200, y: 0 },
        { x: -200, y: 150 },
        { x: 0, y: 150 },
      ],
      false,
    )
    expect(areas([closed, open])).toEqual([120_000, 30_000])
  })

  it('reads a wall two rooms share as one wall', () => {
    const left = run('a', rect(0, 0, 100, 100))
    const right = run('b', rect(100, 0, 100, 100))
    expect(areas([left, right])).toEqual([10_000, 10_000])
  })

  it('splits a room in two when a wall is drawn across it', () => {
    const outer = run('a', rect(0, 0, 200, 100))
    const divider = run(
      'b',
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      false,
    )
    expect(areas([outer, divider])).toEqual([10_000, 10_000])
  })

  it('ignores a wall that leads nowhere inside a room', () => {
    const outer = run('a', rect(0, 0, 200, 100))
    const stub = run(
      'b',
      [
        { x: 100, y: 0 },
        { x: 100, y: 60 },
      ],
      false,
    )
    const loops = wallLoops([outer, stub])
    expect(loops.map(polygonArea)).toEqual([20_000])
    // The stub is walked out and back, and comes off the loop it sits in —
    // along with the corner it left on the wall it was walled onto.
    expect(loops[0]).toEqual(rect(0, 0, 200, 100))
  })

  it('finds the four rooms a cross of walls makes', () => {
    const outer = run('a', rect(0, 0, 200, 200))
    const across = run(
      'b',
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      false,
    )
    const down = run(
      'c',
      [
        { x: 100, y: 0 },
        { x: 100, y: 200 },
      ],
      false,
    )
    expect(areas([outer, across, down])).toEqual([
      10_000, 10_000, 10_000, 10_000,
    ])
  })

  it('closes a loop made only of open runs that cross each other', () => {
    const across = run(
      'a',
      [
        { x: -50, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 100 },
      ],
      false,
    )
    const back = run(
      'b',
      [
        { x: 200, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: -50 },
      ],
      false,
    )
    expect(areas([across, back])).toEqual([15_000])
  })

  it('welds corners that rounding left a hair apart', () => {
    const open = run(
      'b',
      [
        { x: 0.0000001, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 99.9999999 },
      ],
      false,
    )
    expect(areas([open])).toEqual([])
    const closing = run(
      'a',
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      false,
    )
    expect(areas([open, closing])[0]).toBeCloseTo(10_000, 3)
  })
})

describe('enclosuresOf', () => {
  const closed = run('a', rect(0, 0, 400, 300))
  const open = run(
    'b',
    [
      { x: 0, y: 0 },
      { x: -200, y: 0 },
      { x: -200, y: 150 },
      { x: 0, y: 150 },
    ],
    false,
  )

  it('derives both floors from the walls', () => {
    const found = enclosuresOf([closed, open])
    expect(found).toHaveLength(2)
    expect(found.map((floor) => floor.area)).toEqual([120000, 30000])
  })

  it('splits a floor when a dividing wall is drawn', () => {
    const divider = run(
      'c',
      [
        { x: 200, y: 0 },
        { x: 200, y: 300 },
      ],
      false,
    )
    const found = enclosuresOf([closed, divider])
    expect(found.map((floor) => floor.area)).toEqual([60000, 60000])
  })

  it('puts a saved name on the space its point stands in', () => {
    const space: Space = {
      id: 's1',
      name: 'Pantry',
      color: '#ff0000',
      seed: { x: -100, y: 75 },
    }
    const free = enclosuresOf([closed, open], [space])[1]
    expect(free.space?.name).toBe('Pantry')
    expect(free.space?.color).toBe('#ff0000')
  })

  it('keeps a name whose space no longer exists rather than moving it', () => {
    const space: Space = { id: 's1', name: 'Pantry', seed: { x: -100, y: 75 } }
    // The run is gone, so nothing encloses the point any more.
    expect(
      enclosuresOf([closed], [space]).every((floor) => floor.space === null),
    ).toBe(true)
  })

  it('gives each space its own name when two are saved', () => {
    const second = run(
      'c',
      [
        { x: 400, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 150 },
        { x: 400, y: 150 },
      ],
      false,
    )
    const spaces: Array<Space> = [
      { id: 's1', name: 'Pantry', seed: { x: -100, y: 75 } },
      { id: 's2', name: 'Porch', seed: { x: 500, y: 75 } },
    ]
    const names = enclosuresOf([closed, open, second], spaces)
      .map((enclosure) => enclosure.space?.name)
      .filter(Boolean)
    expect(names.sort()).toEqual(['Pantry', 'Porch'])
  })

  it('keys a space by its corners, and keeps that key across a redraw', () => {
    const first = enclosuresOf([closed, open])[1].key
    const again = enclosuresOf([{ ...closed }, { ...open }])[1].key
    expect(again).toBe(first)
  })

  it('gives a space a different key once one of its walls moves', () => {
    const moved = {
      ...open,
      points: open.points.map((p) => (p.x === -200 ? { ...p, x: -210 } : p)),
    }
    expect(enclosuresOf([closed, moved])[1].key).not.toBe(
      enclosuresOf([closed, open])[1].key,
    )
  })
})

describe('the walls that close a space in', () => {
  const closed = run('a', rect(0, 0, 400, 300))
  // Out from the left wall, round, and back onto it higher up.
  const open = run(
    'b',
    [
      { x: 0, y: 0 },
      { x: -200, y: 0 },
      { x: -200, y: 150 },
      { x: 0, y: 150 },
    ],
    false,
  )
  // Off the far corner of that run, heading away from the space entirely.
  const stub = run(
    'c',
    [
      { x: -200, y: 0 },
      { x: -200, y: -100 },
    ],
    false,
  )
  const space = (walls: Array<WallRun>) => enclosuresOf(walls)[1]

  it('names the run that drew each of its walls, and the room it closed onto', () => {
    const walls = [closed, open, stub]
    expect(enclosureWalls(walls, space(walls)).map((r) => r.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('leaves out a wall that only touches a corner of it', () => {
    const walls = [closed, open, stub]
    expect(enclosureWalls(walls, space(walls)).map((r) => r.id)).not.toContain(
      'c',
    )
  })

  it('is held only once every one of those runs is', () => {
    const partly = [{ ...closed, locked: true }, open, stub]
    expect(enclosureLocked(partly, space(partly))).toBe(false)

    const held = [{ ...closed, locked: true }, { ...open, locked: true }, stub]
    expect(enclosureLocked(held, space(held))).toBe(true)
  })
})

describe('enclosureAt', () => {
  it('answers with the space a point stands in', () => {
    const closed = run('a', rect(0, 0, 400, 300))
    const open = run(
      'b',
      [
        { x: 0, y: 0 },
        { x: -200, y: 0 },
        { x: -200, y: 150 },
        { x: 0, y: 150 },
      ],
      false,
    )
    const found = enclosuresOf([closed, open])
    expect(enclosureAt(found, { x: -100, y: 75 })?.area).toBe(30000)
    expect(enclosureAt(found, { x: 200, y: 150 })?.area).toBe(120000)
  })
})

describe('the plan a reader brought in', () => {
  // Room 1 closed, and three open walls run out from its left wall and back.
  const walls: Array<WallRun> = [
    run('room-1', [
      { x: -360.68, y: -411.48 },
      { x: 459.74, y: -411.48 },
      { x: 459.74, y: 182.88 },
      { x: -360.68, y: 182.88 },
    ]),
    run(
      'room-2',
      [
        { x: -360.68, y: -411.48 },
        { x: -721.36, y: -411.48 },
        { x: -721.36, y: -106.68 },
        { x: -360.68, y: -106.68 },
      ],
      false,
    ),
  ]

  it('reads the run on the left as a room of its own', () => {
    const found = enclosuresOf(walls)
    expect(found).toHaveLength(2)
    expect(found[0].area).toBeGreaterThan(found[1].area)
    expect(found[1].area).toBeCloseTo(360.68 * 304.8, 4)
  })
})

describe('what is not a room', () => {
  it('ignores the hairline between two walls drawn a hair apart', () => {
    // Two rooms meant to be flush, whose shared wall was drawn 4 cm out.
    const left = run('a', rect(0, 0, 400, 300))
    const right = run('b', rect(404, 0, 400, 300))
    expect(areas([left, right])).toEqual([120_000, 120_000])
  })

  it('still finds a narrow room that is a room', () => {
    const cupboard = run('a', rect(0, 0, 40, 200))
    expect(areas([cupboard])).toEqual([8_000])
  })
})

describe('the floor a room actually has', () => {
  /** Floors of every space found, largest loop first. */
  function floors(walls: Array<WallRun>, spaces: Array<Space> = []) {
    return enclosuresOf(walls, spaces).map((found) => found.floor)
  }

  it('measures to the wall faces, not to the lines they were drawn on', () => {
    // 400 by 300 of centrelines, with half a 12 cm wall standing inside each.
    expect(floors([run('a', rect(0, 0, 400, 300))])).toEqual([388 * 288])
  })

  it('leaves the plan its own centreline area to lay out and nest by', () => {
    const [only] = enclosuresOf([run('a', rect(0, 0, 400, 300))])
    expect(only.area).toBe(400 * 300)
    expect(only.floor).toBeLessThan(only.area)
  })

  it('gives each of two rooms the half of the party wall it stands on', () => {
    const left = run('left', rect(0, 0, 200, 300))
    const right = run('right', rect(200, 0, 200, 300))
    expect(floors([left, right])).toEqual([188 * 288, 188 * 288])
  })

  it('takes the walls around a cupboard off the floor it stands on', () => {
    const outer = run('outer', rect(0, 0, 400, 300))
    const cupboard = run('cupboard', rect(100, 100, 100, 100))
    // The room keeps what is inside its own walls, less the whole of what the
    // cupboard and its walls stand on; the cupboard keeps what is inside its.
    expect(floors([outer, cupboard]).sort((a, b) => b - a)).toEqual([
      388 * 288 - 112 * 112,
      88 * 88,
    ])
  })

  it('has no floor to give a room narrower than the walls closing it in', () => {
    const strip = enclosuresOf([run('strip', rect(0, 0, 10, 400))])
    for (const found of strip) expect(found.floor).toBe(0)
  })

  it('measures a closet to its faces, open front and all', () => {
    // Its front is drawn open, but the wall it is set into still stands there.
    expect(closetFloor(run('coats', rect(0, 0, 180, 60)))).toBeCloseTo(
      168 * 48,
      9,
    )
  })

  it('adds the rooms up to the floor the whole plan has', () => {
    const walls = [
      run('left', rect(0, 0, 200, 300)),
      run('right', rect(200, 0, 200, 300)),
    ]
    expect(planFloors(walls).floor).toBe(2 * 188 * 288)
    expect(planFloors(walls).area).toBe(400 * 300)
  })
})
