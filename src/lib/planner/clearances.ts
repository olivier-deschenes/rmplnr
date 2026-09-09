import { furnitureCorners, normalizeAngle } from './geometry.ts'
import { blockersFor, spanAlong, wallBox } from './collision.ts'
import { closetSize } from './closets.ts'
import {
  clampT,
  fittedWidth,
  openingWall,
  pointOnWall,
  runWallAt,
  wallAt,
} from './openings.ts'
import { WALL_THICKNESS, wallGaps } from './walls.ts'

import type { Blocker } from './collision.ts'
import type { Span, Wall } from './openings.ts'
import type { Furniture, Opening, Point, WallRun, Selection } from './types.ts'

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
  /**
   * The unit heading from the selected thing towards whatever closes the gap.
   *
   * It is what names the gap to a reader — a gap is told from its neighbours
   * by the way it runs — and it is what the gap is closed along when a reader
   * types a new one: moving the selection this way narrows it, and the other
   * way widens it, by exactly the distance travelled.
   */
  dir: Point
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

/**
 * The nearest thing `moving` would meet heading `dir`, of everything given.
 *
 * `beyond` is how far out the search starts. Furniture starts at nothing: a
 * face up against something has met it, and the empty answer that comes back
 * is the true one. A wall starts past touching, because a wall is joined to
 * the walls it turns into and would otherwise only ever meet those.
 */
function reach(
  moving: Array<Point>,
  dir: Point,
  blockers: Array<Blocker>,
  beyond = 0,
): { gap: number; met: Array<Point> } | null {
  let nearest: { gap: number; met: Array<Point> } | null = null
  for (const blocker of blockers) {
    const gap = gapAlong(moving, blocker.points, dir)
    if (gap === null || gap < beyond) continue
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
    const face = wallAt(corners, i, true)
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
      dir: face.normal,
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
      // The line is drawn from what stops it back to the jamb; the heading is
      // the way round a reader thinks of it, out of the opening to that stop.
      dir:
        key === 'start'
          ? { x: -wall.tangent.x, y: -wall.tangent.y }
          : wall.tangent,
    }))
}

/**
 * How much wall a door or a window has either side of it. Everything else cut
 * through the same wall is in the way, its neighbours' openings included: a
 * door through a party wall is one hole, whichever room it is listed under.
 */
export function openingClearances(
  walls: Array<WallRun>,
  openings: Array<Opening>,
  opening: Opening,
): Array<Clearance> {
  const wall = openingWall(walls, opening)
  if (!wall) return []
  const width = fittedWidth(opening.width, wall.length)
  const centre = clampT(opening.t, opening.width, wall.length) * wall.length
  return alongWall(
    wall,
    [centre - width / 2, centre + width / 2],
    wallGaps(
      walls,
      openings.filter((other) => other.id !== opening.id),
      opening.runId,
      opening.wall,
    ),
  )
}

/**
 * The same, for a closet: it rides along its host wall exactly as an opening
 * does, and takes up the stretch of it that its open front covers.
 */
export function closetClearances(
  walls: Array<WallRun>,
  openings: Array<Opening>,
  closet: WallRun,
): Array<Clearance> {
  const attachment = closet.attachment
  if (!attachment) return []
  const host = walls.find((run) => run.id === attachment.runId)
  const wall = host && runWallAt(host, attachment.wall)
  if (!wall) return []

  const width = fittedWidth(closetSize(closet).width, wall.length)
  const centre = clampT(attachment.t, width, wall.length) * wall.length
  return alongWall(
    wall,
    [centre - width / 2, centre + width / 2],
    // The closet is taken out of the plan first: the stretch of wall it stands
    // on is what is being measured, not something for it to run into.
    wallGaps(
      walls.filter((run) => run.id !== closet.id),
      openings,
      attachment.runId,
      attachment.wall,
    ),
  )
}

/**
 * What a wall has standing off it, square out of either face.
 *
 * A wall is measured the way a room is measured: across to whatever faces it,
 * which is the wall opposite, or whatever has been put down in between. Both
 * faces are measured, because a wall pushed either way is a room made bigger
 * at the expense of the one behind it, and a reader deciding where to put it
 * wants both halves of that trade in front of them.
 *
 * What a wall is joined to is not what it is next to. The walls it turns into
 * at its own corners run square out of it and touch it by construction, and a
 * wall measured to those would report nothing else — so anything already up
 * against this wall is passed over, and the first thing standing clear of it
 * is the one measured.
 */
export function wallClearances(
  walls: Array<WallRun>,
  furniture: Array<Furniture>,
  openings: Array<Opening>,
  runId: string,
  index: number,
): Array<Clearance> {
  const run = walls.find((candidate) => candidate.id === runId)
  const wall = run && runWallAt(run, index)
  const box = wall && wallBox(wall.a, wall.b)
  if (!wall || !box) return []

  const blockers = blockersFor(walls, furniture, openings)
  const half = WALL_THICKNESS / 2
  // Named for the way a positive push slides this wall rather than for the
  // room either side of it, which is not a thing a lone wall knows: the keys
  // have to stay put as the plan is redrawn around them.
  const sides = [
    { key: 'forward', dir: wall.normal },
    { key: 'back', dir: { x: -wall.normal.x, y: -wall.normal.y } },
  ]

  return sides.flatMap(({ key, dir }) => {
    const found = reach(box, dir, blockers, TOUCHING)
    if (!found) return []
    // Measured off the face rather than the centreline, so the number is the
    // gap a tape measure would find and the line is drawn where it was taken.
    const face: Wall = {
      ...wall,
      a: { x: wall.a.x + dir.x * half, y: wall.a.y + dir.y * half },
      b: { x: wall.b.x + dir.x * half, y: wall.b.y + dir.y * half },
      normal: dir,
    }
    const from = metAt(face, found.met)
    return [
      {
        key,
        from,
        to: { x: from.x + dir.x * found.gap, y: from.y + dir.y * found.gap },
        distance: found.gap,
        dir,
      },
    ]
  })
}

/** The eight ways a gap can run, named as it lies on the page. */
const HEADINGS = [
  'Right',
  'Down-right',
  'Down',
  'Down-left',
  'Left',
  'Up-left',
  'Up',
  'Up-right',
]

/**
 * What to call a gap in a list of them: which way it runs on the page.
 *
 * A gap has no name of its own — it is not a thing but the absence of one —
 * so it is told from its fellows by where it lies, which is also the one
 * thing about it a reader can see at a glance on the drawing beside the list.
 * The heading is read off the plan as it is drawn rather than off the item's
 * own frame, so a chair turned on the spot has its gaps renamed along with it.
 */
export function clearanceName(dir: Point): string {
  const heading = normalizeAngle((Math.atan2(dir.y, dir.x) * 180) / Math.PI)
  return HEADINGS[Math.round(heading / 45) % HEADINGS.length]
}

/**
 * The order the gaps are read in, whatever order they were measured in.
 *
 * Measured order follows the thing being measured — a piece of furniture gives
 * up its faces in its own frame, a wall gives up the way it slides first — so
 * a chair turned on the spot, or a door on a wall drawn right to left, would
 * deal its gaps into different cells each time. These are fields, and a field
 * a reader is aiming at must not move. Opposites are kept side by side, which
 * is also how they are argued about: what one side gains the other gives up.
 */
const READING_ORDER = [
  'Left',
  'Right',
  'Up',
  'Down',
  'Up-left',
  'Up-right',
  'Down-left',
  'Down-right',
]

/** Gaps in a settled reading order, so each keeps its place in a list of them. */
export function orderedClearances(
  clearances: Array<Clearance>,
): Array<Clearance> {
  return [...clearances].sort(
    (a, b) =>
      READING_ORDER.indexOf(clearanceName(a.dir)) -
      READING_ORDER.indexOf(clearanceName(b.dir)),
  )
}

/**
 * What the plan has to say about the room around whatever is selected, of the
 * things that carry a clearance at all. A whole room carries none: it has no
 * clearances of its own, only walls, and a wall selected on its own has them.
 *
 * The blockers are read whether or not collisions are switched on. What is
 * measured is the gap that is there, and the gap is there either way.
 */
export function clearancesFor(
  selection: Selection,
  walls: Array<WallRun>,
  furniture: Array<Furniture>,
  openings: Array<Opening>,
): Array<Clearance> {
  if (!selection) return []

  if (selection.type === 'furniture') {
    const item = furniture.find((f) => f.id === selection.id)
    return item
      ? furnitureClearances(
          item,
          blockersFor(walls, furniture, openings, item.id),
        )
      : []
  }

  if (selection.type === 'opening') {
    const opening = openings.find((o) => o.id === selection.id)
    return opening ? openingClearances(walls, openings, opening) : []
  }

  if (selection.type === 'wall') {
    return wallClearances(
      walls,
      furniture,
      openings,
      selection.id,
      selection.index,
    )
  }

  const run = walls.find((r) => r.id === selection.id)
  return run?.kind === 'closet' ? closetClearances(walls, openings, run) : []
}
