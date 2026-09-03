import { distance, outwardSign } from './geometry.ts'
import { OPENING_PRESETS } from './presets.ts'
import { MIN_SIZE } from './types.ts'

import type { Opening, Point, Room } from './types.ts'

/**
 * Doors and windows do not float in the plan: each rides on one wall, and
 * everything about it is read through that wall's own frame. Position is kept
 * as a fraction along the wall so it survives the room being reshaped, and is
 * turned back into centimetres only where a person meets it — the inspector's
 * fields, and the step a drag snaps to. A wall that is stretched has that
 * fraction reckoned again rather than carried over, so what hangs on it holds
 * its place in the plan: see `heldT`.
 */

/** A stretch of a wall, as `[from, to]` fractions of its length. */
export type Span = [number, number]

export type Wall = {
  a: Point
  b: Point
  length: number
  /** Unit vector from `a` towards `b`. */
  tangent: Point
  /** Unit vector across the wall, pointing out of the room. */
  normal: Point
}

type OpeningPlacement = Pick<Opening, 'id' | 'kind' | 'roomId' | 'wall' | 't'> &
  Partial<Pick<Opening, 'width' | 'hinge' | 'swing' | 'wallRemoval'>>

/** The wall running from `points[index]` to the point after it. */
export function wallAt(points: Array<Point>, index: number): Wall | null {
  if (index < 0 || index >= points.length) return null
  const a = points[index]
  const b = points[(index + 1) % points.length]
  const length = distance(a, b)
  if (length === 0) return null
  const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const sign = outwardSign(points)
  return {
    a,
    b,
    length,
    tangent,
    normal: { x: tangent.y * sign, y: -tangent.x * sign },
  }
}

/** The wall an opening hangs on, or null once its room or corner has gone. */
export function openingWall(rooms: Array<Room>, opening: Opening): Wall | null {
  const room = rooms.find((r) => r.id === opening.roomId)
  return room ? wallAt(room.points, opening.wall) : null
}

/** A wall only holds so much: a wider opening is trimmed down to fit it. */
export function fittedWidth(width: number, length: number): number {
  return Math.max(Math.min(MIN_SIZE, length), Math.min(width, length))
}

/** Hold the whole opening on its wall, both jambs included. */
export function clampT(t: number, width: number, length: number): number {
  const half = fittedWidth(width, length) / 2 / length
  return Math.min(1 - half, Math.max(half, t))
}

/** Build any door, window or gap through the same wall-fitting path. */
export function openingInWall(
  frame: Wall,
  placement: OpeningPlacement,
): Opening {
  const width = fittedWidth(
    placement.width ?? OPENING_PRESETS[placement.kind].width,
    frame.length,
  )
  return {
    ...placement,
    width,
    t: clampT(placement.t, width, frame.length),
    hinge: placement.hinge ?? 'start',
    swing: placement.swing ?? 'in',
  }
}

export function pointOnWall(wall: Wall, t: number): Point {
  return {
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    y: wall.a.y + (wall.b.y - wall.a.y) * t,
  }
}

/** Centre and jambs of an opening, in world coordinates, fitted to its wall. */
export function openingEnds(
  wall: Wall,
  opening: Pick<Opening, 't' | 'width' | 'wallRemoval'>,
): { centre: Point; start: Point; end: Point; width: number } {
  const width = opening.wallRemoval
    ? wall.length
    : fittedWidth(opening.width, wall.length)
  const centre = pointOnWall(
    wall,
    opening.wallRemoval ? 0.5 : clampT(opening.t, opening.width, wall.length),
  )
  const half = width / 2
  return {
    width,
    centre,
    start: {
      x: centre.x - wall.tangent.x * half,
      y: centre.y - wall.tangent.y * half,
    },
    end: {
      x: centre.x + wall.tangent.x * half,
      y: centre.y + wall.tangent.y * half,
    },
  }
}

/** The stretch of its wall an opening covers, as a `[from, to]` fraction. */
export function openingSpan(
  wall: Wall,
  opening: Pick<Opening, 't' | 'width' | 'wallRemoval'>,
): Span {
  if (opening.wallRemoval) return [0, 1]
  const half = fittedWidth(opening.width, wall.length) / 2 / wall.length
  const t = clampT(opening.t, opening.width, wall.length)
  return [t - half, t + half]
}

/**
 * Where along the wall `p` falls, as a fraction. Runs past 0 and 1 for a point
 * beyond either end, which is how a neighbouring room's wall — longer than this
 * one, or offset along it — gets read onto it.
 */
export function projectAlong(wall: Wall, p: Point): number {
  const along =
    (p.x - wall.a.x) * wall.tangent.x + (p.y - wall.a.y) * wall.tangent.y
  return along / wall.length
}

/** Where along the wall `p` falls, as a fraction, clamped to the wall itself. */
export function projectT(wall: Wall, p: Point): number {
  return Math.min(1, Math.max(0, projectAlong(wall, p)))
}

export function wallDistance(wall: Wall, p: Point): number {
  return distance(p, pointOnWall(wall, projectT(wall, p)))
}

/** The wall nearest `p` within `reach`, for dropping a new opening onto. */
export function nearestWall(
  rooms: Array<Room>,
  p: Point,
  reach: number,
): { roomId: string; wall: number; t: number } | null {
  let best: { roomId: string; wall: number; t: number; d: number } | null = null
  for (const room of rooms) {
    for (let i = 0; i < room.points.length; i++) {
      const wall = wallAt(room.points, i)
      if (!wall) continue
      const d = wallDistance(wall, p)
      if (d <= reach && (!best || d < best.d)) {
        best = { roomId: room.id, wall: i, t: projectT(wall, p), d }
      }
    }
  }
  return best && { roomId: best.roomId, wall: best.wall, t: best.t }
}

/**
 * Keep a room's openings where they look like they are after its corner list
 * changes. Adding or removing a corner renumbers every wall after it and splits
 * or merges the ones around it, so each opening is read back from where it was
 * standing: whichever wall of the new outline passes nearest to it takes it on.
 *
 * Only for changes to the list of corners. Moving one is left alone, so that a
 * dragged corner stretches its walls and takes their openings along.
 */
export function reattachOpenings(
  openings: Array<Opening>,
  roomId: string,
  before: Array<Point>,
  after: Array<Point>,
): Array<Opening> {
  return openings.map((opening) => {
    if (opening.roomId !== roomId) return opening
    const was = wallAt(before, opening.wall)
    if (!was) return opening
    const { centre } = openingEnds(was, opening)

    let best: { index: number; wall: Wall; d: number } | null = null
    for (let i = 0; i < after.length; i++) {
      const wall = wallAt(after, i)
      if (!wall) continue
      const d = wallDistance(wall, centre)
      if (!best || d < best.d) best = { index: i, wall, d }
    }
    if (!best) return opening

    return {
      ...opening,
      wall: best.index,
      t: clampT(projectT(best.wall, centre), opening.width, best.wall.length),
    }
  })
}

/**
 * Where something standing at `t` on `was` stands on the same wall once it has
 * been stretched into `now`.
 *
 * A fraction is the wrong thing to keep when a room is made bigger: the wall
 * grows and everything riding on it slides along in proportion, so widening a
 * room drags its door and its windows off the spots they were put on. What is
 * kept instead is the distance from whichever end of the wall stayed where it
 * was, and the wall grows past the door rather than under it.
 *
 * A wall that moved at both ends was slid or turned as a whole rather than
 * stretched from one end — the wall a person pushed, or a room dragged across
 * the plan — and everything on it travels with it, which is what the plain
 * fraction already does.
 */
export function heldT(was: Wall, now: Wall, t: number): number {
  if (samePoint(was.a, now.a)) return (t * was.length) / now.length
  if (samePoint(was.b, now.b)) return 1 - ((1 - t) * was.length) / now.length
  return t
}

/** Hold one opening in place through a change to the outline it is cut into. */
export function heldOpening(
  opening: Opening,
  before: Array<Point>,
  after: Array<Point>,
): Opening {
  if (opening.wallRemoval) return opening
  const was = wallAt(before, opening.wall)
  const now = wallAt(after, opening.wall)
  if (!was || !now) return opening
  const t = clampT(heldT(was, now, opening.t), opening.width, now.length)
  return t === opening.t ? opening : { ...opening, t }
}

/**
 * Hold every opening in the rooms whose outlines have just changed, `before`
 * carrying the corners each of those rooms was drawn with. Openings in rooms
 * left alone are returned untouched, as are those whose wall came through the
 * change unstretched.
 */
export function heldOpenings(
  openings: Array<Opening>,
  before: Map<string, Array<Point>>,
  after: Array<Room>,
): Array<Opening> {
  if (before.size === 0) return openings
  return openings.map((opening) => {
    const was = before.get(opening.roomId)
    const room = was && after.find((r) => r.id === opening.roomId)
    return room ? heldOpening(opening, was, room.points) : opening
  })
}

/** The stretches of a wall still standing once `gaps` are cut out of it. */
export function wallSegments(
  wall: Wall,
  gaps: Array<Span>,
): Array<[Point, Point]> {
  const cuts = [...gaps].sort((a, b) => a[0] - b[0])

  const segments: Array<[Point, Point]> = []
  let from = 0
  for (const [start, end] of cuts) {
    if (start > from) {
      segments.push([pointOnWall(wall, from), pointOnWall(wall, start)])
    }
    from = Math.max(from, end)
  }
  if (from < 1) segments.push([pointOnWall(wall, from), pointOnWall(wall, 1)])
  return segments
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

/**
 * The room's outline as SVG path data, with the pen lifted at every gap.
 *
 * Walls that run into each other unbroken stay in one subpath, so a corner
 * between two solid walls keeps its mitre; only an opening starts a new one. A
 * room with nothing cut into it comes out as the closed loop it was before.
 */
export function outlinePath(
  points: Array<Point>,
  gaps: Array<Array<Span>>,
): string {
  const lines: Array<Array<Point>> = []
  let run: Array<Point> | null = null

  for (let i = 0; i < points.length; i++) {
    const wall = wallAt(points, i)
    if (!wall) continue
    for (const [a, b] of wallSegments(wall, gaps[i] ?? [])) {
      if (run && samePoint(run[run.length - 1], a)) run.push(b)
      else {
        if (run) lines.push(run)
        run = [a, b]
      }
    }
  }
  if (run) lines.push(run)
  if (lines.length === 0) return ''

  // The walk began part-way along the first wall's run, so the stretch that
  // came back round past the last corner is the front of it.
  const first = lines[0]
  const last = lines[lines.length - 1]
  const loops = samePoint(last[last.length - 1], first[0])
  // Whether the pen ever came up, which has to be settled before the two ends
  // are joined below: that join leaves one run behind either way, so asking
  // afterwards cannot tell a room with nothing cut into it from one whose
  // single gap has just been folded into the seam — and closing the latter
  // draws the missing wall straight back across its own doorway.
  const whole = loops && lines.length === 1
  if (loops && lines.length > 1) {
    lines[0] = [...last.slice(0, -1), ...first]
    lines.pop()
  }

  return lines
    .map((line, index) => {
      const closed = whole && index === 0
      const draw = closed ? line.slice(0, -1) : line
      return (
        draw.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') +
        (closed ? ' Z' : '')
      )
    })
    .join(' ')
}
