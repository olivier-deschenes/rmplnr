import {
  openingEnds,
  openingSpan,
  outlinePath,
  projectAlong,
  wallAt,
} from './openings.ts'

import type { Opening, Point, Room } from './types.ts'
import type { Span, Wall } from './openings.ts'

/**
 * Walls have body, and two rooms that meet share the wall between them.
 *
 * A room is still stored as the polygon of its wall centrelines, so nothing
 * about the plan changes here. What changes is what that polygon means when it
 * is drawn: each wall is a band of `WALL_THICKNESS` straddling its centreline,
 * so a room pushed flush against its neighbour lays its band exactly over the
 * neighbour's and the two read as the one wall they are — no seam, no doubled
 * line, no gap. Everything else in this module follows from that: which walls a
 * pair of rooms hold in common, and the doors and windows that therefore have
 * to be cut through both of them at once.
 */

/** How thick a wall is drawn, in centimetres. */
export const WALL_THICKNESS = 12

/** Two wall lines this close together are one wall, seen from either room. */
const JOIN = WALL_THICKNESS / 2
/** How far off parallel two walls may run and still be read as the same one. */
const PARALLEL = 0.02
/** Any less in common than this is a corner touching, not a shared wall. */
const MIN_SHARE = 20

/** A stretch of one room's wall that another room's wall runs along. */
export type Share = {
  roomId: string
  wall: number
  frame: Wall
  span: Span
}

/** How far `p` stands off the wall's line, out of the room being positive. */
function offset(wall: Wall, p: Point): number {
  return (p.x - wall.a.x) * wall.normal.x + (p.y - wall.a.y) * wall.normal.y
}

/** Read a stretch of world between two points back onto a wall, clipped to it. */
function spanBetween(wall: Wall, a: Point, b: Point): Span | null {
  const ends = [projectAlong(wall, a), projectAlong(wall, b)]
  const from = Math.max(0, Math.min(ends[0], ends[1]))
  const to = Math.min(1, Math.max(ends[0], ends[1]))
  return to > from ? [from, to] : null
}

/**
 * The stretch of `wall` that `other` covers, or null when the two are not the
 * same wall. Same means running the same way — either direction, since two
 * rooms wind past their shared wall in opposite senses — lying within half a
 * wall's thickness of each other, and overlapping by more than a corner.
 */
export function sharedSpan(wall: Wall, other: Wall): Span | null {
  const cross =
    wall.tangent.x * other.tangent.y - wall.tangent.y * other.tangent.x
  if (Math.abs(cross) > PARALLEL) return null
  if (Math.abs(offset(wall, other.a)) > JOIN) return null
  if (Math.abs(offset(wall, other.b)) > JOIN) return null

  const span = spanBetween(wall, other.a, other.b)
  return span && (span[1] - span[0]) * wall.length >= MIN_SHARE ? span : null
}

/** Every wall of another room that runs along this one, party-wall fashion. */
export function sharedWalls(
  rooms: Array<Room>,
  roomId: string,
  index: number,
): Array<Share> {
  const room = rooms.find((r) => r.id === roomId)
  const frame = room ? wallAt(room.points, index) : null
  if (!frame) return []

  const shares: Array<Share> = []
  for (const other of rooms) {
    if (other.id === roomId) continue
    for (let i = 0; i < other.points.length; i++) {
      const face = wallAt(other.points, i)
      if (!face) continue
      const span = sharedSpan(frame, face)
      if (span) shares.push({ roomId: other.id, wall: i, frame: face, span })
    }
  }
  return shares
}

/** The rooms this one holds a wall in common with. */
export function neighbours(rooms: Array<Room>, roomId: string): Array<Room> {
  const room = rooms.find((r) => r.id === roomId)
  if (!room) return []
  const ids = new Set<string>()
  for (let i = 0; i < room.points.length; i++) {
    for (const share of sharedWalls(rooms, roomId, i)) ids.add(share.roomId)
  }
  return rooms.filter((r) => ids.has(r.id))
}

/** What is left of `span` once `gaps` are taken out of it. */
function without(span: Span, gaps: Array<Span>): Array<Span> {
  let rest: Array<Span> = [span]
  for (const [from, to] of gaps) {
    rest = rest.flatMap(([a, b]): Array<Span> => {
      if (to <= a || from >= b) return [[a, b]]
      const kept: Array<Span> = []
      if (from > a) kept.push([a, from])
      if (to < b) kept.push([to, b])
      return kept
    })
  }
  return rest
}

/**
 * Every stretch of a room's walls that a neighbour also owns, wall by wall, and
 * standing: a doorway through a party wall is a hole in it, not a piece of it,
 * so the openings are taken back out.
 */
export function sharedSpansOf(
  rooms: Array<Room>,
  openings: Array<Opening>,
  roomId: string,
): Array<{ wall: number; span: Span }> {
  const room = rooms.find((r) => r.id === roomId)
  if (!room) return []
  return room.points.flatMap((_, wall) => {
    const gaps = wallGaps(rooms, openings, roomId, wall)
    return sharedWalls(rooms, roomId, wall).flatMap((share) =>
      without(share.span, gaps).map((span) => ({ wall, span })),
    )
  })
}

/**
 * The stretches to leave out of a wall: its own openings, and those of any room
 * that shares it. A door between two rooms is one hole through one wall, so it
 * has to be cut from both sides of the party wall or the neighbour's leaf would
 * simply fill it back in.
 */
export function wallGaps(
  rooms: Array<Room>,
  openings: Array<Opening>,
  roomId: string,
  index: number,
): Array<Span> {
  const room = rooms.find((r) => r.id === roomId)
  const frame = room ? wallAt(room.points, index) : null
  if (!frame) return []

  const gaps: Array<Span> = []

  for (const opening of openings) {
    if (opening.roomId === roomId && opening.wall === index) {
      gaps.push(openingSpan(frame, opening))
    }
  }

  for (const share of sharedWalls(rooms, roomId, index)) {
    for (const opening of openings) {
      if (opening.roomId !== share.roomId) continue
      if (opening.wall !== share.wall) continue
      const { start, end } = openingEnds(share.frame, opening)
      const span = spanBetween(frame, start, end)
      if (span) gaps.push(span)
    }
  }

  return gaps
}

/** A room's walls as path data, with every opening through them cut out. */
export function wallPath(
  rooms: Array<Room>,
  openings: Array<Opening>,
  room: Room,
): string {
  return outlinePath(
    room.points,
    room.points.map((_, i) => wallGaps(rooms, openings, room.id, i)),
  )
}
