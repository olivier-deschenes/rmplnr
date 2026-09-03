import { describe, expect, it } from 'bun:test'

import {
  angleBetween,
  distance,
  editWallGeometry,
  outlineIssue,
  removeWallGeometry,
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

/** A 400 x 300 room with its bottom-right corner cut off on the slant. */
const CANTED: Array<Point> = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 200 },
  { x: 300, y: 300 },
  { x: 0, y: 300 },
]

describe('removing a wall', () => {
  it('squares off a canted corner by running the walls either side on to meet', () => {
    const result = removeWallGeometry(CANTED, 2)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.points).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ])
  })

  it('closes the ring back up when the wall is the last one', () => {
    // The same room, started from another corner, so the cant is the wall that
    // runs from the last corner round to the first.
    const started: Array<Point> = [
      { x: 300, y: 300 },
      { x: 0, y: 300 },
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
    ]

    const result = removeWallGeometry(started, 4)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.points).toEqual([
      { x: 0, y: 300 },
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
    ])
  })

  it('refuses every wall of a rectangle, whose walls come in parallel pairs', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(removeWallGeometry(RECTANGLE, index)).toEqual({
        ok: false,
        error: 'The walls either side of this one are parallel and never meet.',
      })
    }
  })

  it('refuses to take a room below three walls', () => {
    expect(removeWallGeometry(RECTANGLE.slice(0, 3), 0)).toEqual({
      ok: false,
      error: 'A room needs at least three walls.',
    })
  })

  it('refuses a wall whose neighbours only meet behind themselves', () => {
    // A room that narrows away from its top wall: the two walls beside that one
    // converge below the room, so carrying them on to meet turns both around.
    const trapezoid: Array<Point> = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ]

    expect(removeWallGeometry(trapezoid, 0)).toEqual({
      ok: false,
      error: 'Removing that wall would turn one beside it back on itself.',
    })
  })

  it('refuses a wall that is no longer there', () => {
    expect(removeWallGeometry(CANTED, 9)).toEqual({
      ok: false,
      error: 'This wall no longer exists.',
    })
  })
})
