import {
  clampT,
  heldOpening,
  openingEnds,
  openingSpan,
  outlinePath,
  projectAlong,
  pointOnWall,
  runWallAt,
  wallAt,
  wallCount,
  wallSegments,
} from './openings.ts'
import { closetSize, heldClosets, reflowClosets } from './closets.ts'
import { distance, editWallGeometry, wallRunIssue } from './geometry.ts'
import { OPENING_PRESETS } from './presets.ts'
import { MIN_SIZE } from './types.ts'

import type { Opening, Point, WallRun } from './types.ts'
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
  runId: string
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
  walls: Array<WallRun>,
  runId: string,
  index: number,
): Array<Share> {
  const run = walls.find((r) => r.id === runId)
  const frame = run ? runWallAt(run, index) : null
  if (!run || !frame) return []

  const shares: Array<Share> = []
  for (const other of walls) {
    if (other.id === runId) continue
    for (let i = 0; i < other.points.length; i++) {
      const face = runWallAt(other, i)
      if (!face) continue
      const span = sharedSpan(frame, face)
      if (span) shares.push({ runId: other.id, wall: i, frame: face, span })
    }
  }
  return shares
}

/** The rooms this one holds a wall in common with. */
export function neighbours(
  walls: Array<WallRun>,
  runId: string,
): Array<WallRun> {
  const run = walls.find((r) => r.id === runId)
  if (!run) return []
  const ids = new Set<string>()
  for (let i = 0; i < run.points.length; i++) {
    for (const share of sharedWalls(walls, runId, i)) ids.add(share.runId)
  }
  return walls.filter((r) => ids.has(r.id))
}

export type ConnectedWallEditResult =
  | { ok: true; walls: Array<WallRun>; openings: Array<Opening> }
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
  walls: Array<WallRun>,
  openings: Array<Opening>,
  runId: string,
  index: number,
  change: WallGeometryChange,
): ConnectedWallEditResult {
  const run = walls.find((candidate) => candidate.id === runId)
  if (!run) return { ok: false, error: 'This room no longer exists.' }
  if (run.kind === 'closet') {
    return {
      ok: false,
      error: 'Edit this closet with its width and depth controls.',
    }
  }
  if (run.locked) {
    return { ok: false, error: `Unlock ${run.name} to edit its walls.` }
  }

  const from = runWallAt(run, index)
  if (!from) return { ok: false, error: 'This wall no longer exists.' }
  const geometry = editWallGeometry(run.points, index, change)
  if (!geometry.ok) return geometry
  return reshapeConnectedWalls(walls, openings, runId, geometry.points)
}

/** Move connected corners and junctions together, regardless of drawing order. */
export function reshapeConnectedWalls(
  walls: Array<WallRun>,
  openings: Array<Opening>,
  runId: string,
  points: Array<Point>,
): ConnectedWallEditResult {
  const source = walls.find((run) => run.id === runId)
  if (!source || source.points.length !== points.length)
    return { ok: false, error: 'This wall no longer exists.' }
  if (source.locked)
    return { ok: false, error: `Unlock ${source.name} to edit its walls.` }
  const changed = new Map<string, Array<Point>>([[runId, points]])
  const junction = (point: Point): Point => {
    const corner = source.points.findIndex(
      (before) => distance(before, point) < 1e-6,
    )
    if (corner >= 0) return points[corner]
    for (let i = 0; i < source.points.length - 1; i++) {
      const from = wallAt(source.points, i)
      const to = wallAt(points, i)
      if (!from || !to || Math.abs(offset(from, point)) > 1e-6) continue
      const along = projectAlong(from, point)
      if (along > 0 && along < 1) return mapWithWall(point, from, to)
    }
    return point
  }
  const movedRuns = walls.map((run) => {
    if (run.id === runId) return { ...run, points }
    if (run.kind === 'closet') return run
    const next = run.points.map(junction)
    if (samePoints(run.points, next)) return run
    changed.set(run.id, next)
    return { ...run, points: next }
  })
  for (const [id, next] of changed) {
    const before = walls.find((run) => run.id === id)!
    if (before.locked)
      return {
        ok: false,
        error: `Unlock ${before.name} to keep the shared wall connected.`,
      }
    const issue = wallRunIssue(next)
    if (issue) return { ok: false, error: issue }
  }

  const affectedRuns = new Set(changed.keys())
  for (const closet of walls) {
    const attachment = closet.kind === 'closet' ? closet.attachment : undefined
    if (!attachment || !changed.has(attachment.runId)) continue
    const host = movedRuns.find(
      (candidate) => candidate.id === attachment.runId,
    )
    const hostWall = host && runWallAt(host, attachment.wall)
    if (!host || !hostWall) {
      return {
        ok: false,
        error: `That change would detach ${closet.name} from its run.`,
      }
    }
    if (closetSize(closet).width > hostWall.length + 1e-6) {
      return {
        ok: false,
        error: `${closet.name} is wider than the edited wall.`,
      }
    }
    affectedRuns.add(closet.id)
  }

  // The rooms reshaped here have walls that grew or shrank, and what hangs on
  // those walls stays where it was put rather than sliding along with them.
  const stretched = new Map(
    [...changed.keys()].flatMap((id) => {
      const before = walls.find((candidate) => candidate.id === id)
      return before ? [[id, before.points] as const] : []
    }),
  )
  const flowedRuns = reflowClosets(heldClosets(movedRuns, stretched))
  const fittedOpenings: Array<Opening> = []
  for (const opening of openings) {
    if (!affectedRuns.has(opening.runId)) {
      fittedOpenings.push(opening)
      continue
    }
    const owner = flowedRuns.find((candidate) => candidate.id === opening.runId)
    const wall = owner && runWallAt(owner, opening.wall)
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
    const before = stretched.get(opening.runId)
    fittedOpenings.push(
      before
        ? heldOpening(opening, before, owner.points)
        : { ...opening, t: clampT(opening.t, opening.width, wall.length) },
    )
  }

  // Avoid manufacturing a change when the entered value is already exact.
  if (
    walls.every((candidate, i) =>
      samePoints(candidate.points, flowedRuns[i].points),
    ) &&
    openings.every(
      (opening, i) =>
        opening === fittedOpenings[i] || opening.t === fittedOpenings[i].t,
    )
  ) {
    return { ok: true, walls, openings }
  }

  return { ok: true, walls: flowedRuns, openings: fittedOpenings }
}

/** Remove the physical wall, including coincident copies drawn in other runs. */
export function removeWallGeometry(
  walls: Array<WallRun>,
  openings: Array<Opening>,
  runId: string,
  index: number,
): ConnectedWallEditResult {
  const source = walls.find((run) => run.id === runId)
  const target = source && runWallAt(source, index)
  if (!target) return { ok: false, error: 'This wall no longer exists.' }
  type Piece = { wall: number; from: number; to: number; a: Point; b: Point }
  type Landing = { runId: string; wall: number; from: number; to: number }
  const landings = new Map<string, Array<Landing>>()
  const changed = new Set<string>()
  const next: Array<WallRun> = []
  for (const run of walls) {
    const groups: Array<Array<Piece>> = []
    let group: Array<Piece> = []
    const finish = () => {
      if (group.length) groups.push(group)
      group = []
    }
    for (let wall = 0; wall < wallCount(run); wall++) {
      const frame = runWallAt(run, wall)!
      const cut =
        run.id === runId && wall === index ? [0, 1] : sharedSpan(frame, target)
      if (cut) changed.add(run.id)
      const spans: Array<Span> = cut
        ? [
            [0, cut[0]],
            [cut[1], 1],
          ]
        : [[0, 1]]
      for (const [from, to] of spans) {
        if ((to - from) * frame.length < 1e-6) {
          finish()
          continue
        }
        const a = pointOnWall(frame, from),
          b = pointOnWall(frame, to)
        if (group.length && distance(group[group.length - 1].b, a) > 1e-6)
          finish()
        group.push({ wall, from, to, a, b })
      }
    }
    finish()
    if (!changed.has(run.id)) {
      next.push(run)
      continue
    }
    if (run.locked)
      return { ok: false, error: `Unlock ${run.name} to remove its walls.` }
    groups.forEach((pieces, groupIndex) => {
      const id = groupIndex === 0 ? run.id : crypto.randomUUID()
      const { kind: _kind, attachment: _attachment, ...ordinary } = run
      next.push({
        ...ordinary,
        id,
        points: [pieces[0].a, ...pieces.map((piece) => piece.b)],
      })
      pieces.forEach((piece, wall) => {
        const key = `${run.id}:${piece.wall}`
        const destinations = landings.get(key) ?? []
        destinations.push({ runId: id, wall, from: piece.from, to: piece.to })
        landings.set(key, destinations)
      })
    })
  }
  const remap = (owner: string, wall: number, t: number, width: number) => {
    if (!changed.has(owner)) return { runId: owner, wall, t }
    const before = walls.find((run) => run.id === owner)!
    const length = runWallAt(before, wall)!.length
    const half = width / length / 2
    const piece = landings
      .get(`${owner}:${wall}`)
      ?.find(
        (part) => t - half >= part.from - 1e-6 && t + half <= part.to + 1e-6,
      )
    return piece
      ? {
          runId: piece.runId,
          wall: piece.wall,
          t: (t - piece.from) / (piece.to - piece.from),
        }
      : null
  }
  const removedClosets = new Set<string>()
  const attached = next.flatMap((run) => {
    if (!run.attachment) return [run]
    const attachment = remap(
      run.attachment.runId,
      run.attachment.wall,
      run.attachment.t,
      closetSize(run).width,
    )
    if (attachment) return [{ ...run, attachment }]
    removedClosets.add(run.id)
    return []
  })
  return {
    ok: true,
    walls: attached,
    openings: openings.flatMap((opening) => {
      if (removedClosets.has(opening.runId)) return []
      const destination = remap(
        opening.runId,
        opening.wall,
        opening.t,
        opening.width,
      )
      return destination ? [{ ...opening, ...destination }] : []
    }),
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
  walls: Array<WallRun>,
  openings: Array<Opening>,
  runId: string,
): Array<{ wall: number; span: Span }> {
  const run = walls.find((r) => r.id === runId)
  if (!run) return []
  return run.points.flatMap((_, wall) => {
    const gaps = wallGaps(walls, openings, runId, wall)
    return sharedWalls(walls, runId, wall).flatMap((share) =>
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
  walls: Array<WallRun>,
  openings: Array<Opening>,
  runId: string,
  index: number,
): Array<Span> {
  const run = walls.find((r) => r.id === runId)
  const frame = run ? runWallAt(run, index) : null
  if (!run || !frame) return []

  const gaps: Array<Span> = []

  // A closet is an open-front recess, not a small room with another copy of
  // the host wall across its face. Keep its front open even when it has no
  // door, and carry that same opening through every room sharing the host wall.
  if (run.kind === 'closet' && index === 0) gaps.push([0, 1])
  for (const closet of walls) {
    const attachment = closet.kind === 'closet' ? closet.attachment : undefined
    if (!attachment) continue
    if (closet.id === runId && index === 0) continue
    const host = walls.find((candidate) => candidate.id === attachment.runId)
    const hostWall = host && runWallAt(host, attachment.wall)
    const front = runWallAt(closet, 0)
    if (!hostWall || !front) continue
    const isHostWall = runId === attachment.runId && index === attachment.wall
    if (!isHostWall && !sharedSpan(frame, hostWall)) continue
    const span = spanBetween(frame, front.a, front.b)
    if (span) gaps.push(span)
  }

  for (const opening of openings) {
    if (opening.runId === runId && opening.wall === index) {
      gaps.push(openingSpan(frame, opening))
    }
  }

  for (const share of sharedWalls(walls, runId, index)) {
    for (const opening of openings) {
      if (opening.runId !== share.runId) continue
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
  walls: Array<WallRun>,
  openings: Array<Opening>,
  runId: string,
  index: number,
): boolean {
  const run = walls.find((candidate) => candidate.id === runId)
  const frame = run && runWallAt(run, index)
  if (!frame) return false
  return wallSegments(frame, wallGaps(walls, openings, runId, index)).every(
    ([a, b]) => distance(a, b) < MIN_SIZE,
  )
}

/** A room's walls as path data, with every opening through them cut out. */
export function wallPath(
  walls: Array<WallRun>,
  openings: Array<Opening>,
  run: WallRun,
): string {
  return outlinePath(
    run.points,
    run.points.map((_, i) => wallGaps(walls, openings, run.id, i)),
    false,
  )
}

/** Solid wall segments, with doors, windows and shared openings cut out. */
export function standingWalls(
  walls: Array<WallRun>,
  openings: Array<Opening>,
): Array<[Point, Point]> {
  return walls.flatMap((run) =>
    Array.from({ length: wallCount(run) }, (_, index) => {
      const frame = runWallAt(run, index)
      return frame
        ? wallSegments(frame, wallGaps(walls, openings, run.id, index))
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
  walls: Array<WallRun>,
  openings: Array<Opening>,
): string {
  const paths = walls.map((run) => wallPath(walls, openings, run))
  const ends = standingWalls(walls, openings).flatMap(([a, b]) => [
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
