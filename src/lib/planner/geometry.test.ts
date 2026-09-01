import { describe, expect, it } from 'bun:test'

import {
  angleBetween,
  distance,
  editWallGeometry,
  outlineIssue,
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
    const result = editWallGeometry(RECTANGLE, 0, { length: 525 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.points[0]).toEqual(RECTANGLE[0])
    expect(distance(result.points[0], result.points[1])).toBeCloseTo(525, 8)
    expect(angleBetween(result.points[0], result.points[1])).toBeCloseTo(0, 8)
    expect(result.points.slice(2)).toEqual(RECTANGLE.slice(2))
    expect(outlineIssue(RECTANGLE, result.points)).toBeNull()
  })

  it('sets an irregular wall angle without disconnecting either adjoining wall', () => {
    const result = editWallGeometry(IRREGULAR, 1, { angle: 60 })

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
    expect(outlineIssue(IRREGULAR, result.points)).toBeNull()
  })

  it('rejects a dimension that would cross the room over itself', () => {
    const result = editWallGeometry(RECTANGLE, 0, {
      length: 200,
      angle: 180,
    })

    expect(result).toEqual({
      ok: false,
      error: 'That change would make the room cross over itself.',
    })
  })
})
