import { describe, expect, it } from 'bun:test'

import { planWallPath, wallPath } from './walls.ts'
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

  it('does not extend a free wall end or join walls that do not touch', () => {
    expect(planWallPath([top], [])).toBe(wallPath([top], [], top))
    const offset = {
      ...right,
      points: [
        { x: 100, y: 2 },
        { x: 100, y: 200 },
      ],
    }
    expect(planWallPath([top, offset], [])).toBe('M0,0 L100,0 M100,2 L100,200')
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
      'M0,0 L100,0 M100,100 L100,200',
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
