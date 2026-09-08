import { describe, expect, it } from 'bun:test'

import {
  angleBetween,
  distance,
  editWallGeometry,
  wallRunIssue,
  closeWallPoints,
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
