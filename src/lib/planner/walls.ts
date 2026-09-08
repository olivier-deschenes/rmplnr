import {
  clampT,
  heldOpening,
  openingEnds,
  openingSpan,
  outlinePath,
  projectAlong,
  roomWallAt,
  wallAt,
  wallCount,
  wallSegments,
} from './openings.ts'
import { closetSize, heldClosets, reflowClosets } from './closets.ts'
import {
  distance,
  editWallGeometry,
  outlineIssue,
  outwardSign,
} from './geometry.ts'
import { OPENING_PRESETS } from './presets.ts'
import { MIN_SIZE } from './types.ts'

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
  const frame = room ? roomWallAt(room, index) : null
  if (!room || !frame) return []

  const shares: Array<Share> = []
  for (const other of rooms) {
    if (other.id === roomId) continue
    for (let i = 0; i < other.points.length; i++) {
      const face = roomWallAt(other, i)
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

  const from = roomWallAt(room, index)
  if (!from) return { ok: false, error: 'This wall no longer exists.' }
  const geometry = editWallGeometry(
    room.points,
    index,
    change,
    room.closed !== false,
  )
  if (!geometry.ok) return geometry
  const to = wallAt(geometry.points, index, room.closed !== false)
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
    const issue = outlineIssue(before.points, points, before.closed !== false)
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
    const hostWall = host && roomWallAt(host, attachment.wall)
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
    const wall = owner && roomWallAt(owner, opening.wall)
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

/**
 * A closed outline read back as the runs of walls it was drawn as.
 *
 * A room and a run of walls are the same walls written down two ways, and this
 * is the way back from the first to the second: the outline's own corners,
 * walked round and back to the one they started at. Not a corner moves, and
 * the walk keeps exactly the walls the room had — the closing wall included,
 * which is the whole reason it comes back to where it began rather than
 * stopping one wall short of it.
 *
 * Except for the walls that are not there. A wall opened end to end is a way
 * through, and `absent` is how the caller says so: the walk steps over it
 * rather than laying it down, which breaks the loop and leaves a run either
 * side of the gap. That is the honest answer — the walls that are there are
 * these, and they no longer close anything — and it is why this returns runs
 * rather than a run.
 *
 * The one thing that cannot be carried straight across is which side of a wall
 * is the outside. A room settles that by its winding, whichever way round it
 * was traced; a run has no inside to wind about, so `wallAt` reads its outside
 * off the one winding it assumes. A room traced the other way is therefore
 * walked backwards here, which puts its walls back the way round the run
 * expects and leaves every door swinging and every closet standing exactly
 * where it stood. `walls` says where each of the room's walls ended up, for
 * whatever was hanging on it.
 */
export type OpenedRun = {
  /** This run's corners, in the order it is walked. */
  points: Array<Point>
  /** Which wall of the closed outline each of this run's walls came from. */
  walls: Array<number>
}

export type OpenedOutline = {
  /** Whether the outline's walls are walked the other way about. */
  reversed: boolean
  /** What is left, in walk order: one run, or several where a wall is absent. */
  runs: Array<OpenedRun>
}

export function openOutline(
  points: Array<Point>,
  absent: (index: number) => boolean = () => false,
): OpenedOutline {
  const count = points.length
  const reversed = outwardSign(points) < 0
  // Which wall the walk takes at each step, and which way round it then runs.
  const order = Array.from({ length: count }, (_, step) =>
    reversed ? count - 1 - step : step,
  )
  const from = (index: number) =>
    reversed ? points[(index + 1) % count] : points[index]
  const to = (index: number) =>
    reversed ? points[index] : points[(index + 1) % count]

  const walked: Array<Array<number>> = []
  let current: Array<number> | null = null
  for (const index of order) {
    if (absent(index)) {
      current = null
      continue
    }
    if (current) current.push(index)
    else walked.push((current = [index]))
  }
  // The walk is a loop, so a run reaching the last wall carries straight on
  // into the one that set off from the first.
  if (walked.length > 1 && !absent(order[0]) && !absent(order[count - 1])) {
    walked[0] = [...walked.pop()!, ...walked[0]]
  }

  return {
    reversed,
    runs: walked.map((walls) => ({
      points: [from(walls[0]), ...walls.map(to)],
      walls,
    })),
  }
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
  const frame = room ? roomWallAt(room, index) : null
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
    const hostWall = host && roomWallAt(host, attachment.wall)
    const front = roomWallAt(closet, 0)
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

/**
 * Whether nothing of a wall is left standing.
 *
 * A wall opened from end to end is a way through rather than a wall: none of
 * it is drawn, none of it stops the furniture, and a reader looking at the
 * plan sees a gap where a wall would be. So it is not one, and anything asking
 * the plan which walls a room has ought to be told so.
 *
 * What is left standing is measured exactly as it is drawn — every opening cut
 * into this wall, this room's own and those of any room sharing it — and a
 * scrap too short to be drawn as a wall of its own counts for nothing.
 */
export function wallFullyOpen(
  rooms: Array<Room>,
  openings: Array<Opening>,
  roomId: string,
  index: number,
): boolean {
  const room = rooms.find((candidate) => candidate.id === roomId)
  const frame = room && roomWallAt(room, index)
  if (!frame) return false
  return wallSegments(frame, wallGaps(rooms, openings, roomId, index)).every(
    ([a, b]) => distance(a, b) < MIN_SIZE,
  )
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
    room.closed !== false,
  )
}

/** Solid wall segments, with doors, windows and shared openings cut out. */
export function standingWalls(
  rooms: Array<Room>,
  openings: Array<Opening>,
): Array<[Point, Point]> {
  return rooms.flatMap((room) =>
    Array.from({ length: wallCount(room) }, (_, index) => {
      const frame = roomWallAt(room, index)
      return frame
        ? wallSegments(frame, wallGaps(rooms, openings, room.id, index))
        : []
    }).flat(),
  )
}

/**
 * Draw separate wall runs with the same corner joins as a continuous outline.
 * Only solid segments meeting at their ends get a join; free ends and opening
 * jambs retain their butt caps. Keep wallPath separate for per-room hit targets.
 */
export function planWallPath(
  rooms: Array<Room>,
  openings: Array<Opening>,
): string {
  const paths = rooms.map((room) => wallPath(rooms, openings, room))
  const ends = standingWalls(rooms, openings).flatMap(([a, b]) => [
    { at: a, from: b },
    { at: b, from: a },
  ])

  for (let i = 0; i < ends.length; i++) {
    const one = ends[i]
    for (let j = i + 1; j < ends.length; j++) {
      const other = ends[j]
      if (distance(one.at, other.at) > 1e-6) continue
      const dx = one.from.x - one.at.x
      const dy = one.from.y - one.at.y
      const ox = other.from.x - other.at.x
      const oy = other.from.y - other.at.y
      // Straight or overlapping segments already meet without a corner join.
      if (Math.abs(dx * oy - dy * ox) < 1e-6) continue
      paths.push(
        `M${one.from.x},${one.from.y} L${one.at.x},${one.at.y} L${other.from.x},${other.from.y}`,
      )
    }
  }

  return paths.filter(Boolean).join(' ')
}
