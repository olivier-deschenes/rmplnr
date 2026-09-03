import {
  clampT,
  heldOpening,
  openingEnds,
  openingSpan,
  outlinePath,
  projectAlong,
  wallAt,
} from './openings.ts'
import { closetSize, heldClosets, reflowClosets } from './closets.ts'
import {
  editWallGeometry,
  outlineIssue,
  removeWallGeometry,
} from './geometry.ts'
import { OPENING_PRESETS } from './presets.ts'

import type { Opening, Point, Room } from './types.ts'
import type { Span, Wall } from './openings.ts'
import type { WallGeometryChange } from './geometry.ts'

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
  if (!room || !frame) return []

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

export type ConnectedWallEditResult =
  | { ok: true; rooms: Array<Room>; openings: Array<Opening> }
  | { ok: false; error: string }

/** Put a point through the length-and-angle change made to `from`. */
function mapWithWall(point: Point, from: Wall, to: Wall): Point {
  const dx = point.x - from.a.x
  const dy = point.y - from.a.y
  const along = dx * from.tangent.x + dy * from.tangent.y
  const across = dx * from.normal.x + dy * from.normal.y
  const stretched = along * (to.length / from.length)
  return {
    x: to.a.x + to.tangent.x * stretched + to.normal.x * across,
    y: to.a.y + to.tangent.y * stretched + to.normal.y * across,
  }
}

/** Stable identities for every ordinary pair of walls currently shared. */
function sharedPairs(rooms: Array<Room>): Set<string> {
  const pairs = new Set<string>()
  for (const room of rooms) {
    if (room.kind === 'closet') continue
    for (let wall = 0; wall < room.points.length; wall++) {
      for (const share of sharedWalls(rooms, room.id, wall)) {
        const other = rooms.find((candidate) => candidate.id === share.roomId)
        if (other?.kind === 'closet') continue
        const sides = [
          `${room.id}\u0000${wall}`,
          `${share.roomId}\u0000${share.wall}`,
        ].sort()
        pairs.add(JSON.stringify(sides))
      }
    }
  }
  return pairs
}

/** Whether two point lists describe the same outline to drawing precision. */
function samePoints(a: Array<Point>, b: Array<Point>): boolean {
  return (
    a.length === b.length &&
    a.every(
      (point, index) =>
        Math.abs(point.x - b[index].x) < 1e-6 &&
        Math.abs(point.y - b[index].y) < 1e-6,
    )
  )
}

/**
 * Change one wall and carry every room sharing that wall through the same
 * transform. Openings keep their wall index and the place along it they were
 * put, and closets are laid back onto their host wall; anything that cannot be
 * preserved makes the edit fail as a whole, leaving the plan untouched.
 */
export function editConnectedWall(
  rooms: Array<Room>,
  openings: Array<Opening>,
  roomId: string,
  index: number,
  change: WallGeometryChange,
): ConnectedWallEditResult {
  const room = rooms.find((candidate) => candidate.id === roomId)
  if (!room) return { ok: false, error: 'This room no longer exists.' }
  if (room.kind === 'closet') {
    return {
      ok: false,
      error: 'Edit this closet with its width and depth controls.',
    }
  }
  if (room.locked) {
    return { ok: false, error: `Unlock ${room.name} to edit its walls.` }
  }

  const from = wallAt(room.points, index)
  if (!from) return { ok: false, error: 'This wall no longer exists.' }
  const geometry = editWallGeometry(room.points, index, change)
  if (!geometry.ok) return geometry
  const to = wallAt(geometry.points, index)
  if (!to) return { ok: false, error: 'That change would remove the wall.' }

  const directShares = sharedWalls(rooms, roomId, index).filter(
    (share) =>
      rooms.find((candidate) => candidate.id === share.roomId)?.kind !==
      'closet',
  )
  for (const share of directShares) {
    const other = rooms.find((candidate) => candidate.id === share.roomId)
    if (other?.locked) {
      return {
        ok: false,
        error: `Unlock ${other.name} to keep the shared wall connected.`,
      }
    }
  }

  const changed = new Map<string, Array<Point>>([[roomId, geometry.points]])
  for (const share of directShares) {
    const other = rooms.find((candidate) => candidate.id === share.roomId)
    if (!other) continue
    const points = [...(changed.get(other.id) ?? other.points)]
    const end = (share.wall + 1) % points.length
    points[share.wall] = mapWithWall(other.points[share.wall], from, to)
    points[end] = mapWithWall(other.points[end], from, to)
    changed.set(other.id, points)
  }

  const movedRooms = rooms.map((candidate) => {
    const points = changed.get(candidate.id)
    return points ? { ...candidate, points } : candidate
  })
  for (const [id, points] of changed) {
    const before = rooms.find((candidate) => candidate.id === id)
    if (!before) continue
    const issue = outlineIssue(before.points, points)
    if (issue) return { ok: false, error: issue }
  }

  const beforeShares = sharedPairs(rooms)
  const afterShares = sharedPairs(movedRooms)
  if ([...beforeShares].some((pair) => !afterShares.has(pair))) {
    return {
      ok: false,
      error: 'That change would pull apart another shared wall.',
    }
  }

  const affectedRooms = new Set(changed.keys())
  for (const closet of rooms) {
    const attachment = closet.kind === 'closet' ? closet.attachment : undefined
    if (!attachment || !changed.has(attachment.roomId)) continue
    const host = movedRooms.find(
      (candidate) => candidate.id === attachment.roomId,
    )
    const hostWall = host && wallAt(host.points, attachment.wall)
    if (!host || !hostWall) {
      return {
        ok: false,
        error: `That change would detach ${closet.name} from its room.`,
      }
    }
    if (closetSize(closet).width > hostWall.length + 1e-6) {
      return {
        ok: false,
        error: `${closet.name} is wider than the edited wall.`,
      }
    }
    affectedRooms.add(closet.id)
  }

  // The rooms reshaped here have walls that grew or shrank, and what hangs on
  // those walls stays where it was put rather than sliding along with them.
  const stretched = new Map(
    [...changed.keys()].flatMap((id) => {
      const before = rooms.find((candidate) => candidate.id === id)
      return before ? [[id, before.points] as const] : []
    }),
  )
  const flowedRooms = reflowClosets(heldClosets(movedRooms, stretched))
  const fittedOpenings: Array<Opening> = []
  for (const opening of openings) {
    if (!affectedRooms.has(opening.roomId)) {
      fittedOpenings.push(opening)
      continue
    }
    const owner = flowedRooms.find(
      (candidate) => candidate.id === opening.roomId,
    )
    const wall = owner && wallAt(owner.points, opening.wall)
    if (!owner || !wall) {
      return {
        ok: false,
        error: `That change would detach an opening from ${owner?.name ?? 'its room'}.`,
      }
    }
    if (opening.width > wall.length + 1e-6) {
      return {
        ok: false,
        error: `${OPENING_PRESETS[opening.kind].label} in ${owner.name} is wider than the edited wall.`,
      }
    }
    const before = stretched.get(opening.roomId)
    fittedOpenings.push(
      before
        ? heldOpening(opening, before, owner.points)
        : { ...opening, t: clampT(opening.t, opening.width, wall.length) },
    )
  }

  // Avoid manufacturing a change when the entered value is already exact.
  if (
    rooms.every((candidate, i) =>
      samePoints(candidate.points, flowedRooms[i].points),
    ) &&
    openings.every(
      (opening, i) =>
        opening === fittedOpenings[i] || opening.t === fittedOpenings[i].t,
    )
  ) {
    return { ok: true, rooms, openings }
  }

  return { ok: true, rooms: flowedRooms, openings: fittedOpenings }
}

export type WallRemovalResult =
  { ok: true; points: Array<Point> } | { ok: false; error: string }

/**
 * The outline a room is left with once one of its walls is taken out, or why
 * that wall has to stay. `removeWallGeometry` settles the shape; what is added
 * here is the room's own say in it — whether it is a closet, whether it is
 * locked, and whether the wall is still there to take.
 *
 * A wall two rooms hold in common is two leaves laid over each other, and only
 * this room's is taken down. The room on the other side keeps its own, standing
 * exactly where it stood, with whatever it had cut through it: a wall knocked
 * out of one room is not knocked out of its neighbour, and the neighbour is
 * neither reshaped nor asked for permission. What was one wall between them
 * becomes that room's outside wall, which this one has simply stopped meeting.
 *
 * Anything hanging on the wall that goes — a door, a window, a closet — is read
 * back onto the outline that is left, exactly as when a corner is taken out.
 */
export function removeRoomWall(
  rooms: Array<Room>,
  roomId: string,
  index: number,
): WallRemovalResult {
  const room = rooms.find((candidate) => candidate.id === roomId)
  if (!room) return { ok: false, error: 'This room no longer exists.' }
  if (room.kind === 'closet') {
    return {
      ok: false,
      error: 'A closet keeps its four walls; resize it instead.',
    }
  }
  if (room.locked) {
    return { ok: false, error: `Unlock ${room.name} to remove its walls.` }
  }
  if (!wallAt(room.points, index)) {
    return { ok: false, error: 'This wall no longer exists.' }
  }

  return removeWallGeometry(room.points, index)
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
  if (!room || !frame) return []

  const gaps: Array<Span> = []

  // A closet is an open-front recess, not a small room with another copy of
  // the host wall across its face. Keep its front open even when it has no
  // door, and carry that same opening through every room sharing the host wall.
  if (room.kind === 'closet' && index === 0) gaps.push([0, 1])
  for (const closet of rooms) {
    const attachment = closet.kind === 'closet' ? closet.attachment : undefined
    if (!attachment) continue
    if (closet.id === roomId && index === 0) continue
    const host = rooms.find((candidate) => candidate.id === attachment.roomId)
    const hostWall = host && wallAt(host.points, attachment.wall)
    const front = wallAt(closet.points, 0)
    if (!hostWall || !front) continue
    const isHostWall = roomId === attachment.roomId && index === attachment.wall
    if (!isHostWall && !sharedSpan(frame, hostWall)) continue
    const span = spanBetween(frame, front.a, front.b)
    if (span) gaps.push(span)
  }

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
