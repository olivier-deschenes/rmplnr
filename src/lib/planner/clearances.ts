import { furnitureCorners } from './geometry.ts'
import { blockersFor, spanAlong } from './collision.ts'
import { closetSize } from './closets.ts'
import {
  clampT,
  fittedWidth,
  openingWall,
  pointOnWall,
  roomWallAt,
  wallAt,
} from './openings.ts'
import { wallGaps } from './walls.ts'

import type { Blocker } from './collision.ts'
import type { Span, Wall } from './openings.ts'
import type { Furniture, Opening, Point, Room, Selection } from './types.ts'

/**
 * How much room is left around the thing being moved.
 *
 * A plan is drawn as much by the gaps as by what fills them: a fridge door
 * needs the wall beside it, a window wants to sit a sensible distance from the
 * corner, and whether a walkway is wide enough is a question about the space
 * between two pieces of furniture rather than about either of them. So while
 * something is being dragged, the plan says what it is leaving behind — and it
 * says it in the same hand as every other dimension, because a clearance is a
 * dimension and nothing more.
 *
 * Two kinds of thing are measured, because two kinds of thing move. Furniture
 * moves across the floor, and is measured off each of its four faces to
 * whatever that face is looking at — the same walls and the same neighbours
 * that would stop it if it kept going, so the number reads as the room left in
 * the direction of travel. A door, a window or a closet moves along one wall
 * and cannot leave it, so it is measured the way a joiner would measure it:
 * along the wall, from each jamb to whatever the wall holds next — the corner
 * it runs into, the next opening, the closet beside it.
 *
 * Everything here is in world centimetres, as everywhere else in the plan.
 */

/** A gap worth naming: where it runs from and to, and how wide it is. */
export type Clearance = {
  key: string
  from: Point
  to: Point
  distance: number
}

/**
 * Gaps under this are nothing: a table brought to rest against a wall is
 * touching it, and a dimension line that says so is a dimension line in the
 * way. Half a millimetre, the same slack collisions are settled at.
 */
const TOUCHING = 0.05

/** The four faces of a piece of furniture, in the order its corners come back. */
const FACES = ['n', 'e', 's', 'w']

/** Rounding slack, for spans that meet exactly. */
const EPSILON = 1e-9

/** The outward normal of each edge, unnormalised: enough to separate by. */
function edgeAxes(points: Array<Point>): Array<Point> {
  const axes: Array<Point> = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    axes.push({ x: a.y - b.y, y: b.x - a.x })
  }
  return axes
}

/**
 * How far `moving` travels along `dir` before it comes up against `fixed`, or
 * null when the two never meet on that heading.
 *
 * Both outlines are convex, so a line square to an edge of one of them tells
 * them apart whenever they are apart at all. Each such line holds them apart
 * up to some distance travelled and no further, so the shapes touch as soon as
 * the last of those lines gives out: the answer is the furthest of them. A line
 * that the travel never closes — one the shapes are drawing apart along, or
 * sliding past each other on — is one they never meet across, and settles the
 * question on its own.
 */
export function gapAlong(
  moving: Array<Point>,
  fixed: Array<Point>,
  dir: Point,
): number | null {
  let touch = 0
  for (const axis of [...edgeAxes(moving), ...edgeAxes(fixed)]) {
    const closing = axis.x * dir.x + axis.y * dir.y
    const [from, to] = spanAlong(moving, axis)
    const [at, past] = spanAlong(fixed, axis)

    let exit: number
    if (to <= at + EPSILON) {
      // The moving shape lies below the fixed one on this line.
      if (closing <= EPSILON) return null
      exit = (at - to) / closing
    } else if (past <= from + EPSILON) {
      if (closing >= -EPSILON) return null
      exit = (past - from) / closing
    } else {
      // This line does not part them as they stand, and so has nothing to say
      // about when they meet.
      continue
    }
    touch = Math.max(touch, exit)
  }
  return touch
}

/** The nearest thing `moving` would meet heading `dir`, of everything given. */
function reach(
  moving: Array<Point>,
  dir: Point,
  blockers: Array<Blocker>,
): { gap: number; met: Array<Point> } | null {
  let nearest: { gap: number; met: Array<Point> } | null = null
  for (const blocker of blockers) {
    const gap = gapAlong(moving, blocker.points, dir)
    if (gap === null) continue
    if (nearest === null || gap < nearest.gap) {
      nearest = { gap, met: blocker.points }
    }
  }
  return nearest
}

/**
 * Where along a face its dimension stands: over the stretch of it that really
 * has the other thing in front of it. A cabinet whose corner alone is looking
 * at a table is measured at that corner, because a line dropped from the
 * middle of the face would come down in open floor and measure nothing.
 */
function metAt(face: Wall, met: Array<Point>): Point {
  const [from, to] = spanAlong([face.a, face.b], face.tangent)
  const [at, past] = spanAlong(met, face.tangent)
  const low = Math.max(from, at)
  const high = Math.min(to, past)
  const along = low <= high ? (low + high) / 2 : (from + to) / 2
  const base = face.a.x * face.tangent.x + face.a.y * face.tangent.y
  return {
    x: face.a.x + face.tangent.x * (along - base),
    y: face.a.y + face.tangent.y * (along - base),
  }
}

/**
 * What each face of a piece of furniture is looking at, measured square out of
 * it. A face already up against something is left unmeasured: there is no gap
 * there to report.
 */
export function furnitureClearances(
  item: Furniture,
  blockers: Array<Blocker>,
): Array<Clearance> {
  const corners = furnitureCorners(item)
  const clearances: Array<Clearance> = []

  for (let i = 0; i < corners.length; i++) {
    const face = wallAt(corners, i)
    if (!face) continue
    const found = reach(corners, face.normal, blockers)
    if (!found || found.gap < TOUCHING) continue
    const from = metAt(face, found.met)
    clearances.push({
      key: FACES[i],
      from,
      to: {
        x: from.x + face.normal.x * found.gap,
        y: from.y + face.normal.y * found.gap,
      },
      distance: found.gap,
    })
  }
  return clearances
}

/**
 * What is left of a wall either side of the stretch `span` covers, given the
 * other stretches `gaps` already spoken for. The wall's own two ends stand in
 * where nothing else does: a window with clear wall to the corner is measured
 * to the corner.
 *
 * `span` is in centimetres along the wall; `gaps`, as everywhere they are
 * passed about, are fractions of it.
 */
function alongWall(
  wall: Wall,
  span: [number, number],
  gaps: Array<Span>,
): Array<Clearance> {
  const cut = gaps.map(
    ([from, to]) => [from * wall.length, to * wall.length] as const,
  )
  const before = Math.max(
    0,
    ...cut.filter(([, to]) => to <= span[0] + EPSILON).map(([, to]) => to),
  )
  const after = Math.min(
    wall.length,
    ...cut.filter(([from]) => from >= span[1] - EPSILON).map(([from]) => from),
  )

  return (
    [
      { key: 'start', at: before, jamb: span[0] },
      { key: 'end', at: after, jamb: span[1] },
    ] as const
  )
    .filter(({ at, jamb }) => Math.abs(at - jamb) >= TOUCHING)
    .map(({ key, at, jamb }) => ({
      key,
      from: pointOnWall(wall, at / wall.length),
      to: pointOnWall(wall, jamb / wall.length),
      distance: Math.abs(at - jamb),
    }))
}

/**
 * How much wall a door or a window has either side of it. Everything else cut
 * through the same wall is in the way, its neighbours' openings included: a
 * door through a party wall is one hole, whichever room it is listed under.
 */
export function openingClearances(
  rooms: Array<Room>,
  openings: Array<Opening>,
  opening: Opening,
): Array<Clearance> {
  const wall = openingWall(rooms, opening)
  if (!wall) return []
  const width = fittedWidth(opening.width, wall.length)
  const centre = clampT(opening.t, opening.width, wall.length) * wall.length
  return alongWall(
    wall,
    [centre - width / 2, centre + width / 2],
    wallGaps(
      rooms,
      openings.filter((other) => other.id !== opening.id),
      opening.roomId,
      opening.wall,
    ),
  )
}

/**
 * The same, for a closet: it rides along its host wall exactly as an opening
 * does, and takes up the stretch of it that its open front covers.
 */
export function closetClearances(
  rooms: Array<Room>,
  openings: Array<Opening>,
  closet: Room,
): Array<Clearance> {
  const attachment = closet.attachment
  if (!attachment) return []
  const host = rooms.find((room) => room.id === attachment.roomId)
  const wall = host && roomWallAt(host, attachment.wall)
  if (!wall) return []

  const width = fittedWidth(closetSize(closet).width, wall.length)
  const centre = clampT(attachment.t, width, wall.length) * wall.length
  return alongWall(
    wall,
    [centre - width / 2, centre + width / 2],
    // The closet is taken out of the plan first: the stretch of wall it stands
    // on is what is being measured, not something for it to run into.
    wallGaps(
      rooms.filter((room) => room.id !== closet.id),
      openings,
      attachment.roomId,
      attachment.wall,
    ),
  )
}

/**
 * What the plan has to say about the room around whatever is selected, of the
 * things that carry a clearance at all. A room being dragged carries none: it
 * has no clearances of its own, only walls, and the snap guides already say
 * what a wall has found.
 *
 * The blockers are read whether or not collisions are switched on. What is
 * measured is the gap that is there, and the gap is there either way.
 */
export function clearancesFor(
  selection: Selection,
  rooms: Array<Room>,
  furniture: Array<Furniture>,
  openings: Array<Opening>,
): Array<Clearance> {
  if (!selection) return []

  if (selection.type === 'furniture') {
    const item = furniture.find((f) => f.id === selection.id)
    return item
      ? furnitureClearances(
          item,
          blockersFor(rooms, furniture, openings, item.id),
        )
      : []
  }

  if (selection.type === 'opening') {
    const opening = openings.find((o) => o.id === selection.id)
    return opening ? openingClearances(rooms, openings, opening) : []
  }

  if (selection.type === 'wall') return []

  const room = rooms.find((r) => r.id === selection.id)
  return room?.kind === 'closet' ? closetClearances(rooms, openings, room) : []
}
