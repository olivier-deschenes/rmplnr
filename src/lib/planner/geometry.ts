import {
  HANDLE_DIR,
  MAX_SCALE,
  MIN_SCALE,
  MIN_SIZE,
  SNAP_ANGLE,
} from './types.ts'

import type {
  Furniture,
  Handle,
  Point,
  Rect,
  WallRun,
  Viewport,
} from './types.ts'

export function worldToScreen(p: Point, vp: Viewport): Point {
  return { x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty }
}

export function screenToWorld(p: Point, vp: Viewport): Point {
  return { x: (p.x - vp.tx) / vp.scale, y: (p.y - vp.ty) / vp.scale }
}

/** Explicitly draw the last wall of a loop. */
export function closeWallPoints(points: Array<Point>): Array<Point> {
  if (
    points.length < 3 ||
    distance(points[0], points[points.length - 1]) < 1e-6
  )
    return points
  return [...points, { ...points[0] }]
}

/** A joined run whose last endpoint meets its first. */
export function loopsBack(points: Array<Point>): boolean {
  return (
    points.length > 3 && distance(points[0], points[points.length - 1]) < 1e-6
  )
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

/**
 * What a ring encloses once every one of its edges has moved `by` centimetres
 * towards the inside, with the corners mitred the way the walls are drawn.
 *
 * The answer is `A − P·by + by²·Σtan(φ/2)`, where `φ` is the turn taken at each
 * corner: every edge gives up a strip of its own length, and each corner then
 * hands back the wedge two neighbouring strips would otherwise have counted
 * twice — or, where the ring turns back on itself, takes away the gap they left
 * between them instead. That is exact for any ring whose offset does not fold
 * through itself, and it needs no offset ring to be built to measure.
 *
 * A negative `by` moves the edges outwards, which is what a hole in a floor
 * does to the floor around it: the wall closing the hole in stands on the
 * floor, so the floor loses the hole and the wall around it both.
 */
export function offsetArea(points: Array<Point>, by: number): number {
  // A run closed by writing its first corner down again ends on an edge of no
  // length. That is the same ring with the same mitres, but an edge going
  // nowhere has no direction to turn from, so it is dropped before any of the
  // corners are read.
  const closed = points.filter((at, i) => {
    const before = points[(i + points.length - 1) % points.length]
    return Math.abs(at.x - before.x) > 1e-9 || Math.abs(at.y - before.y) > 1e-9
  })
  if (closed.length < 3) return 0

  // Wound one way, so a left turn is a corner the ring closes around whichever
  // way round its corners were first written down.
  let sum = 0
  for (let i = 0; i < closed.length; i++) {
    const a = closed[i]
    const b = closed[(i + 1) % closed.length]
    sum += a.x * b.y - b.x * a.y
  }
  const ring = sum >= 0 ? closed : [...closed].reverse()

  let perimeter = 0
  let corners = 0
  for (let i = 0; i < ring.length; i++) {
    const from = ring[(i + ring.length - 1) % ring.length]
    const at = ring[i]
    const to = ring[(i + 1) % ring.length]
    const into = { x: at.x - from.x, y: at.y - from.y }
    const out = { x: to.x - at.x, y: to.y - at.y }
    perimeter += Math.hypot(out.x, out.y)

    const cornerTurn = Math.atan2(
      into.x * out.y - into.y * out.x,
      into.x * out.x + into.y * out.y,
    )
    // A ring that doubles straight back on itself has a spike, not a corner:
    // it encloses nothing, and its mitre would run off to infinity.
    if (Math.abs(cornerTurn) < Math.PI - 1e-9) {
      corners += Math.tan(cornerTurn / 2)
    }
  }

  // Each step inwards shortens the ring by `2·corners`, so `perimeter` is what
  // is left of it at `by` and the moment that reaches nothing the ring has
  // closed on itself. The reading beyond there is a parabola turning back up,
  // not a floor, so a room narrower than the walls around it has none.
  if (by > 0 && perimeter - 2 * by * corners <= 0) return 0

  return Math.max(0, polygonArea(ring) - perimeter * by + by * by * corners)
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
 * A point that is certainly inside a polygon, and near the middle of it.
 *
 * The centroid is the natural place to write a name or to hang a marker, but a
 * room bent round a corner can have its centroid out in the garden. Where that
 * happens the point is pulled back onto the widest stretch of the polygon that
 * the centroid's own line of latitude crosses — always indoors, and still as
 * close to the middle as an L-shaped room allows.
 */
export function interiorPoint(points: Array<Point>): Point {
  const centre = polygonCentroid(points)
  if (pointInPolygon(centre, points)) return centre

  // Every place the polygon's edges cross the line through the centroid, in
  // order, so that the gaps between consecutive pairs are its inside.
  const crossings: Array<number> = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a.y > centre.y === b.y > centre.y) continue
    crossings.push(a.x + ((b.x - a.x) * (centre.y - a.y)) / (b.y - a.y))
  }
  crossings.sort((one, other) => one - other)

  let best: Point | null = null
  let widest = 0
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const span = crossings[i + 1] - crossings[i]
    if (span <= widest) continue
    widest = span
    best = { x: (crossings[i] + crossings[i + 1]) / 2, y: centre.y }
  }
  return best ?? centre
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

/** A new wall needs finite endpoints, enough length, and no immediate backtracking. */
export function drawnWallIssue(points: Array<Point>): string | null {
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return 'Enter finite wall coordinates.'
  }
  for (let i = 0; i + 1 < points.length; i++) {
    if (distance(points[i], points[i + 1]) < MIN_SIZE - GEOMETRY_EPSILON) {
      return `Walls must be at least ${MIN_SIZE} cm long.`
    }
  }
  if (points.length < 3) return null

  const [previous, corner, next] = points.slice(-3)
  if (Math.abs(turn(previous, corner, next)) > GEOMETRY_EPSILON) return null
  const back = { x: previous.x - corner.x, y: previous.y - corner.y }
  const on = { x: next.x - corner.x, y: next.y - corner.y }
  return back.x * on.x + back.y * on.y > 0
    ? 'That would lay a wall straight back over the one before it.'
    : null
}

/** Wall edits may cross other walls, but must keep every segment usable. */
export function wallRunIssue(points: Array<Point>): string | null {
  const measured = drawnWallIssue(points)
  if (measured) return measured
  const last = points.length - 1
  for (let i = loopsBack(points) ? 0 : 1; i < last; i++) {
    const previous = points[i === 0 ? last - 1 : i - 1]
    const corner = points[i]
    const next = points[i + 1]
    if (Math.abs(turn(previous, corner, next)) > GEOMETRY_EPSILON) continue
    if (
      (previous.x - corner.x) * (next.x - corner.x) +
        (previous.y - corner.y) * (next.y - corner.y) >
      0
    )
      return 'That would lay a wall straight back over the one before it.'
  }
  return null
}

/**
 * Set one wall's exact dimensions, keeping its first corner fixed and moving
 * its second. The next wall follows that shared corner, so the outline always
 * remains connected. Walls may cross, but may not collapse or double back.
 */
export function editWallGeometry(
  points: Array<Point>,
  index: number,
  change: WallGeometryChange,
): WallGeometryResult {
  if (index < 0 || index >= points.length - 1) {
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
  const next = points.map((point, i) =>
    i === endIndex ||
    (loopsBack(points) && endIndex === points.length - 1 && i === 0)
      ? nextEnd
      : point,
  )
  const issue = wallRunIssue(next)
  return issue ? { ok: false, error: issue } : { ok: true, points: next }
}

/** Slide a wall along its normal, carrying its joined endpoints with it. */
export function slideWall(
  points: Array<Point>,
  index: number,
  by: number,
): Array<Point> {
  if (index < 0 || index + 1 >= points.length) return points
  const a = points[index],
    b = points[index + 1]
  const length = distance(a, b)
  if (length === 0) return points
  const moved = points.map((point, i) =>
    i === index ||
    i === index + 1 ||
    distance(point, a) < 1e-6 ||
    distance(point, b) < 1e-6
      ? {
          x: point.x + ((b.y - a.y) / length) * by,
          y: point.y - ((b.x - a.x) / length) * by,
        }
      : point,
  )
  return wallRunIssue(moved) ? points : moved
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
  walls: Array<WallRun>,
  furniture: Array<Furniture>,
): Rect | null {
  const points = [
    ...walls.flatMap((r) => r.points),
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
