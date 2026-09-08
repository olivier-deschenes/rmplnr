import {
  closeWallPoints,
  distance,
  drawnWallIssue,
  loopsBack,
} from './geometry.ts'

import type { Point, WallRun, WallDraft } from './types.ts'

/** Read the active end from saved geometry, including edits made while drawing. */
export function draftPoints(
  walls: Array<WallRun>,
  draft: WallDraft | null,
): Array<Point> {
  if (!draft) return []
  if ('start' in draft) return [draft.start]
  const run = walls.find((candidate) => candidate.id === draft.runId)
  if (!run || run.locked) return []
  return draft.end === 'start' ? [...run.points].reverse() : run.points
}

/** Apply the axis lock after snapping so another wall cannot pull it off-axis. */
export function straightPoint(start: Point, point: Point): Point {
  return Math.abs(point.x - start.x) >= Math.abs(point.y - start.y)
    ? { x: point.x, y: start.y }
    : { x: start.x, y: point.y }
}

export function closingIssue(
  points: Array<Point>,
  straight: boolean,
): string | null {
  if (points.length < 3)
    return 'Draw at least two walls before closing the room.'
  const first = points[0]
  const last = points[points.length - 1]
  if (
    straight &&
    Math.abs(first.x - last.x) > 1e-6 &&
    Math.abs(first.y - last.y) > 1e-6
  ) {
    return 'Add another corner to close the room with a horizontal or vertical wall.'
  }
  return drawnWallIssue(closeWallPoints(points))
}

export function nearestOpenEnd(
  walls: Array<WallRun>,
  point: Point,
  reach: number,
): { runId: string; end: 'start' | 'end'; point: Point } | null {
  let best: { runId: string; end: 'start' | 'end'; point: Point } | null = null
  let nearest = reach
  for (const run of walls) {
    if (loopsBack(run.points) || run.locked) continue
    for (const end of ['start', 'end'] as const) {
      const at =
        end === 'start' ? run.points[0] : run.points[run.points.length - 1]
      const gap = distance(point, at)
      if (gap <= nearest) {
        best = { runId: run.id, end, point: at }
        nearest = gap
      }
    }
  }
  return best
}
