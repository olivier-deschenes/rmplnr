import {
  distance,
  polygonArea,
  polygonCentroid,
  worldToScreen,
} from './geometry.ts'
import { formatArea, formatLength } from './units.ts'

import type { Furniture, Point, Rect, Room, Units, Viewport } from './types.ts'

/**
 * Layout for the wall dimensions the plan carries at all times.
 *
 * Because every wall is labelled whether or not its room is selected, the
 * numbers have to earn their own space. Each is offered the strip of canvas
 * just outside its wall, in the drafting convention: turned to run along the
 * wall, on the far side of it from the room. When something is already there —
 * another dimension, a wall, a room's name, a piece of furniture — the label
 * slides along its wall, then crosses to the inside of it, and only once it has
 * run out of room beside its own wall does it step away on a leader line.
 *
 * All of this is screen-space work: labels hold one size at every zoom, so
 * whether two of them clash depends on the viewport, not on the plan.
 */

/** A rectangle in screen space, free to sit at an angle. */
export type Box = { centre: Point; w: number; h: number; angle: number }

export type WallLabel = {
  key: string
  text: string
  box: Box
  /** Set only when the label had to leave its wall to find room. */
  leader: { from: Point; to: Point } | null
}

export const LABEL_FONT = 10
export const LABEL_HEIGHT = LABEL_FONT + 6
/** How much further out each ring of placements sits than the last. */
export const STEP = 16

/** The app is monospaced throughout, so label widths need no measuring. */
const CHAR_WIDTH = LABEL_FONT * 0.6
const PAD_X = 4

/** Clear space between a wall and the near edge of its label. */
const GAP = 8
/** Rings of placements to try, the first of which is against the wall. */
const RINGS = 4
/** Where along its wall a label may slide, as a fraction of the room it has. */
const SLIDES = [0, 0.5, -0.5, 1, -1]
/** Boxes are held this far apart, so two labels never read as one. */
const MARGIN = 2
/** Walls this short on screen go unlabelled rather than crowd the drawing. */
const MIN_WALL_PX = 18
/** The width a wall line is treated as having when labels dodge it. */
const WALL_THICKNESS = 4
/**
 * How far past the canvas edge a wall still gets a label. A big plan is mostly
 * off-screen and the layout is redone on every frame of a pan, so the work is
 * held to the walls a reader could plausibly see.
 */
const OFFSCREEN = 250
/**
 * The furthest a label can end up from its own wall: the outermost ring, plus
 * the half-diagonal of a generous label. Obstacles are kept this much further
 * out than walls are, so a label placed at the edge of the laid-out area still
 * meets everything that could touch it.
 */
const REACH = GAP + LABEL_HEIGHT / 2 + (RINGS - 1) * STEP + 80

function textWidth(text: string): number {
  return text.length * CHAR_WIDTH + PAD_X * 2
}

function boxCorners(box: Box): Array<Point> {
  const rad = (box.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = box.w / 2
  const hh = box.h / 2
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => ({
    x: box.centre.x + p.x * cos - p.y * sin,
    y: box.centre.y + p.x * sin + p.y * cos,
  }))
}

function span(points: Array<Point>, axis: Point): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    min = Math.min(min, d)
    max = Math.max(max, d)
  }
  return [min, max]
}

/**
 * Separating-axis test. Two boxes miss each other when the shadow they cast on
 * some edge normal of either one leaves a gap, so a single clear axis is proof
 * enough to stop looking. The circles around the boxes are compared first,
 * which settles nearly every pair without any of that work: this runs on each
 * of a few dozen placements per label, on every frame of a pan.
 */
function overlaps(a: Box, b: Box): boolean {
  const dx = a.centre.x - b.centre.x
  const dy = a.centre.y - b.centre.y
  const reach = (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 2
  if (dx * dx + dy * dy > reach * reach) return false

  const shapes = [boxCorners(a), boxCorners(b)]
  for (const shape of shapes) {
    for (let i = 0; i < shape.length; i++) {
      const p = shape[i]
      const q = shape[(i + 1) % shape.length]
      const axis = { x: p.y - q.y, y: q.x - p.x }
      const [minA, maxA] = span(shapes[0], axis)
      const [minB, maxB] = span(shapes[1], axis)
      if (maxA < minB || maxB < minA) return false
    }
  }
  return true
}

function grow(box: Box, by: number): Box {
  return { ...box, w: box.w + by * 2, h: box.h + by * 2 }
}

/** Does any part of `box` fall within `view`? Its circle is close enough. */
function inView(box: Box, view: Rect): boolean {
  const reach = Math.hypot(box.w, box.h) / 2
  return (
    box.centre.x + reach >= view.x &&
    box.centre.x - reach <= view.x + view.w &&
    box.centre.y + reach >= view.y &&
    box.centre.y - reach <= view.y + view.h
  )
}

/**
 * Try `centres` in order and return the first that holds `text` without
 * touching anything in `taken`, or null when the text has nowhere to go. The
 * caller supplies the places worth trying, and so decides how a label is
 * allowed to move: a wall's dimension roams around its wall, while a readout
 * hanging off a selection may only back away from it.
 */
export function findSpot(
  centres: Array<Point>,
  text: string,
  angle: number,
  taken: Array<Box>,
): { box: Box; index: number } | null {
  const w = textWidth(text)
  for (let index = 0; index < centres.length; index++) {
    const box: Box = { centre: centres[index], w, h: LABEL_HEIGHT, angle }
    if (!taken.some((other) => overlaps(grow(box, MARGIN), other))) {
      return { box, index }
    }
  }
  return null
}

/** The footprint a piece of furniture occupies on screen, rotation and all. */
function furnitureBox(item: Furniture, vp: Viewport): Box {
  return {
    centre: worldToScreen({ x: item.x, y: item.y }, vp),
    w: item.w * vp.scale,
    h: item.h * vp.scale,
    angle: item.rotation,
  }
}

/** The name-over-area block `RoomLabels` draws at a room's centroid. */
function roomLabelBox(room: Room, vp: Viewport, units: Units): Box {
  const at = worldToScreen(polygonCentroid(room.points), vp)
  return {
    // Two lines: the name sits on the centroid, the area 14px below it.
    centre: { x: at.x, y: at.y + 4 },
    w: Math.max(
      textWidth(room.name),
      textWidth(formatArea(polygonArea(room.points), units)),
    ),
    h: 30,
    angle: 0,
  }
}

/** A wall drawn as the thin box a label has to keep off. */
function wallBox(a: Point, b: Point): Box {
  return {
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    w: Math.hypot(b.x - a.x, b.y - a.y),
    h: WALL_THICKNESS,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  }
}

/**
 * +1 when the polygon winds so that turning an edge's direction to `(dy, -dx)`
 * points out of the room, -1 when it winds the other way. For a simple polygon
 * the winding alone settles this, concave corners included.
 */
function outwardSign(points: Array<Point>): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum >= 0 ? 1 : -1
}

/** The wall's own angle, folded into the half-turn that reads right way up. */
function uprightAngle(dir: Point): number {
  const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
  if (deg > 90) return deg - 180
  if (deg < -90) return deg + 180
  return deg
}

type Candidate = {
  key: string
  text: string
  /** Midpoint of the wall on screen, where the label would rather sit. */
  mid: Point
  /** Unit vector pointing out of the room, perpendicular to the wall. */
  normal: Point
  /** Unit vector along the wall, the direction a label may slide. */
  tangent: Point
  angle: number
  length: number
}

/** One place a label could sit, and the point on the wall it answers to. */
type Slot = { centre: Point; foot: Point; atWall: boolean }

/**
 * Everywhere a wall's label may sit, best first. Staying beside its own wall
 * beats being centred on it, so every slide and both sides are exhausted
 * before the label steps out onto a leader line: a wall pinched against its
 * neighbour — a party wall, a corridor — reads better with its number tucked
 * into its own room than flung across the plan.
 */
function wallSlots(candidate: Candidate, width: number): Array<Slot> {
  const { mid, normal, tangent, length } = candidate
  // How far the label can slide before it overhangs the wall it belongs to.
  const runway = Math.max(0, (length - width) / 2)
  const slots: Array<Slot> = []

  for (let ring = 0; ring < RINGS; ring++) {
    const out = GAP + LABEL_HEIGHT / 2 + ring * STEP
    for (const side of [1, -1]) {
      for (const slide of SLIDES) {
        const along = runway * slide
        const foot = {
          x: mid.x + tangent.x * along,
          y: mid.y + tangent.y * along,
        }
        slots.push({
          foot,
          centre: {
            x: foot.x + normal.x * out * side,
            y: foot.y + normal.y * out * side,
          },
          atWall: ring === 0,
        })
        // Nothing to slide along: one slot per side per ring is enough.
        if (runway === 0) break
      }
    }
  }
  return slots
}

export function wallLabels(
  rooms: Array<Room>,
  furniture: Array<Furniture>,
  viewport: Viewport,
  units: Units,
  size: { width: number; height: number },
): Array<WallLabel> {
  // Two nested areas: walls inside the first are worth labelling, and anything
  // inside the second is close enough to get in such a label's way.
  const around = (by: number): Rect => ({
    x: -by,
    y: -by,
    w: size.width + by * 2,
    h: size.height + by * 2,
  })
  const laidOut = around(OFFSCREEN)
  const consulted = around(OFFSCREEN + REACH)

  // Everything already on the canvas that a number must not land on. Labels
  // join the list as they are placed, so they clear each other as well.
  const taken: Array<Box> = [
    ...furniture.map((item) => furnitureBox(item, viewport)),
    ...rooms.map((room) => roomLabelBox(room, viewport, units)),
  ].filter((box) => inView(box, consulted))

  const candidates: Array<Candidate> = []

  for (const room of rooms) {
    const sign = outwardSign(room.points)
    const screen = room.points.map((p) => worldToScreen(p, viewport))

    for (let i = 0; i < room.points.length; i++) {
      const next = (i + 1) % room.points.length
      const a = screen[i]
      const b = screen[next]
      const wall = wallBox(a, b)
      if (!inView(wall, consulted)) continue
      taken.push(wall)

      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length < MIN_WALL_PX || !inView(wall, laidOut)) continue

      const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
      candidates.push({
        key: `${room.id}:${i}`,
        text: formatLength(distance(room.points[i], room.points[next]), units),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        normal: { x: tangent.y * sign, y: -tangent.x * sign },
        tangent,
        angle: uprightAngle(tangent),
        length,
      })
    }
  }

  // Longest walls first: they carry the dimensions most worth reading, so they
  // get the strip beside their own line and the short ones work around them.
  candidates.sort((a, b) => b.length - a.length)

  const labels: Array<WallLabel> = []

  for (const candidate of candidates) {
    const slots = wallSlots(candidate, textWidth(candidate.text))
    const spot = findSpot(
      slots.map((slot) => slot.centre),
      candidate.text,
      candidate.angle,
      taken,
    )
    if (!spot) continue

    taken.push(spot.box)
    const slot = slots[spot.index]
    labels.push({
      key: candidate.key,
      text: candidate.text,
      box: spot.box,
      // Only a label that had to leave its wall need say where it came from.
      leader: slot.atWall ? null : { from: slot.foot, to: leaderEnd(slot) },
    })
  }

  return labels
}

/** Where a leader stops: at the near edge of the label it points to. */
function leaderEnd({ centre, foot }: Slot): Point {
  const dx = centre.x - foot.x
  const dy = centre.y - foot.y
  const d = Math.hypot(dx, dy) || 1
  return {
    x: centre.x - (dx / d) * (LABEL_HEIGHT / 2),
    y: centre.y - (dy / d) * (LABEL_HEIGHT / 2),
  }
}
