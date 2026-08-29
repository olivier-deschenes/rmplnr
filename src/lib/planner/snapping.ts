import type { Point, Room } from './types.ts'

/**
 * What pulls one room onto another.
 *
 * Rooms only share a wall if their centrelines actually land on top of each
 * other, and no one drags a room to the centimetre by hand. So while a room —
 * or one of its corners, or the rectangle being dragged out — is on the move,
 * every wall line already in the plan is a line it can lock onto, and the
 * nearest one within reach wins. The grid is the fallback, not the other way
 * round: a room that could sit flush against its neighbour does that in
 * preference to sitting on a round number.
 *
 * Everything here is in world centimetres. The caller turns its screen-pixel
 * reach into a world one, so the pull feels the same at every zoom.
 */

/** How near, in screen pixels, before a room locks onto a line in the plan. */
export const SNAP_REACH_PX = 10

/**
 * A line the plan already holds — the x of a wall running up the page, or the
 * y of one running across it — along with how far along that line the walls
 * that put it there reach, so a guide drawn for it spans what it lines up.
 */
export type Line = { value: number; from: number; to: number }

export type Guide = { axis: 'x' | 'y' } & Line

export type Targets = { xs: Array<Line>; ys: Array<Line> }

/** Lines closer together than this are the same line. */
const SAME = 0.5

function add(lines: Array<Line>, value: number, from: number, to: number) {
  const existing = lines.find((line) => Math.abs(line.value - value) < SAME)
  if (existing) {
    existing.from = Math.min(existing.from, from)
    existing.to = Math.max(existing.to, to)
  } else {
    lines.push({ value, from: Math.min(from, to), to: Math.max(from, to) })
  }
}

/**
 * Every line the rooms offer to snap to. Each wall contributes the line it runs
 * along and the two through its ends, which is what lets a room go flush
 * against a neighbour's face as readily as it lines its corners up with one.
 */
export function snapTargets(rooms: Array<Room>, exclude?: string): Targets {
  const xs: Array<Line> = []
  const ys: Array<Line> = []

  for (const room of rooms) {
    if (room.id === exclude) continue
    for (let i = 0; i < room.points.length; i++) {
      const a = room.points[i]
      const b = room.points[(i + 1) % room.points.length]
      add(xs, a.x, a.y, b.y)
      add(xs, b.x, a.y, b.y)
      add(ys, a.y, a.x, b.x)
      add(ys, b.y, a.x, b.x)
    }
  }

  return { xs, ys }
}

type Pick = { delta: number; line: Line }

function nearest(
  coords: Array<number>,
  lines: Array<Line>,
  reach: number,
): Pick | null {
  let best: Pick | null = null
  for (const coord of coords) {
    for (const line of lines) {
      const delta = line.value - coord
      if (Math.abs(delta) > reach) continue
      if (!best || Math.abs(delta) < Math.abs(best.delta))
        best = { delta, line }
    }
  }
  return best
}

function extent(values: Array<number>): [number, number] {
  return [Math.min(...values), Math.max(...values)]
}

/**
 * How far `moving` has to shift on each axis to land on the nearest line within
 * `reach`, with a guide for each axis that found one. An axis with nothing in
 * range comes back null, which leaves the caller free to fall back to the grid
 * on that axis alone — so a room can sit flush against a wall one way and on a
 * round number the other.
 */
export function alignTo(
  moving: Array<Point>,
  targets: Targets,
  reach: number,
): { dx: number | null; dy: number | null; guides: Array<Guide> } {
  const x = nearest(
    moving.map((p) => p.x),
    targets.xs,
    reach,
  )
  const y = nearest(
    moving.map((p) => p.y),
    targets.ys,
    reach,
  )

  const dx = x ? x.delta : 0
  const dy = y ? y.delta : 0
  const [top, bottom] = extent(moving.map((p) => p.y + dy))
  const [left, right] = extent(moving.map((p) => p.x + dx))

  const guides: Array<Guide> = []
  if (x) {
    guides.push({
      axis: 'x',
      value: x.line.value,
      from: Math.min(x.line.from, top),
      to: Math.max(x.line.to, bottom),
    })
  }
  if (y) {
    guides.push({
      axis: 'y',
      value: y.line.value,
      from: Math.min(y.line.from, left),
      to: Math.max(y.line.to, right),
    })
  }

  return { dx: x ? x.delta : null, dy: y ? y.delta : null, guides }
}
