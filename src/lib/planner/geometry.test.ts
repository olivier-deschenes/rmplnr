import { describe, expect, it } from 'bun:test'

import {
  angleBetween,
  distance,
  editWallGeometry,
  wallRunIssue,
  closeWallPoints,
  offsetArea,
  polygonArea,
} from './geometry.ts'

import type { Point } from './types.ts'

const RECTANGLE: Array<Point> = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 300 },
  { x: 0, y: 300 },
]

const IRREGULAR: Array<Point> = [
  { x: 0, y: 0 },
  { x: 280, y: 0 },
  { x: 360, y: 120 },
  { x: 230, y: 260 },
  { x: 40, y: 190 },
]

describe('exact wall geometry', () => {
  it('sets an exact rectangle wall length from its fixed start corner', () => {
    const result = editWallGeometry(closeWallPoints(RECTANGLE), 0, {
      length: 525,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.points[0]).toEqual(RECTANGLE[0])
    expect(distance(result.points[0], result.points[1])).toBeCloseTo(525, 8)
    expect(angleBetween(result.points[0], result.points[1])).toBeCloseTo(0, 8)
    expect(result.points.slice(2, -1)).toEqual(RECTANGLE.slice(2))
    expect(wallRunIssue(result.points)).toBeNull()
  })

  it('sets an irregular wall angle without disconnecting either adjoining wall', () => {
    const result = editWallGeometry(closeWallPoints(IRREGULAR), 1, {
      angle: 60,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.points[1]).toEqual(IRREGULAR[1])
    expect(distance(result.points[1], result.points[2])).toBeCloseTo(
      distance(IRREGULAR[1], IRREGULAR[2]),
      8,
    )
    expect(angleBetween(result.points[1], result.points[2])).toBeCloseTo(60, 8)
    expect(result.points[2]).not.toEqual(IRREGULAR[2])
    expect(result.points[3]).toEqual(IRREGULAR[3])
    expect(wallRunIssue(result.points)).toBeNull()
  })
})

describe('a run of walls walked back round to its start', () => {
  /** The rectangle above as the run it was drawn as, ends meeting at (0, 0). */
  const LOOP: Array<Point> = [...RECTANGLE, RECTANGLE[0]]

  it('reads the corner its two ends share as a corner, not a crossing', () => {
    expect(wallRunIssue(LOOP)).toBeNull()

    const result = editWallGeometry(LOOP, 0, { length: 525 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(distance(result.points[0], result.points[1])).toBeCloseTo(525, 8)
    // The far end of the run stays welded to the corner it set off from.
    expect(result.points.at(-1)).toEqual(result.points[0])
  })

  it('still refuses a change that folds the last wall back over the first', () => {
    expect(editWallGeometry(LOOP, 3, { angle: 0 })).toEqual({
      ok: false,
      error: 'That would lay a wall straight back over the one before it.',
    })
  })

  it('refuses a wall folded back over the preceding wall', () => {
    expect(editWallGeometry(LOOP, 1, { angle: 180 })).toEqual({
      ok: false,
      error: 'That would lay a wall straight back over the one before it.',
    })
  })
})

describe('offset area', () => {
  /** Offset a ring the long way round, to check the arithmetic against it. */
  function insetByHand(points: Array<Point>, by: number): number {
    const wound =
      points.reduce((sum, a, i) => {
        const b = points[(i + 1) % points.length]
        return sum + (a.x * b.y - b.x * a.y)
      }, 0) >= 0
        ? points
        : [...points].reverse()

    // Every edge moved `by` inwards, then the corners put back where the
    // moved edges now cross.
    const moved = wound.map((a, i) => {
      const b = wound[(i + 1) % wound.length]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      // Wound as above, the inside of the ring is to the left of every edge.
      const into = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
      return {
        a: { x: a.x + into.x * by, y: a.y + into.y * by },
        b: { x: b.x + into.x * by, y: b.y + into.y * by },
      }
    })
    const corners = moved.map((edge, i) => {
      const previous = moved[(i + moved.length - 1) % moved.length]
      const p = {
        x: previous.b.x - previous.a.x,
        y: previous.b.y - previous.a.y,
      }
      const q = { x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y }
      const cross = p.x * q.y - p.y * q.x
      const t =
        ((edge.a.x - previous.a.x) * q.y - (edge.a.y - previous.a.y) * q.x) /
        cross
      return { x: previous.a.x + p.x * t, y: previous.a.y + p.y * t }
    })
    return polygonArea(corners)
  }

  it('takes a strip off every edge of a rectangle', () => {
    expect(offsetArea(RECTANGLE, 6)).toBeCloseTo((400 - 12) * (300 - 12), 9)
  })

  it('gives a wall its own half back on each side when offset outwards', () => {
    expect(offsetArea(RECTANGLE, -6)).toBeCloseTo((400 + 12) * (300 + 12), 9)
  })

  it('reads the same whichever way round the corners were written', () => {
    expect(offsetArea([...IRREGULAR].reverse(), 6)).toBeCloseTo(
      offsetArea(IRREGULAR, 6),
      9,
    )
  })

  it('agrees with offsetting the ring and measuring what comes out', () => {
    for (const ring of [RECTANGLE, IRREGULAR]) {
      for (const by of [-12, -6, 0, 6, 12]) {
        expect(offsetArea(ring, by)).toBeCloseTo(insetByHand(ring, by), 6)
      }
    }
  })

  it('takes the wedge back off again at a corner that turns inwards', () => {
    // An L: five corners turning one way and one turning back on itself.
    const ell: Array<Point> = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 300 },
      { x: 0, y: 300 },
    ]
    expect(offsetArea(ell, 25)).toBeCloseTo(insetByHand(ell, 25), 6)
    // 70_000 − 1_200·25 + 625·(5 − 1), by hand.
    expect(offsetArea(ell, 25)).toBeCloseTo(42_500, 9)
  })

  it('leaves no floor at all in a ring narrower than the offset', () => {
    expect(offsetArea(RECTANGLE, 400)).toBe(0)
  })

  it('reads a run closed by repeating its first corner as that ring', () => {
    expect(offsetArea(closeWallPoints(RECTANGLE), 6)).toBeCloseTo(
      offsetArea(RECTANGLE, 6),
      9,
    )
    expect(offsetArea(closeWallPoints(IRREGULAR), 6)).toBeCloseTo(
      offsetArea(IRREGULAR, 6),
      9,
    )
  })

  it('has nothing to measure without a ring', () => {
    expect(
      offsetArea(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        1,
      ),
    ).toBe(0)
  })
})
