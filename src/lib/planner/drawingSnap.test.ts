import { describe, expect, it } from 'bun:test'

import { snapDrawingPoint } from './drawingSnap.ts'
import type { Point, Room } from './types.ts'

const wall: Room = {
  id: 'wall',
  name: 'Wall',
  closed: false,
  points: [
    { x: 103, y: 100 },
    { x: 103, y: 300 },
  ],
}
const defaults = { rooms: [wall], straight: false, reach: 10, step: 25 }

function snap(
  point: Point,
  options: Partial<Parameters<typeof snapDrawingPoint>[0]> = {},
) {
  return snapDrawingPoint({ ...defaults, point, ...options })
}

describe('wall drawing helpers', () => {
  it('aligns with a distant wall before rounding to the grid', () => {
    const result = snap({ x: 109, y: 487 })
    expect(result.point).toEqual({ x: 103, y: 475 })
    expect(result.label).toBe('Aligned')
    expect(result.guides).toContainEqual({
      axis: 'x',
      value: 103,
      from: 100,
      to: 475,
    })
  })

  it('holds alignment through a small wobble and releases beyond the hold distance', () => {
    const previous = snap({ x: 109, y: 487 }).guides
    expect(snap({ x: 117, y: 487 }, { previous }).point.x).toBe(103)
    expect(snap({ x: 121, y: 487 }, { previous }).point.x).toBe(125)
    expect(snap({ x: 117, y: 487 }).point.x).toBe(125)
    expect(snap({ x: 117, y: 487 }, { previous, rooms: [] }).point.x).toBe(125)
  })

  it('snaps exactly to corners, midpoints, and wall faces', () => {
    expect(snap({ x: 109, y: 105 })).toMatchObject({
      point: wall.points[0],
      label: 'Corner',
    })
    expect(snap({ x: 109, y: 204 })).toMatchObject({
      point: { x: 103, y: 200 },
      label: 'Midpoint',
    })
    expect(snap({ x: 109, y: 246 })).toMatchObject({
      point: { x: 103, y: 246 },
      label: 'On wall',
    })
  })

  it('preserves the straight axis and only draws guides through the final point', () => {
    const result = snap(
      { x: 109, y: 106 },
      { anchor: { x: -100, y: 95 }, straight: true },
    )
    expect(result.point).toEqual({ x: 103, y: 95 })
    for (const guide of result.guides)
      expect(guide.value).toBe(result.point[guide.axis])
    expect(result.label).not.toBe('Corner')
  })

  it('finds the intersection of a straight draft and an angled wall', () => {
    const result = snap(
      { x: 143, y: 47 },
      {
        anchor: { x: 0, y: 50 },
        straight: true,
        rooms: [
          {
            ...wall,
            points: [
              { x: 100, y: 0 },
              { x: 300, y: 200 },
            ],
          },
        ],
      },
    )
    expect(result.point).toEqual({ x: 150, y: 50 })
    expect(result.label).toBe('On wall')
  })

  it('does not invent a closing wall across an open run', () => {
    const result = snap(
      { x: 50, y: 50 },
      {
        rooms: [
          {
            ...wall,
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
          },
        ],
        step: null,
      },
    )
    expect(result.label).toBeNull()
  })

  it('supports square drawing from the first unsaved anchor with straight mode off', () => {
    expect(
      snap({ x: 203, y: 11 }, { rooms: [], anchor: { x: 3, y: 7 } }).point,
    ).toEqual({ x: 200, y: 7 })
  })

  it('keeps the same screen-space snap reach at different zoom levels', () => {
    for (const scale of [0.25, 1, 4]) {
      expect(
        snap({ x: 103 + 9 / scale, y: 487 }, { reach: 10 / scale }).point.x,
      ).toBe(103)
      expect(
        snap({ x: 103 + 17 / scale, y: 487 }, { reach: 10 / scale, step: null })
          .point.x,
      ).toBe(103 + 17 / scale)
    }
  })
})
