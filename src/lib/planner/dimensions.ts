import {
  distance,
  outwardSign,
  polygonArea,
  polygonCentroid,
  worldToScreen,
} from './geometry.ts'
import { openingEnds, openingWall } from './openings.ts'
import { formatArea, formatLength } from './units.ts'
import { HINGED_KINDS } from './presets.ts'
import { WALL_THICKNESS } from './walls.ts'

import type {
  Furniture,
  Opening,
  Point,
  Rect,
  Room,
  Units,
  Viewport,
} from './types.ts'

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
  roomId: string
  roomName: string
  wall: number
  text: string
  box: Box
  /** Set only when the label had to leave its wall to find room. */
  leader: { from: Point; to: Point } | null
}

/** A name written across the thing it belongs to. */
export type NameLabel = { id: string; text: string; box: Box }

export const LABEL_FONT = 10
export const LABEL_HEIGHT = LABEL_FONT + 6
/** How much further out each ring of placements sits than the last. */
export const STEP = 16

/**
 * What a name is written at, wherever one is written on the plan: a room's
 * across its floor, a piece of furniture's across its footprint. A shade larger
 * than a dimension, because it is what the thing is rather than how big it is.
 */
export const NAME_FONT = 11
export const NAME_HEIGHT = NAME_FONT + 6

/** The app is monospaced throughout, so label widths need no measuring. */
const CHAR_RATIO = 0.6
const PAD_X = 4

/** Clear space between a wall and the near edge of its label. */
const GAP = 8
/** Rings of placements to try, the first of which is against the wall. */
const RINGS = 4
/** Where along its wall a label may slide, as a fraction of the room it has. */
const SLIDES = [0, 0.5, -0.5, 1, -1]
/** How far a name may step across its own item, as a fraction of the same. */
const NAME_SLIDES = [0.5, 1]
/** Boxes are held this far apart, so two labels never read as one. */
const MARGIN = 2
/** Walls this short on screen go unlabelled rather than crowd the drawing. */
const MIN_WALL_PX = 18
/** The least a wall is treated as taking up when labels dodge it, in pixels. */
const WALL_MARK = 4
/** How far off the wall a window or a plain gap is treated as reaching. */
const PANE_DEPTH = 10
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

/** How wide `text` comes out at `font` pixels, the plate's padding and all. */
export function textWidth(text: string, font: number = LABEL_FONT): number {
  return text.length * font * CHAR_RATIO + PAD_X * 2
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
      textWidth(room.name, NAME_FONT),
      textWidth(formatArea(polygonArea(room.points), units)),
    ),
    h: 30,
    angle: 0,
  }
}

/**
 * Where each room's own name and area is written. The layouts here work around
 * these as a matter of course; they are handed out for the labels that come and
 * go — the clearances put up while something is dragged — which are laid beside
 * what the plan already says rather than laid out along with it.
 */
export function roomLabelBoxes(
  rooms: Array<Room>,
  vp: Viewport,
  units: Units,
): Array<Box> {
  return rooms.map((room) => roomLabelBox(room, vp, units))
}

/**
 * Where a piece of furniture's name is written, or null when the item has no
 * room for it.
 *
 * A name stays inside the footprint it belongs to — a name floating beside a
 * sofa would be a name belonging to nothing — so it is written in the middle
 * and, if something is already there, stepped out along the item's own axes as
 * far as the footprint allows. It is written upright, the way a room's name is,
 * so what has to fit inside the turned footprint is the upright plate: with
 * `c` and `s` the cosine and sine of the rotation, a `w` by `h` plate takes
 * `w·c + h·s` of the item's width and `w·s + h·c` of its height.
 */
function namePlacement(
  item: Furniture,
  vp: Viewport,
  taken: Array<Box>,
): Box | null {
  const w = textWidth(item.name, NAME_FONT)
  const h = NAME_HEIGHT
  const rad = (item.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // What the upright plate takes up along each of the item's own two axes.
  const plate = {
    x: w * Math.abs(cos) + h * Math.abs(sin),
    y: w * Math.abs(sin) + h * Math.abs(cos),
  }
  const footprint = { x: item.w * vp.scale, y: item.h * vp.scale }
  if (plate.x > footprint.x || plate.y > footprint.y) return null

  // How far the plate may step from the middle and still stand on the item,
  // less the margin that keeps it off the item's own outline.
  const runway = {
    x: Math.max(0, (footprint.x - plate.x) / 2 - MARGIN),
    y: Math.max(0, (footprint.y - plate.y) / 2 - MARGIN),
  }

  const centre = worldToScreen({ x: item.x, y: item.y }, vp)
  // The middle of the item, and then the least the name can move and still get
  // clear: out along the item's own axes, sorted so the shortest move of the
  // lot is tried first and the name stays as near the middle as it can.
  const offsets = [
    { x: 0, y: 0 },
    ...NAME_SLIDES.flatMap((slide) => [
      { x: 0, y: runway.y * slide },
      { x: 0, y: -runway.y * slide },
      { x: runway.x * slide, y: 0 },
      { x: -runway.x * slide, y: 0 },
    ]),
  ].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))

  for (const offset of offsets) {
    const box: Box = {
      centre: {
        x: centre.x + offset.x * cos - offset.y * sin,
        y: centre.y + offset.x * sin + offset.y * cos,
      },
      w,
      h,
      angle: 0,
    }
    if (!taken.some((other) => overlaps(grow(box, MARGIN), other))) return box
  }
  return null
}

/**
 * What each piece of furniture is called, laid out across the plan.
 *
 * The only thing a name has to work around is a room's own label, which is
 * written at the centroid whatever happens to be standing there. The wall
 * dimensions need no such care in return: they already dodge the whole
 * footprint, and a name never leaves the footprint it belongs to.
 */
export function furnitureNames(
  rooms: Array<Room>,
  furniture: Array<Furniture>,
  vp: Viewport,
  units: Units,
): Array<NameLabel> {
  const taken = rooms.map((room) => roomLabelBox(room, vp, units))
  const labels: Array<NameLabel> = []

  for (const item of furniture) {
    const box = namePlacement(item, vp, taken)
    if (!box) continue
    // Two items only overlap when the plan is being drawn with collisions off,
    // but when they do their names should not be written over each other.
    taken.push(box)
    labels.push({ id: item.id, text: item.name, box })
  }
  return labels
}

/**
 * The room an opening takes up on the drawing. A door is the one that really
 * asks for space: its arc sweeps a whole quarter circle off the wall, and a
 * number landing inside that is unreadable.
 */
function openingBox(
  opening: Opening,
  rooms: Array<Room>,
  vp: Viewport,
): Box | null {
  const wall = openingWall(rooms, opening)
  if (!wall) return null
  const { centre, width } = openingEnds(wall, opening)
  const swings = HINGED_KINDS.includes(opening.kind)
  const depth = swings ? width : PANE_DEPTH
  // Push the box off the wall onto the side the door actually opens into.
  const side = swings ? (opening.swing === 'out' ? 1 : -1) : 0
  const off = (depth / 2) * side
  return {
    centre: worldToScreen(
      {
        x: centre.x + wall.normal.x * off,
        y: centre.y + wall.normal.y * off,
      },
      vp,
    ),
    w: width * vp.scale,
    h: Math.max(depth * vp.scale, WALL_THICKNESS * vp.scale, WALL_MARK),
    angle: (Math.atan2(wall.tangent.y, wall.tangent.x) * 180) / Math.PI,
  }
}

/** A wall drawn as the box a label has to keep off, its own thickness and all. */
function wallBox(a: Point, b: Point, scale: number): Box {
  return {
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    w: Math.hypot(b.x - a.x, b.y - a.y),
    h: Math.max(WALL_MARK, WALL_THICKNESS * scale),
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  }
}

/** The wall's own angle, folded into the half-turn that reads right way up. */
export function uprightAngle(dir: Point): number {
  const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
  if (deg > 90) return deg - 180
  if (deg < -90) return deg + 180
  return deg
}

type Candidate = {
  key: string
  roomId: string
  roomName: string
  wall: number
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
  openings: Array<Opening>,
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
    ...openings.flatMap((opening) => {
      const box = openingBox(opening, rooms, viewport)
      return box ? [box] : []
    }),
  ].filter((box) => inView(box, consulted))

  const candidates: Array<Candidate> = []
  // Walls already spoken for. Two rooms that share a wall each carry their own
  // copy of it, and one wall wants one number, so the second room's copy is
  // passed over: same line, same length, already labelled.
  const numbered: Array<{ mid: Point; length: number }> = []

  for (const room of rooms) {
    const sign = outwardSign(room.points)
    const screen = room.points.map((p) => worldToScreen(p, viewport))

    for (let i = 0; i < room.points.length; i++) {
      const next = (i + 1) % room.points.length
      const a = screen[i]
      const b = screen[next]
      const wall = wallBox(a, b, viewport.scale)
      if (!inView(wall, consulted)) continue
      taken.push(wall)

      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length < MIN_WALL_PX || !inView(wall, laidOut)) continue

      const world = distance(room.points[i], room.points[next])
      const mid = {
        x: (room.points[i].x + room.points[next].x) / 2,
        y: (room.points[i].y + room.points[next].y) / 2,
      }
      if (
        numbered.some(
          (done) =>
            Math.abs(done.length - world) < 1 &&
            distance(done.mid, mid) < WALL_THICKNESS,
        )
      ) {
        continue
      }
      numbered.push({ mid, length: world })

      const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
      candidates.push({
        key: `${room.id}:${i}`,
        roomId: room.id,
        roomName: room.name,
        wall: i,
        text: formatLength(world, units),
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
      roomId: candidate.roomId,
      roomName: candidate.roomName,
      wall: candidate.wall,
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
