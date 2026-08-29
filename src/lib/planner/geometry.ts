import {
  HANDLE_DIR,
  MAX_SCALE,
  MIN_SCALE,
  MIN_SIZE,
  SNAP_ANGLE,
  SNAP_STEP,
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

export function snapValue(v: number, step = SNAP_STEP): number {
  return Math.round(v / step) * step
}

export function snapPoint(p: Point, step = SNAP_STEP): Point {
  return { x: snapValue(p.x, step), y: snapValue(p.y, step) }
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
  snapping: boolean,
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
    const next = snapping ? snapValue(Math.abs(delta)) : Math.abs(delta)
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
