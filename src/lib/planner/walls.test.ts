import { describe, expect, it } from 'bun:test'

import { drawnWall, planWallPath, wallOverrun, wallPath } from './walls.ts'
import type { Opening, WallRun } from './types.ts'

const top: WallRun = {
  id: 'top',
  name: 'Top',

  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
}
const right: WallRun = {
  id: 'right',
  name: 'Right',

  points: [
    { x: 100, y: 0 },
    { x: 100, y: 200 },
  ],
}

describe('wall joins across separate runs', () => {
  it('draws a continuous corner while keeping each wall’s hit target separate', () => {
    expect(planWallPath([top, right], [])).toContain('M0,0 L100,0 L100,200')
    expect(wallPath([top, right], [], top)).toBe('M0,0 L100,0')
  })

  it('joins reversed endpoints with floating-point rounding', () => {
    const reversed = {
      ...right,
      points: [
        { x: 100, y: 200 },
        { x: 100 + 1e-12, y: 0 },
      ],
    }
    expect(planWallPath([top, reversed], [])).toContain('M0,0 L100,0 L100,200')
  })

  it('caps a wall standing on its own with half a wall at either end', () => {
    expect(planWallPath([top], [])).toBe('M0,0 L100,0 M0,0 L-6,0 M100,0 L106,0')
    expect(wallPath([top], [], top)).toBe('M0,0 L100,0')
  })

  it('joins nothing between walls that stand apart, and caps them both', () => {
    const apart = {
      ...right,
      points: [
        { x: 100, y: 20 },
        { x: 100, y: 200 },
      ],
    }
    expect(planWallPath([top, apart], [])).toBe(
      'M0,0 L100,0 M100,20 L100,200' +
        ' M0,0 L-6,0 M100,0 L106,0 M100,20 L100,14 M100,200 L100,206',
    )
  })

  it('leaves openings at the corner unjoined', () => {
    const gap: Opening = {
      id: 'gap',
      kind: 'opening',
      runId: 'right',
      wall: 0,
      t: 0.25,
      width: 100,
      hinge: 'start',
      swing: 'in',
    }
    expect(planWallPath([top, right], [gap])).toBe(
      'M0,0 L100,0 M100,100 L100,200' +
        ' M0,0 L-6,0 M100,0 L106,0 M100,200 L100,206',
    )
  })

  it('stops the corner stroke at door and window jambs', () => {
    for (const kind of ['door', 'window'] as const) {
      const opening: Opening = {
        id: kind,
        kind,
        runId: 'right',
        wall: 0,
        t: 0.5,
        width: 80,
        hinge: 'start',
        swing: 'in',
      }
      const path = planWallPath([top, right], [opening])
      expect(path).toContain('M0,0 L100,0 L100,60')
      expect(path).toContain('M100,140 L100,200')
      expect(path).not.toContain('L100,0 L100,200')
    }
  })
})

describe('walls built into one another', () => {
  const left: WallRun = {
    id: 'left',
    name: 'Left',
    points: [
      { x: 0, y: -50 },
      { x: 0, y: 200 },
    ],
  }
  const crossed: WallRun = {
    id: 'crossed',
    name: 'Crossed',
    points: [
      { x: 100, y: -50 },
      { x: 100, y: 200 },
    ],
  }

  it('carries a wall set between two others through to their far faces', () => {
    expect(wallOverrun([top, left, crossed], [], 'top', 0)).toEqual([6, 6])
    const path = planWallPath([top, left, crossed], [])
    expect(path).toContain('M0,0 L-6,0')
    expect(path).toContain('M100,0 L106,0')
  })

  it('reaches into a wall its own end meets, and leaves the mitre to draw it', () => {
    expect(wallOverrun([top, right], [], 'top', 0)).toEqual([6, 6])
    expect(planWallPath([top, right], [])).not.toContain('L106,0')
  })

  it('caps an end standing in the open as deeply as one built in', () => {
    expect(wallOverrun([top, crossed], [], 'top', 0)).toEqual([6, 6])
  })

  it('caps an end at a doorway, having nothing there to build into', () => {
    const doorway: Opening = {
      id: 'doorway',
      kind: 'opening',
      runId: 'crossed',
      wall: 0,
      t: 0.2,
      width: 100,
      hinge: 'start',
      swing: 'in',
    }
    expect(wallOverrun([top, crossed], [doorway], 'top', 0)).toEqual([6, 6])
  })

  it('draws the selected wall over the whole of what it covers', () => {
    expect(drawnWall([top, left, crossed], [], 'top', 0)).toEqual([
      [
        { x: -6, y: 0 },
        { x: 106, y: 0 },
      ],
    ])
  })
})
