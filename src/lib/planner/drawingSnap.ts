import { straightPoint } from './drawing.ts'
import { distance, snapPoint } from './geometry.ts'
import { pointOnWall, projectT, runWallAt, wallCount } from './openings.ts'
import { alignTo, snapTargets } from './snapping.ts'

import type { Guide } from './snapping.ts'
import type { Point, WallRun } from './types.ts'

export type DrawingSnap = {
  point: Point
  guides: Array<Guide>
  label: 'Corner' | 'Midpoint' | 'On wall' | 'Aligned' | null
}

/** Resolve the preview and placed endpoint together, before grid rounding. */
export function snapDrawingPoint({
  point: raw,
  walls,
  anchor,
  straight,
  reach,
  step,
  previous = [],
}: {
  point: Point
  walls: Array<WallRun>
  anchor?: Point
  straight: boolean
  reach: number
  step: number | null
  previous?: Array<Guide>
}): DrawingSnap {
  const point = anchor && straight ? straightPoint(anchor, raw) : raw
  const locked = anchor && straight ? (point.y === anchor.y ? 'y' : 'x') : null
  const targets = snapTargets(walls)
  if (anchor) {
    targets.xs.push({ value: anchor.x, from: anchor.y, to: anchor.y })
    targets.ys.push({ value: anchor.y, from: anchor.x, to: anchor.x })
  }

  // Corners win over midpoints, which win over an arbitrary point on a wall.
  const candidates: Array<{
    point: Point
    label: DrawingSnap['label']
    rank: number
  }> = []
  for (const run of walls) {
    for (const corner of run.points) {
      candidates.push({ point: corner, label: 'Corner', rank: 0 })
    }
    for (let i = 0; i < wallCount(run); i++) {
      const wall = runWallAt(run, i)
      if (!wall) continue
      candidates.push({
        point: pointOnWall(wall, 0.5),
        label: 'Midpoint',
        rank: 1,
      })
      // A straight wall meets angled walls at the actual intersection, never
      // at a projected point that would pull the new wall off its axis.
      const span = locked ? wall.b[locked] - wall.a[locked] : 0
      if (
        locked &&
        Math.abs(span) < 1e-6 &&
        Math.abs(wall.a[locked] - point[locked]) > 1e-6
      )
        continue
      const t =
        locked && Math.abs(span) >= 1e-6
          ? (point[locked] - wall.a[locked]) / span
          : projectT(wall, point)
      if (t >= 0 && t <= 1) {
        candidates.push({
          point: pointOnWall(wall, t),
          label: 'On wall',
          rank: 2,
        })
      }
    }
  }
  const hit = candidates
    .filter(
      (candidate) =>
        (!anchor || distance(candidate.point, anchor) > 1e-6) &&
        (!locked || Math.abs(candidate.point[locked] - point[locked]) < 1e-6) &&
        distance(candidate.point, point) <= reach,
    )
    .sort(
      (a, b) =>
        a.rank - b.rank || distance(a.point, point) - distance(b.point, point),
    )
    .at(0)
  if (hit) {
    return {
      point: hit.point,
      guides: alignTo([hit.point], targets, 1e-6).guides,
      label: hit.label,
    }
  }

  // Hold a found line a little longer than the entry distance, so a small
  // pointer wobble does not bounce between that line and the grid.
  const held = alignTo(
    [point],
    {
      xs: targets.xs.filter((line) =>
        previous.some((g) => g.axis === 'x' && g.value === line.value),
      ),
      ys: targets.ys.filter((line) =>
        previous.some((g) => g.axis === 'y' && g.value === line.value),
      ),
    },
    reach * 1.6,
  )
  const nearby = alignTo([point], targets, reach)
  const grid = snapPoint(point, step)
  const dx = held.dx ?? nearby.dx
  const dy = held.dy ?? nearby.dy
  const landed = {
    x: locked === 'x' ? point.x : dx === null ? grid.x : point.x + dx,
    y: locked === 'y' ? point.y : dy === null ? grid.y : point.y + dy,
  }
  // Only show lines the final point actually lies on, including axis locking.
  const guides = alignTo([landed], targets, 1e-6).guides
  return { point: landed, guides, label: guides.length ? 'Aligned' : null }
}
