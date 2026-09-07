import {
  interiorPoint,
  pointInPolygon,
  polygonArea,
  distance,
} from './geometry.ts'
import { wallCount, roomWallAt } from './openings.ts'
import { WALL_THICKNESS } from './walls.ts'

import type { Point, Room, Space } from './types.ts'

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

/**
 * How much of a closed room's own area a loop has to account for to *be* that
 * room's floor rather than a part of it walled off since.
 */
const SAME_FLOOR = 0.02

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
  /** Enclosed floor area in cm². */
  area: number
  /** Somewhere inside it: where its name is written, and what a click hits. */
  centre: Point
  /** The closed room that was drawn as this floor, if it was drawn as one. */
  roomId: string | null
  /** The name and colour put on it, once someone has put one on. */
  space: Space | null
}

type Segment = { a: Point; b: Point }

/** Every wall centreline on the plan, whichever run it was drawn as part of. */
export function wallLines(rooms: Array<Room>): Array<Segment> {
  const lines: Array<Segment> = []
  for (const room of rooms) {
    for (let i = 0; i < wallCount(room); i++) {
      const wall = roomWallAt(room, i)
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
export function wallLoops(rooms: Array<Room>): Array<Array<Point>> {
  const { points, neighbours } = graphOf(planarEdges(wallLines(rooms)))
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
  rooms: Array<Room>,
  spaces: Array<Space> = [],
): Array<Enclosure> {
  const closed = rooms.filter((room) => room.closed !== false)
  const found: Array<Enclosure> = []
  const taken = new Set<string>()

  for (const loop of wallLoops(rooms)) {
    const area = polygonArea(loop)
    const centre = interiorPoint(loop)
    // Searched from the end, so that the room drawn last wins the floor it
    // shares — the same order the canvas paints them in.
    const host = [...closed]
      .reverse()
      .find((room) => pointInPolygon(centre, room.points))
    if (host) {
      const drawnAsThisRoom =
        Math.abs(polygonArea(host.points) - area) <=
        Math.max(MIN_ENCLOSURE_AREA, area * SAME_FLOOR)
      // A loop inside a room that is smaller than it is a part of that room
      // walled off since. The room is still drawn whole, and its floor covers
      // this one, so offering it as a space of its own would only put a second
      // name on ground that already has one.
      if (!drawnAsThisRoom) continue
      found.push({
        key: loopKey(loop),
        points: loop,
        area,
        centre,
        roomId: host.id,
        space: null,
      })
      continue
    }
    found.push({
      key: loopKey(loop),
      points: loop,
      area,
      centre,
      roomId: null,
      space: null,
    })
  }

  found.sort((one, other) => other.area - one.area)
  return found.map((enclosure) =>
    enclosure.roomId
      ? enclosure
      : { ...enclosure, space: boundSpace(spaces, taken, enclosure.points) },
  )
}

/** The spaces that were not drawn as rooms — the ones a name is saved for. */
export function freeEnclosures(
  rooms: Array<Room>,
  spaces: Array<Space> = [],
): Array<Enclosure> {
  return enclosuresOf(rooms, spaces).filter(
    (enclosure) => enclosure.roomId === null,
  )
}

/**
 * How many rooms the plan has, and how much floor there is between them.
 *
 * Both halves of the plan are counted: the rooms drawn as rooms, off their own
 * outlines, and the spaces that were only ever walled in, off the walls. There
 * is no double counting between them — a space standing on a drawn room's
 * floor is that room, and never comes back as a space of its own.
 */
export function planFloors(
  rooms: Array<Room>,
  spaces: Array<Space> = [],
): { count: number; area: number } {
  const drawn = rooms.filter((room) => room.closed !== false)
  const walled = freeEnclosures(rooms, spaces)
  return {
    count: drawn.length + walled.length,
    area:
      drawn.reduce((total, room) => total + polygonArea(room.points), 0) +
      walled.reduce((total, enclosure) => total + enclosure.area, 0),
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
