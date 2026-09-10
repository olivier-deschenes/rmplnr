import {
  interiorPoint,
  offsetArea,
  pointInPolygon,
  polygonArea,
  distance,
} from './geometry.ts'
import { wallCount, runWallAt } from './openings.ts'
import { WALL_THICKNESS } from './walls.ts'

import type { Point, WallRun, Space } from './types.ts'

/**
 * A room is whatever the walls close in.
 *
 * Rooms are drawn as runs of walls — some traced right round and shut, some
 * left open — but that is only how they were *entered*. What makes a room is
 * the walls themselves: three walls run out from a neighbour's wall and back
 * to it enclose a space every bit as much as four walls that were closed on
 * their own, and the reader means the same thing by both. So the floors on a
 * plan are not read off the outlines that were drawn; they are worked out from
 * every wall in the plan at once, wherever those walls happen to have come
 * from.
 *
 * The working out is the usual one for a drawing of straight lines: cut every
 * wall at every place another wall meets or crosses it, throw away the
 * duplicates left where two rooms share a wall, and then walk the result
 * always taking the sharpest turn available. Walking that way traces out each
 * smallest closed loop exactly once, and every enclosed space on the plan is
 * one of those loops.
 *
 * Walls that lead nowhere — a stub into the middle of a room, a run still
 * being drawn — are walked out and straight back again, which adds nothing to
 * the loop they sit in and cannot close one of their own. They are simply
 * absent from the answer, which is what a wall that encloses nothing should be.
 */

/**
 * Two corners this close together are the same corner.
 *
 * Walls are drawn onto snapped points and onto each other's corners, so
 * coincidences on a real plan are exact and this only has to absorb the
 * rounding that arithmetic leaves behind. It stays well under `MIN_SIZE`, so
 * no wall short enough to draw is ever collapsed by it.
 */
const WELD = 1

/** Below this a loop is a sliver left by rounding, not a space. */
const MIN_ENCLOSURE_AREA = 500

/**
 * How far inside its own centreline a wall's near face stands.
 *
 * A loop of centrelines is where the walls were drawn, not where they stop.
 * Half a wall of each one stands inside the loop, on the floor, which is why
 * the floor a room has is not the area of the ring that was drawn for it.
 */
const FACE = WALL_THICKNESS / 2

/**
 * How far across a loop has to be, at its average, to be a space at all.
 *
 * Two walls drawn a few centimetres apart still read as the one wall they were
 * meant to be — that is what half a wall's thickness means everywhere else in
 * the editor — and the hairline strip between them is a drawing error, not a
 * room. Anything a person could stand in is a hundred times this.
 */
const MIN_ENCLOSURE_WIDTH = WALL_THICKNESS / 2

/** Roughly how far across a loop is: the width of the strip of equal area. */
function averageWidth(points: Array<Point>): number {
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    perimeter += distance(points[i], points[(i + 1) % points.length])
  }
  return perimeter === 0 ? 0 : (2 * polygonArea(points)) / perimeter
}

/** One enclosed space on the plan, and whatever is known about it. */
export type Enclosure = {
  /**
   * What this space is called from one recalculation to the next: its corners,
   * in order, from a fixed starting point. Nothing about a space survives
   * moving one of its walls, which is exactly right — moving a wall makes a
   * different space — and a selection that goes stale simply falls away.
   */
  key: string
  /** The loop of wall centrelines that closes it in. */
  points: Array<Point>
  /**
   * The area of that loop in cm², which is how the plan is laid out and how
   * one space is told from another — not what the room has underfoot.
   */
  area: number
  /**
   * The floor in cm²: what the loop closes in once the walls standing on it
   * are taken off, and so the floor there is to stand furniture on. This is
   * the number a reader is shown, because it is the one they asked for.
   */
  floor: number
  /** Somewhere inside it: where its name is written, and what a click hits. */
  centre: Point
  /** The name and colour put on it, once someone has put one on. */
  space: Space | null
}

type Segment = { a: Point; b: Point }

/** Every wall centreline on the plan, whichever run it was drawn as part of. */
export function wallLines(walls: Array<WallRun>): Array<Segment> {
  const lines: Array<Segment> = []
  for (const run of walls) {
    for (let i = 0; i < wallCount(run); i++) {
      const wall = runWallAt(run, i)
      if (wall) lines.push({ a: wall.a, b: wall.b })
    }
  }
  return lines
}

/** A welded corner's name, so that corners within `WELD` share one node. */
function cornerKey(p: Point): string {
  return `${Math.round(p.x / WELD)},${Math.round(p.y / WELD)}`
}

/**
 * How far along `a`→`b` the point `p` falls, as a fraction, or null when it is
 * not on that line at all. The tolerance is `WELD` measured across the line,
 * so a wall end that lands on another wall is read as touching it.
 */
function alongSegment(a: Point, b: Point, p: Point): number | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return null
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared
  if (t <= 0 || t >= 1) return null
  const foot = { x: a.x + dx * t, y: a.y + dy * t }
  return distance(foot, p) <= WELD ? t : null
}

/** Where two segments cross, as a fraction along the first, or null. */
function crossingAt(one: Segment, other: Segment): number | null {
  const r = { x: one.b.x - one.a.x, y: one.b.y - one.a.y }
  const s = { x: other.b.x - other.a.x, y: other.b.y - other.a.y }
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-9) return null
  const dx = other.a.x - one.a.x
  const dy = other.a.y - one.a.y
  const t = (dx * s.y - dy * s.x) / denominator
  const u = (dx * r.y - dy * r.x) / denominator
  return t > 0 && t < 1 && u > 0 && u < 1 ? t : null
}

/**
 * Cut every wall wherever another wall meets or crosses it, and throw away
 * what is then duplicated.
 *
 * Both halves matter. Cutting is what lets three walls closing onto the middle
 * of a fourth make a room out of the part of that fourth wall they reach: the
 * fourth wall becomes two, and one of them belongs to the new room. Throwing
 * duplicates away is what keeps a wall two rooms share a single wall — they
 * each drew one, and after cutting the two are the same piece.
 */
function planarEdges(lines: Array<Segment>): Map<string, Segment> {
  const corners: Array<Point> = []
  for (const line of lines) corners.push(line.a, line.b)

  const edges = new Map<string, Segment>()
  for (const line of lines) {
    const cuts = new Set<number>([0, 1])
    for (const corner of corners) {
      const t = alongSegment(line.a, line.b, corner)
      if (t !== null) cuts.add(t)
    }
    for (const other of lines) {
      const t = crossingAt(line, other)
      if (t !== null) cuts.add(t)
    }

    const ordered = [...cuts].sort((one, other) => one - other)
    for (let i = 0; i + 1 < ordered.length; i++) {
      const at = (t: number) => ({
        x: line.a.x + (line.b.x - line.a.x) * t,
        y: line.a.y + (line.b.y - line.a.y) * t,
      })
      const a = at(ordered[i])
      const b = at(ordered[i + 1])
      const from = cornerKey(a)
      const to = cornerKey(b)
      if (from === to) continue
      // One key per pair of corners whichever way round the wall was drawn,
      // so the two rooms either side of a party wall contribute one edge.
      const key = from < to ? `${from}|${to}` : `${to}|${from}`
      if (!edges.has(key)) edges.set(key, { a, b })
    }
  }
  return edges
}

type Graph = {
  points: Array<Point>
  /** For each corner, the corners it is walled to, ordered by bearing. */
  neighbours: Array<Array<number>>
}

function graphOf(edges: Map<string, Segment>): Graph {
  const index = new Map<string, number>()
  const points: Array<Point> = []
  const neighbours: Array<Array<number>> = []

  const node = (p: Point) => {
    const key = cornerKey(p)
    const known = index.get(key)
    if (known !== undefined) return known
    index.set(key, points.length)
    points.push(p)
    neighbours.push([])
    return points.length - 1
  }

  for (const edge of edges.values()) {
    const from = node(edge.a)
    const to = node(edge.b)
    if (from === to) continue
    if (!neighbours[from].includes(to)) neighbours[from].push(to)
    if (!neighbours[to].includes(from)) neighbours[to].push(from)
  }

  for (let i = 0; i < neighbours.length; i++) {
    neighbours[i].sort(
      (one, other) =>
        Math.atan2(points[one].y - points[i].y, points[one].x - points[i].x) -
        Math.atan2(
          points[other].y - points[i].y,
          points[other].x - points[i].x,
        ),
    )
  }
  return { points, neighbours }
}

/** Twice the signed area of a ring; positive for the loops that hold a floor. */
function signedDoubleArea(points: Array<Point>): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum
}

/**
 * Take the walked-out-and-back excursions off a loop.
 *
 * A wall that leads nowhere is walked up and straight back down, leaving the
 * corner it reached sitting in the loop between two copies of the corner it
 * left from. That costs the loop no area, but it would draw a hairline
 * sticking out of the floor, so it comes off here.
 */
function trimSpurs(ring: Array<number>): Array<number> {
  let trimmed = ring
  for (let pass = 0; pass < ring.length && trimmed.length > 2; pass++) {
    const count = trimmed.length
    const tip = trimmed.findIndex(
      (_, i) => trimmed[(i + count - 1) % count] === trimmed[(i + 1) % count],
    )
    if (tip === -1) break
    const dropped = new Set([tip, (tip + 1) % count])
    trimmed = trimmed.filter((_, i) => !dropped.has(i))
  }
  return trimmed
}

/**
 * Take the corners that are not corners off a loop.
 *
 * Cutting the walls up leaves a corner wherever anything touched them, and
 * most of those are not corners of the space at all: a stub walled onto the
 * middle of a room's wall puts one there, and the wall runs dead straight
 * through it. Dropping them leaves the loop with the corners a reader would
 * count, and leaves it with the same corners whether or not somebody has since
 * walled a stub onto one of its walls.
 */
function dropStraightCorners(points: Array<Point>): Array<Point> {
  return points.filter((corner, i) => {
    const before = points[(i + points.length - 1) % points.length]
    const after = points[(i + 1) % points.length]
    const turn =
      (corner.x - before.x) * (after.y - before.y) -
      (corner.y - before.y) * (after.x - before.x)
    return Math.abs(turn) > 1e-6
  })
}

/**
 * Every smallest closed loop in the walls.
 *
 * Walked half-edge by half-edge, turning as sharply as the walls allow at each
 * corner. Turning that way always keeps the enclosed side on the same hand, so
 * each walk comes back to where it started having traced one loop, and every
 * loop is traced exactly once. The walk around the outside of the plan comes
 * out wound the other way, and is dropped along with the slivers.
 */
export function wallLoops(walls: Array<WallRun>): Array<Array<Point>> {
  const { points, neighbours } = graphOf(planarEdges(wallLines(walls)))
  const walked = new Set<string>()
  const loops: Array<Array<Point>> = []

  for (let start = 0; start < points.length; start++) {
    for (const first of neighbours[start]) {
      if (walked.has(`${start}>${first}`)) continue
      const ring: Array<number> = []
      let from = start
      let to = first
      // A loop cannot be longer than the graph has half-edges; the bound is
      // belt and braces against a malformed graph walking for ever.
      for (let step = 0; step <= points.length * 8; step++) {
        walked.add(`${from}>${to}`)
        ring.push(from)
        const around = neighbours[to]
        const back = around.indexOf(from)
        const next = around[(back - 1 + around.length) % around.length]
        from = to
        to = next
        if (from === start && to === first) break
      }

      const ordered = trimSpurs(ring)
      if (ordered.length < 3) continue
      const loop = dropStraightCorners(ordered.map((i) => points[i]))
      if (loop.length < 3) continue
      if (
        signedDoubleArea(loop) / 2 >= MIN_ENCLOSURE_AREA &&
        averageWidth(loop) >= MIN_ENCLOSURE_WIDTH
      ) {
        loops.push(loop)
      }
    }
  }
  return loops
}

/** A loop's name: its corners in order, from its lowest one. */
function loopKey(points: Array<Point>): string {
  const written = points.map(
    (p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`,
  )
  let first = 0
  for (let i = 1; i < written.length; i++) {
    if (written[i] < written[first]) first = i
  }
  return [...written.slice(first), ...written.slice(0, first)].join(' ')
}

/**
 * Bind saved names to the spaces they were put on.
 *
 * A name is kept against a point inside the space it names rather than against
 * the space itself, because a space has no lasting identity to keep it
 * against: it is only ever the current answer to what the walls close in, and
 * nudging one wall replaces it with another. A point survives that, and the
 * name goes wherever the point ends up being indoors.
 *
 * A name whose point has been walled out of every space is not thrown away.
 * The wall that shut it out can be moved back, and the name is waiting where
 * it was — so a mistake with a wall does not also cost the reader a name.
 */
function boundSpace(
  spaces: Array<Space>,
  taken: Set<string>,
  loop: Array<Point>,
): Space | null {
  const inside = spaces.find(
    (space) => !taken.has(space.id) && pointInPolygon(space.seed, loop),
  )
  if (inside) taken.add(inside.id)
  return inside ?? null
}

/**
 * Every space the walls close in, in the order they will be drawn: largest
 * first, so a space walled off inside another is drawn over it rather than
 * under it and stays clickable.
 */
export function enclosuresOf(
  walls: Array<WallRun>,
  spaces: Array<Space> = [],
): Array<Enclosure> {
  const taken = new Set<string>()
  const loops = wallLoops(walls)
    .map((points) => ({
      points,
      area: polygonArea(points),
      centre: interiorPoint(points),
    }))
    .sort((a, b) => a.area - b.area)
  // A disconnected inner loop is a hole in its immediate enclosing floor.
  const parents = loops.map((loop, index) =>
    loops.findIndex(
      (outer, candidate) =>
        candidate > index && pointInPolygon(loop.centre, outer.points),
    ),
  )
  const floors = loops.map((loop, index) => {
    const children = loops.filter((_, child) => parents[child] === index)
    const contains = (point: Point) =>
      pointInPolygon(point, loop.points) &&
      !children.some((child) => pointInPolygon(point, child.points))
    let centre = loop.centre
    if (!contains(centre)) {
      for (let i = 0; i < loop.points.length; i++) {
        const a = loop.points[i],
          b = loop.points[(i + 1) % loop.points.length]
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const candidate = {
          x: midpoint.x * 0.99 + loop.centre.x * 0.01,
          y: midpoint.y * 0.99 + loop.centre.y * 0.01,
        }
        if (contains(candidate)) {
          centre = candidate
          break
        }
      }
    }
    return {
      key: loopKey(loop.points),
      points: loop.points,
      area: loop.area - children.reduce((sum, child) => sum + child.area, 0),
      // The walls around the room take their half off the floor; the walls
      // around anything standing in it take theirs off as well, which is why
      // a hole is measured to its outer face and this floor to its inner one.
      floor: Math.max(
        0,
        offsetArea(loop.points, FACE) -
          children.reduce(
            (sum, child) => sum + offsetArea(child.points, -FACE),
            0,
          ),
      ),
      centre,
      space: boundSpace(spaces, taken, loop.points),
    }
  })
  return floors.reverse()
}

/**
 * Whether a wall runs along a loop's boundary rather than merely touching it.
 *
 * What is asked for is an overlap with a length to it, not a point: a wall
 * that only ends on this space's boundary — a stub walled onto the outside of
 * it, or a run setting off elsewhere from one of its corners — is not one of
 * the walls that close it in, and moving it leaves the space alone.
 */
function runsAlong(loop: Array<Point>, wall: Segment): boolean {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const length = distance(a, b)
    if (length === 0) continue
    const along = (p: Point) =>
      ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) /
      (length * length)
    const off = (p: Point, t: number) =>
      distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    const from = along(wall.a)
    const to = along(wall.b)
    if (off(wall.a, from) > WELD || off(wall.b, to) > WELD) continue
    const overlap =
      Math.min(1, Math.max(from, to)) - Math.max(0, Math.min(from, to))
    if (overlap * length > WELD) return true
  }
  return false
}

/**
 * The runs of wall that close a space in.
 *
 * A space has no walls of its own. Every wall around it was drawn as part of
 * some room or run and belongs to that one, which is where it is edited — so
 * this is the way back: the rooms with a wall lying along this space's
 * boundary, which are the rooms that have to stand still for the space to keep
 * its shape.
 */
export function enclosureWalls(
  walls: Array<WallRun>,
  enclosure: Enclosure,
): Array<WallRun> {
  return walls.filter((run) => {
    for (let i = 0; i < wallCount(run); i++) {
      const wall = runWallAt(run, i)
      if (wall && runsAlong(enclosure.points, wall)) return true
    }
    return false
  })
}

/** A fixed group captured before a move, so snapping never adds new walls. */
export type EnclosureGroup = {
  enclosure: Enclosure
  walls: Array<WallRun>
  spaces: Array<Space>
}

export function enclosureGroup(
  walls: Array<WallRun>,
  enclosures: Array<Enclosure>,
  enclosure: Enclosure,
): EnclosureGroup {
  const ids = new Set(enclosureWalls(walls, enclosure).map((run) => run.id))
  for (const run of walls) {
    if (run.attachment && ids.has(run.attachment.runId)) ids.add(run.id)
  }
  return {
    enclosure,
    walls: walls.filter((run) => ids.has(run.id)),
    spaces: enclosures.flatMap((floor) =>
      floor.space &&
      enclosureWalls(walls, floor).every((run) => ids.has(run.id))
        ? [{ ...floor.space, seed: floor.centre }]
        : [],
    ),
  }
}

/**
 * Whether a space is held where it is.
 *
 * A space is held once every run that closes it in is locked, and not before:
 * one wall still free to be dragged is enough to make a different space of it,
 * so a space is only as held as its least held wall. A space no wall answers
 * for is not held either — there is nothing there to hold.
 */
export function enclosureLocked(
  walls: Array<WallRun>,
  enclosure: Enclosure,
): boolean {
  const boundary = enclosureWalls(walls, enclosure)
  return boundary.length > 0 && boundary.every((run) => run.locked === true)
}

/**
 * The floor inside a closet, measured the way a room's is.
 *
 * Its front is drawn open, but the wall it is set into is still standing
 * across it, so all four of its sides give up their half of a wall to it.
 */
export function closetFloor(run: WallRun): number {
  return offsetArea(run.points, FACE)
}

/** Room count and floor area come exclusively from the walls. */
export function planFloors(
  walls: Array<WallRun>,
  spaces: Array<Space> = [],
): { count: number; area: number; floor: number } {
  const floors = enclosuresOf(walls, spaces)
  return {
    count: floors.length,
    area: floors.reduce((sum, found) => sum + found.area, 0),
    floor: floors.reduce((sum, found) => sum + found.floor, 0),
  }
}

/** The enclosed space a click at `world` lands in, innermost first. */
export function enclosureAt(
  enclosures: Array<Enclosure>,
  world: Point,
): Enclosure | null {
  // Smallest last in the sort above, so the search runs back from the end and
  // a space inside another space is the one that answers.
  for (let i = enclosures.length - 1; i >= 0; i--) {
    if (pointInPolygon(world, enclosures[i].points)) return enclosures[i]
  }
  return null
}

/** What an unnamed space is called until it is given a name. */
export function enclosureName(enclosure: Enclosure): string {
  return enclosure.space?.name ?? 'Unnamed room'
}
