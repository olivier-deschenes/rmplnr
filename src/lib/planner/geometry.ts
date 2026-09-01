import {
  HANDLE_DIR,
  MAX_SCALE,
  MIN_SCALE,
  MIN_SIZE,
  SNAP_ANGLE,
} from './types.ts'

import type { Furniture, Handle, Point, Rect, Room, Viewport } from './types.ts'

export function worldToScreen(p: Point, vp: Viewport): Point {
  return { x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty }
}

export function screenToWorld(p: Point, vp: Viewport): Point {
  return { x: (p.x - vp.tx) / vp.scale, y: (p.y - vp.ty) / vp.scale }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function snapValue(v: number, step: number): number {
  return Math.round(v / step) * step
}

/** Snaps to `step`, or passes the point through when snapping is off. */
export function snapPoint(p: Point, step: number | null): Point {
  return step === null
    ? { x: p.x, y: p.y }
    : { x: snapValue(p.x, step), y: snapValue(p.y, step) }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Keep the world point under `anchor` pinned while the scale changes. */
export function zoomAt(
  vp: Viewport,
  anchor: Point,
  nextScale: number,
): Viewport {
  const scale = clampScale(nextScale)
  const k = scale / vp.scale
  return {
    scale,
    tx: anchor.x - (anchor.x - vp.tx) * k,
    ty: anchor.y - (anchor.y - vp.ty) * k,
  }
}

/** Rotate `p` around `origin` by `deg` degrees, clockwise in screen space. */
export function rotatePoint(p: Point, origin: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** The clockwise screen-space angle from `a` to `b`, where 0° points right. */
export function angleBetween(a: Point, b: Point): number {
  return normalizeAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)
}

// --- polygons ---------------------------------------------------------------

/** Shoelace area in cm², always positive. */
export function polygonArea(points: Array<Point>): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function squareMetres(areaCm2: number): number {
  return areaCm2 / 10_000
}

export function polygonBounds(points: Array<Point>): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Area-weighted centroid, falling back to the bounds centre for slivers. */
export function polygonCentroid(points: Array<Point>): Point {
  let signedArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const cross = a.x * b.y - b.x * a.y
    signedArea += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  if (Math.abs(signedArea) < 1e-6) {
    const bounds = polygonBounds(points)
    return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  }
  const k = 1 / (3 * signedArea)
  return { x: cx * k, y: cy * k }
}

/**
 * Whether a point falls inside a polygon, by counting the crossings of a ray
 * cast out from it: an odd number of them means it set off indoors. Rooms bent
 * round a corner are read the same way as square ones, and so is a rotated
 * piece of furniture, whose own four corners make a polygon like any other.
 */
export function pointInPolygon(p: Point, points: Array<Point>): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    // Only an edge with one end either side of the ray can be crossed by it.
    if (a.y > p.y === b.y > p.y) continue
    if (p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * +1 when the polygon winds so that turning an edge's direction to `(dy, -dx)`
 * points out of the room, -1 when it winds the other way. For a simple polygon
 * the winding alone settles this, concave corners included.
 */
export function outwardSign(points: Array<Point>): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum >= 0 ? 1 : -1
}

/** The four corners, clockwise, of the box spanned by two opposite points. */
export function rectPolygon(a: Point, b: Point): Array<Point> {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
}

export function translatePolygon(
  points: Array<Point>,
  dx: number,
  dy: number,
): Array<Point> {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

/** Stretch a polygon so its bounding box becomes `newW` x `newH`. */
export function scalePolygon(
  points: Array<Point>,
  newW: number,
  newH: number,
): Array<Point> {
  const bounds = polygonBounds(points)
  const kx = bounds.w === 0 ? 1 : Math.max(MIN_SIZE, newW) / bounds.w
  const ky = bounds.h === 0 ? 1 : Math.max(MIN_SIZE, newH) / bounds.h
  return points.map((p) => ({
    x: bounds.x + (p.x - bounds.x) * kx,
    y: bounds.y + (p.y - bounds.y) * ky,
  }))
}

export type WallGeometryChange = {
  length?: number
  angle?: number
}

export type WallGeometryResult =
  { ok: true; points: Array<Point> } | { ok: false; error: string }

const GEOMETRY_EPSILON = 1e-6

function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.abs(turn(a, b, p)) <= GEOMETRY_EPSILON &&
    p.x >= Math.min(a.x, b.x) - GEOMETRY_EPSILON &&
    p.x <= Math.max(a.x, b.x) + GEOMETRY_EPSILON &&
    p.y >= Math.min(a.y, b.y) - GEOMETRY_EPSILON &&
    p.y <= Math.max(a.y, b.y) + GEOMETRY_EPSILON
  )
}

/** Whether two closed line segments touch or cross. */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = turn(a, b, c)
  const abD = turn(a, b, d)
  const cdA = turn(c, d, a)
  const cdB = turn(c, d, b)

  if (
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  ) {
    return true
  }

  return (
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  )
}

function signedDoubleArea(points: Array<Point>): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area
}

/**
 * Explain why a changed outline cannot remain a room, or return null when it
 * is still a connected, simple polygon with the same winding.
 */
export function outlineIssue(
  before: Array<Point>,
  after: Array<Point>,
): string | null {
  if (before.length !== after.length || after.length < 3) {
    return 'That wall no longer belongs to a complete room.'
  }

  for (let i = 0; i < after.length; i++) {
    const next = (i + 1) % after.length
    if (distance(after[i], after[next]) < MIN_SIZE - GEOMETRY_EPSILON) {
      return `That change would make an adjoining wall shorter than ${MIN_SIZE} cm.`
    }
  }

  const beforeArea = signedDoubleArea(before)
  const afterArea = signedDoubleArea(after)
  if (
    Math.abs(afterArea) <= GEOMETRY_EPSILON ||
    Math.sign(afterArea) !== Math.sign(beforeArea)
  ) {
    return 'That change would flatten or turn the room inside out.'
  }

  for (let i = 0; i < after.length; i++) {
    const a = after[i]
    const b = after[(i + 1) % after.length]
    for (let j = i + 1; j < after.length; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === after.length - 1)
      if (adjacent) continue
      const c = after[j]
      const d = after[(j + 1) % after.length]
      if (segmentsMeet(a, b, c, d)) {
        return 'That change would make the room cross over itself.'
      }
    }
  }

  // Adjacent collinear walls may meet at their corner, but may not double back
  // over one another from it.
  for (let i = 0; i < after.length; i++) {
    const previous = after[(i - 1 + after.length) % after.length]
    const corner = after[i]
    const next = after[(i + 1) % after.length]
    if (Math.abs(turn(previous, corner, next)) > GEOMETRY_EPSILON) continue
    const intoPrevious = { x: previous.x - corner.x, y: previous.y - corner.y }
    const intoNext = { x: next.x - corner.x, y: next.y - corner.y }
    if (intoPrevious.x * intoNext.x + intoPrevious.y * intoNext.y > 0) {
      return 'That change would fold one wall back over another.'
    }
  }

  return null
}

/**
 * Set one wall's exact dimensions, keeping its first corner fixed and moving
 * its second. The next wall follows that shared corner, so the outline always
 * remains connected; changes that would stop it being a valid room are refused.
 */
export function editWallGeometry(
  points: Array<Point>,
  index: number,
  change: WallGeometryChange,
): WallGeometryResult {
  if (index < 0 || index >= points.length) {
    return { ok: false, error: 'This wall no longer exists.' }
  }

  const start = points[index]
  const endIndex = (index + 1) % points.length
  const end = points[endIndex]
  const currentLength = distance(start, end)
  const length = change.length ?? currentLength
  const angle = change.angle ?? angleBetween(start, end)
  if (!Number.isFinite(length) || !Number.isFinite(angle)) {
    return { ok: false, error: 'Enter a finite wall length and angle.' }
  }
  if (length < MIN_SIZE) {
    return { ok: false, error: `Walls must be at least ${MIN_SIZE} cm long.` }
  }

  const radians = (angle * Math.PI) / 180
  const nextEnd = {
    x: start.x + Math.cos(radians) * length,
    y: start.y + Math.sin(radians) * length,
  }
  const next = points.map((point, i) => (i === endIndex ? nextEnd : point))
  const issue = outlineIssue(points, next)
  return issue ? { ok: false, error: issue } : { ok: true, points: next }
}

/** Where the infinite lines through `a→b` and `c→d` cross, or null if parallel. */
function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-9) return null
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator
  return { x: a.x + r.x * t, y: a.y + r.y * t }
}

/** Unit vector across wall `index`, pointing out of the room. */
function wallNormal(points: Array<Point>, index: number): Point | null {
  const a = points[index]
  const b = points[(index + 1) % points.length]
  const span = distance(a, b)
  if (span === 0) return null
  const sign = outwardSign(points)
  return {
    x: ((b.y - a.y) / span) * sign,
    y: (-(b.x - a.x) / span) * sign,
  }
}

/**
 * The outline left by pushing one wall `by` centimetres along its own normal.
 *
 * The corners at its ends are not simply carried along with it: each is put
 * back where the wall's new line crosses the wall it shares that corner with,
 * so the walls either side keep the direction they were drawn at and give up
 * only length. One running parallel to the wall being pushed never meets it,
 * and its corner does travel along.
 */
function pushed(
  points: Array<Point>,
  index: number,
  by: number,
): Array<Point> | null {
  const count = points.length
  const normal = wallNormal(points, index)
  if (!normal) return null

  const a = points[index]
  const b = points[(index + 1) % count]
  const from = { x: a.x + normal.x * by, y: a.y + normal.y * by }
  const to = { x: b.x + normal.x * by, y: b.y + normal.y * by }

  const before = points[(index - 1 + count) % count]
  const after = points[(index + 2) % count]
  return points.map((p, i) => {
    if (i === index) return crossing(before, a, from, to) ?? from
    if (i === (index + 1) % count) return crossing(b, after, from, to) ?? to
    return p
  })
}

/** The vector along wall `index`, from its first corner to its second. */
function along(points: Array<Point>, index: number): Point {
  const a = points[index]
  const b = points[(index + 1) % points.length]
  return { x: b.x - a.x, y: b.y - a.y }
}

/**
 * How deep a room still is at one of its walls: how far back from that wall the
 * furthest of its other corners stands. This is the room's own measure of how
 * much of it there is left to push — the width of a rectangle taken from either
 * side, and the length of it taken from the other two.
 */
function depthAt(points: Array<Point>, index: number): number {
  const count = points.length
  const normal = wallNormal(points, index)
  if (!normal) return 0

  const a = points[index]
  let depth = 0
  for (let i = 0; i < count; i++) {
    if (i === index || i === (index + 1) % count) continue
    const back = -(
      (points[i].x - a.x) * normal.x +
      (points[i].y - a.y) * normal.y
    )
    depth = Math.max(depth, back)
  }
  return depth
}

/** What a length may not fall below: the floor, or wherever it already was. */
function floor(was: number): number {
  return Math.min(MIN_SIZE, was)
}

/**
 * Whether a push has left a room standing, which it can fail to do in three
 * ways.
 *
 * The outline can turn through itself, and the winding says so.
 *
 * The walls either side can be spent. They give up length as the wall is
 * pushed, and a push far enough takes one through nothing and out the other
 * side, back to front — which is how a room loses a whole leg while the rest of
 * it stands there looking perfectly well, so no measure of the outline as a
 * whole would catch it.
 *
 * And the room can be squashed flat against the wall being pushed, which is the
 * one that matters most: a room with no depth left at a wall is a line on the
 * plan, too thin to take hold of and beyond even the inspector to widen again,
 * so a push has to stop while there is still a room there to push.
 *
 * A room already below the floor — pulled in before this floor existed, or
 * drawn that way corner by corner — is held to what it has rather than to what
 * it ought to have. Otherwise the one move that could put it right would be the
 * move it is not allowed to make.
 */
function standing(
  before: Array<Point>,
  after: Array<Point>,
  index: number,
): boolean {
  const count = after.length
  if (outwardSign(after) !== outwardSign(before)) return false

  for (const wall of [(index - 1 + count) % count, (index + 1) % count]) {
    const was = along(before, wall)
    const now = along(after, wall)
    if (was.x * now.x + was.y * now.y <= 0) return false
    if (Math.hypot(now.x, now.y) < floor(Math.hypot(was.x, was.y))) return false
  }

  return depthAt(after, index) >= floor(depthAt(before, index))
}

/**
 * Push one side of a room out along its own normal, and hand back the outline
 * that leaves; a negative `by` pulls it in.
 *
 * This is what makes a room bigger without redrawing it. On a rectangle it
 * comes to the same thing as taking both corners of that side and moving them
 * together, because the walls either side stand square to the one being pushed.
 * On anything else it is the difference between pushing a wall out and shearing
 * the room.
 *
 * A push that would leave no room behind stops where the room runs out, rather
 * than flattening it or springing back to where it started: a wall shoved at
 * the far side of the room fetches up against it.
 */
export function slideWall(
  points: Array<Point>,
  index: number,
  by: number,
): Array<Point> {
  const wanted = pushed(points, index, by)
  if (!wanted) return points
  if (standing(points, wanted, index)) return wanted

  // Closing in on the furthest the wall can go: `good` is a push the room
  // survives and `bad` one it does not, and halving between them enough times
  // settles the wall within a fraction of a millimetre of the last push that
  // leaves a room standing.
  let good = 0
  let bad = by
  for (let i = 0; i < 16; i++) {
    const between = (good + bad) / 2
    const shape = pushed(points, index, between)
    if (shape && standing(points, shape, index)) good = between
    else bad = between
  }
  return pushed(points, index, good) ?? points
}

// --- furniture --------------------------------------------------------------

export function furnitureCentre(item: Furniture): Point {
  return { x: item.x, y: item.y }
}

/** World position of a handle on a possibly rotated item. */
export function handlePosition(item: Furniture, handle: Handle): Point {
  const dir = HANDLE_DIR[handle]
  const local = {
    x: item.x + (dir.x * item.w) / 2,
    y: item.y + (dir.y * item.h) / 2,
  }
  return rotatePoint(local, furnitureCentre(item), item.rotation)
}

export function furnitureCorners(item: Furniture): Array<Point> {
  return (['nw', 'ne', 'se', 'sw'] as const).map((h) => handlePosition(item, h))
}

export function furnitureBounds(item: Furniture): Rect {
  return polygonBounds(furnitureCorners(item))
}

/**
 * Resize a rotated item by dragging `handle` to `pointer`.
 *
 * The corner or edge opposite the handle is the anchor and must not move, so
 * the pointer is taken into the item's unrotated frame relative to that anchor,
 * the new size read off there, and the centre derived back from the anchor.
 */
export function resizeRotated(
  item: Furniture,
  handle: Handle,
  pointer: Point,
  step: number | null,
): Pick<Furniture, 'x' | 'y' | 'w' | 'h'> {
  const dir = HANDLE_DIR[handle]
  const centre = furnitureCentre(item)

  // The anchor sits opposite the handle and stays pinned in world space.
  const anchor = rotatePoint(
    {
      x: item.x - (dir.x * item.w) / 2,
      y: item.y - (dir.y * item.h) / 2,
    },
    centre,
    item.rotation,
  )

  // Pointer measured in the item's own frame, from the anchor.
  const local = rotatePoint(pointer, anchor, -item.rotation)
  const d = { x: local.x - anchor.x, y: local.y - anchor.y }

  const size = (delta: number, current: number, active: boolean) => {
    if (!active) return current
    const next =
      step === null ? Math.abs(delta) : snapValue(Math.abs(delta), step)
    return Math.max(MIN_SIZE, next)
  }

  const w = size(d.x, item.w, dir.x !== 0)
  const h = size(d.y, item.h, dir.y !== 0)

  const nextCentre = rotatePoint(
    { x: anchor.x + (dir.x * w) / 2, y: anchor.y + (dir.y * h) / 2 },
    anchor,
    item.rotation,
  )

  return { x: nextCentre.x, y: nextCentre.y, w, h }
}

/** Angle that puts the rotate handle (which sits above the item) under `pointer`. */
export function rotationFor(
  item: Furniture,
  pointer: Point,
  snapping: boolean,
): number {
  const deg =
    (Math.atan2(pointer.y - item.y, pointer.x - item.x) * 180) / Math.PI + 90
  return normalizeAngle(snapping ? snapValue(deg, SNAP_ANGLE) : deg)
}

// --- whole plan -------------------------------------------------------------

export function planBounds(
  rooms: Array<Room>,
  furniture: Array<Furniture>,
): Rect | null {
  const points = [
    ...rooms.flatMap((r) => r.points),
    ...furniture.flatMap(furnitureCorners),
  ]
  return points.length === 0 ? null : polygonBounds(points)
}

/** Viewport that fits `bounds` into a `width` x `height` viewport with padding. */
export function fitViewport(
  bounds: Rect,
  width: number,
  height: number,
  padding = 64,
): Viewport {
  const scale = clampScale(
    Math.min(
      (width - padding * 2) / Math.max(bounds.w, 1),
      (height - padding * 2) / Math.max(bounds.h, 1),
    ),
  )
  return {
    scale,
    tx: width / 2 - (bounds.x + bounds.w / 2) * scale,
    ty: height / 2 - (bounds.y + bounds.h / 2) * scale,
  }
}
