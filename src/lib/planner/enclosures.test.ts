import { describe, expect, it } from 'bun:test'

import {
  enclosureAt,
  enclosuresOf,
  freeEnclosures,
  wallLoops,
} from './enclosures.ts'
import { polygonArea } from './geometry.ts'

import type { Point, Room, Space } from './types.ts'

function room(id: string, points: Array<Point>, closed = true): Room {
  return {
    id,
    name: id,
    points,
    ...(closed ? {} : { closed: false }),
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
function areas(rooms: Array<Room>): Array<number> {
  return wallLoops(rooms)
    .map(polygonArea)
    .sort((a, b) => b - a)
}

describe('wallLoops', () => {
  it('finds the one loop a closed room makes', () => {
    expect(areas([room('a', rect(0, 0, 100, 200))])).toEqual([20_000])
  })

  it('finds nothing in a run of walls that closes nothing', () => {
    expect(
      areas([
        room(
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
    const closed = room('a', rect(0, 0, 400, 300))
    // Out from the left wall, round, and back onto it higher up.
    const open = room(
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
    const left = room('a', rect(0, 0, 100, 100))
    const right = room('b', rect(100, 0, 100, 100))
    expect(areas([left, right])).toEqual([10_000, 10_000])
  })

  it('splits a room in two when a wall is drawn across it', () => {
    const outer = room('a', rect(0, 0, 200, 100))
    const divider = room(
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
    const outer = room('a', rect(0, 0, 200, 100))
    const stub = room(
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
    const outer = room('a', rect(0, 0, 200, 200))
    const across = room(
      'b',
      [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      false,
    )
    const down = room(
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
    const across = room(
      'a',
      [
        { x: -50, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 100 },
      ],
      false,
    )
    const back = room(
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
    const open = room(
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
    const closing = room(
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
  const closed = room('a', rect(0, 0, 400, 300))
  const open = room(
    'b',
    [
      { x: 0, y: 0 },
      { x: -200, y: 0 },
      { x: -200, y: 150 },
      { x: 0, y: 150 },
    ],
    false,
  )

  it('gives the room it was drawn as back to a closed room', () => {
    const found = enclosuresOf([closed, open])
    expect(found).toHaveLength(2)
    expect(found[0].roomId).toBe('a')
    expect(found[1].roomId).toBeNull()
  })

  it('leaves out a space walled off inside a room already drawn', () => {
    const divider = room(
      'c',
      [
        { x: 200, y: 0 },
        { x: 200, y: 300 },
      ],
      false,
    )
    const found = freeEnclosures([closed, divider])
    expect(found).toEqual([])
  })

  it('puts a saved name on the space its point stands in', () => {
    const space: Space = {
      id: 's1',
      name: 'Pantry',
      color: '#ff0000',
      seed: { x: -100, y: 75 },
    }
    const [free] = freeEnclosures([closed, open], [space])
    expect(free.space?.name).toBe('Pantry')
    expect(free.space?.color).toBe('#ff0000')
  })

  it('keeps a name whose space no longer exists rather than moving it', () => {
    const space: Space = { id: 's1', name: 'Pantry', seed: { x: -100, y: 75 } }
    // The run is gone, so nothing encloses the point any more.
    expect(freeEnclosures([closed], [space])).toEqual([])
  })

  it('gives each space its own name when two are saved', () => {
    const second = room(
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
    const names = freeEnclosures([closed, open, second], spaces).map(
      (enclosure) => enclosure.space?.name,
    )
    expect(names.sort()).toEqual(['Pantry', 'Porch'])
  })

  it('keys a space by its corners, and keeps that key across a redraw', () => {
    const first = freeEnclosures([closed, open])[0].key
    const again = freeEnclosures([{ ...closed }, { ...open }])[0].key
    expect(again).toBe(first)
  })

  it('gives a space a different key once one of its walls moves', () => {
    const moved = {
      ...open,
      points: open.points.map((p) => (p.x === -200 ? { ...p, x: -210 } : p)),
    }
    expect(freeEnclosures([closed, moved])[0].key).not.toBe(
      freeEnclosures([closed, open])[0].key,
    )
  })
})

describe('enclosureAt', () => {
  it('answers with the space a point stands in', () => {
    const closed = room('a', rect(0, 0, 400, 300))
    const open = room(
      'b',
      [
        { x: 0, y: 0 },
        { x: -200, y: 0 },
        { x: -200, y: 150 },
        { x: 0, y: 150 },
      ],
      false,
    )
    const found = freeEnclosures([closed, open])
    expect(enclosureAt(found, { x: -100, y: 75 })?.roomId).toBeNull()
    expect(enclosureAt(found, { x: 200, y: 150 })).toBeNull()
  })
})

describe('the plan a reader brought in', () => {
  // Room 1 closed, and three open walls run out from its left wall and back.
  const rooms: Array<Room> = [
    room('room-1', [
      { x: -360.68, y: -411.48 },
      { x: 459.74, y: -411.48 },
      { x: 459.74, y: 182.88 },
      { x: -360.68, y: 182.88 },
    ]),
    room(
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
    const found = enclosuresOf(rooms)
    expect(found).toHaveLength(2)
    expect(found[0].roomId).toBe('room-1')
    expect(found[1].roomId).toBeNull()
    expect(found[1].area).toBeCloseTo(360.68 * 304.8, 4)
  })
})

describe('what is not a room', () => {
  it('ignores the hairline between two walls drawn a hair apart', () => {
    // Two rooms meant to be flush, whose shared wall was drawn 4 cm out.
    const left = room('a', rect(0, 0, 400, 300))
    const right = room('b', rect(404, 0, 400, 300))
    expect(areas([left, right])).toEqual([120_000, 120_000])
  })

  it('still finds a narrow room that is a room', () => {
    const cupboard = room('a', rect(0, 0, 40, 200))
    expect(areas([cupboard])).toEqual([8_000])
  })
})
