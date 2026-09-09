import {
  distance,
  furnitureCorners,
  normalizeAngle,
  polygonBounds,
} from './geometry.ts'
import { runWallAt, wallSegments } from './openings.ts'
import { WALL_THICKNESS, wallGaps } from './walls.ts'

import type { Furniture, Opening, Point, Rect, WallRun } from './types.ts'

/**
 * Furniture takes up floor, and no two things can have the same floor.
 *
 * What stands in a table's way is the other furniture and the walls — the
 * walls themselves, not the rooms they enclose: a room is somewhere to put
 * things, and a doorway is a hole rather than a piece of wall, so a sideboard
 * goes through one the same way a person does. Nothing here stops a room being
 * moved or reshaped over the top of furniture, because rooms are drawn around
 * what is already there as often as the other way about.
 *
 * Everything in the way is a box, and a box is convex, so all of it is tested
 * the one way: two shapes that miss each other can always be told apart by a
 * line square to an edge of one of them, and a pair of boxes has only eight
 * such lines between them. Lengths are centimetres, as everywhere else.
 */

/**
 * How far two things may lap before one is held to be in the other's way.
 *
 * Half a millimetre, and it is there for one reason: something brought to rest
 * against a wall is touching it, and touching is a knife edge that rounding
 * can fall to either side of. Nothing is ever put down lapping at all — `REST`
 * is what a placement has to be clear of before it is settled on — so this
 * slack is all margin, and what it buys is that a table resting against a wall
 * is not read, a frame later, as having sunk into it.
 */
const TOUCH = 0.05

/** What a placement is settled on having: no part of anything else at all. */
const REST = 0

/**
 * How far apart, in centimetres, the plan is looked at along the way over.
 *
 * Where a move ends is not enough to go on: the far side of a wall is as empty
 * as the near side, so a table asked to cross one would arrive on the other
 * side having gone through it. So the way there is walked rather than jumped,
 * at a stride shorter than both the thickness of a wall and the smallest thing
 * that can be drawn — nothing can hide between one look and the next.
 */
const PROBE = 4

/** As many looks as any one journey is worth, however far it is asked to go. */
const PROBE_LIMIT = 512

/** How many times the last stride is halved to find where it really stops. */
const STEPS = 16

/** Something furniture cannot be pushed through, with its box for a first look. */
export type Blocker = { points: Array<Point>; bounds: Rect }

function blockerOf(points: Array<Point>): Blocker {
  return { points, bounds: polygonBounds(points) }
}

/** Where a shape starts and ends, measured along `axis`. */
export function spanAlong(points: Array<Point>, axis: Point): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

/** Whether a line square to one of `edges`' own sides keeps `a` and `b` apart. */
function parted(
  edges: Array<Point>,
  a: Array<Point>,
  b: Array<Point>,
  slack: number,
): boolean {
  for (let i = 0; i < edges.length; i++) {
    const p = edges[i]
    const q = edges[(i + 1) % edges.length]
    const length = distance(p, q)
    if (length === 0) continue
    const axis = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length }
    const [aMin, aMax] = spanAlong(a, axis)
    const [bMin, bMax] = spanAlong(b, axis)
    if (aMax - bMin <= slack || bMax - aMin <= slack) return true
  }
  return false
}

/** Whether two convex outlines share any floor worth speaking of. */
export function overlaps(
  a: Array<Point>,
  b: Array<Point>,
  slack = TOUCH,
): boolean {
  return !parted(a, a, b, slack) && !parted(b, a, b, slack)
}

/** The cheap first look: two boxes that miss cannot possibly overlap. */
function boxesApart(a: Rect, b: Rect, slack: number): boolean {
  return (
    a.x + a.w - b.x <= slack ||
    b.x + b.w - a.x <= slack ||
    a.y + a.h - b.y <= slack ||
    b.y + b.h - a.y <= slack
  )
}

/** Whether an outline has the floor it stands on to itself. */
export function standsClear(
  points: Array<Point>,
  blockers: Array<Blocker>,
  slack = TOUCH,
): boolean {
  const bounds = polygonBounds(points)
  for (const blocker of blockers) {
    if (boxesApart(bounds, blocker.bounds, slack)) continue
    if (overlaps(points, blocker.points, slack)) return false
  }
  return true
}

export function fits(
  item: Furniture,
  blockers: Array<Blocker>,
  slack = TOUCH,
): boolean {
  return standsClear(furnitureCorners(item), blockers, slack)
}

// --- what is in the way -----------------------------------------------------

/** A stretch of wall as the box it fills: its thickness, about its own line. */
export function wallBox(a: Point, b: Point): Array<Point> | null {
  const length = distance(a, b)
  if (length === 0) return null
  const half = WALL_THICKNESS / 2
  const across = {
    x: (-(b.y - a.y) / length) * half,
    y: ((b.x - a.x) / length) * half,
  }
  return [
    { x: a.x + across.x, y: a.y + across.y },
    { x: b.x + across.x, y: b.y + across.y },
    { x: b.x - across.x, y: b.y - across.y },
    { x: a.x - across.x, y: a.y - across.y },
  ]
}

/**
 * Every piece of wall still standing, room by room. The openings come out of
 * them the same way they come out of the drawing, so what stops a wardrobe is
 * exactly what a person would walk into.
 */
function wallBlockers(
  walls: Array<WallRun>,
  openings: Array<Opening>,
): Array<Blocker> {
  const blockers: Array<Blocker> = []
  for (const run of walls) {
    for (let i = 0; i < run.points.length; i++) {
      const wall = runWallAt(run, i)
      if (!wall) continue
      for (const [a, b] of wallSegments(
        wall,
        wallGaps(walls, openings, run.id, i),
      )) {
        const box = wallBox(a, b)
        if (box) blockers.push(blockerOf(box))
      }
    }
  }
  return blockers
}

/**
 * Everything one piece of furniture has to keep out of: the walls, and the
 * rest of the solid furniture. `exclude` is the item being moved, which cannot
 * be in its own way. Soft footprints such as rugs are deliberately absent, so
 * a table can stand on one while both remain independently editable.
 */
export function blockersFor(
  walls: Array<WallRun>,
  furniture: Array<Furniture>,
  openings: Array<Opening>,
  exclude?: string,
): Array<Blocker> {
  return [
    ...wallBlockers(walls, openings),
    ...furniture
      .filter((item) => item.id !== exclude && item.collides !== false)
      .map((item) => blockerOf(furnitureCorners(item))),
  ]
}

// --- getting as far as it can -----------------------------------------------

/** The shorter way round from one angle to another, in degrees. */
function turn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/**
 * The placement `k` of the way from one to the other, 0 at the first and 1 at
 * the second. Centre, size and angle all travel together, which is what keeps
 * a part-way resize turning about the same corner the whole one would have.
 */
function between(from: Furniture, to: Furniture, k: number): Furniture {
  return {
    ...to,
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    w: from.w + (to.w - from.w) * k,
    h: from.h + (to.h - from.h) * k,
    rotation: normalizeAngle(
      from.rotation + turn(from.rotation, to.rotation) * k,
    ),
  }
}

function at(item: Furniture, x: number, y: number): Furniture {
  return { ...item, x, y }
}

/**
 * How far the furthest part of the item travels on the way over: what the
 * centre itself covers, the arc a corner swings through if it turns, and what
 * it gains if it grows. An overestimate only makes the walk more careful.
 */
function travelled(from: Furniture, to: Furniture): number {
  const radius = Math.hypot(Math.max(from.w, to.w), Math.max(from.h, to.h)) / 2
  const turned = (Math.abs(turn(from.rotation, to.rotation)) * Math.PI) / 180
  const grew = Math.max(Math.abs(to.w - from.w), Math.abs(to.h - from.h)) / 2
  return distance(from, to) + radius * turned + grew
}

/**
 * How far towards `to` the item gets before it fetches up against something.
 *
 * The way there is walked in strides short enough that nothing can be stepped
 * over, and where a stride runs into something the ground between it and the
 * one before is halved until the two are a fraction of a millimetre apart —
 * which leaves the item resting against whatever stopped it rather than a
 * stride short of it.
 *
 * `from` has to be somewhere it fits, which is the invariant the store keeps
 * by never letting anything be anywhere else.
 */
function furthest(
  from: Furniture,
  to: Furniture,
  blockers: Array<Blocker>,
): Furniture {
  const strides = Math.min(
    PROBE_LIMIT,
    Math.max(1, Math.ceil(travelled(from, to) / PROBE)),
  )

  let good = 0
  for (let i = 1; i <= strides; i++) {
    const k = i / strides
    if (fits(between(from, to, k), blockers, REST)) {
      good = k
      continue
    }
    let bad = k
    for (let j = 0; j < STEPS; j++) {
      const half = (good + bad) / 2
      if (fits(between(from, to, half), blockers, REST)) good = half
      else bad = half
    }
    return between(from, to, good)
  }
  return to
}

/**
 * A move, taken one direction at a time.
 *
 * Something dragged along a wall is being asked, frame after frame, to go both
 * onward and slightly into the wall, and a move refused whole would stop dead
 * the moment it touched. So the two directions are tried in turn: the part of
 * the move the wall has nothing to say about goes through, and only the part
 * pushing into it is cut short. Which of the two goes first decides the answer
 * at a corner, so both orders are tried and whichever ends up nearer to where
 * the pointer asked for wins.
 */
function slide(
  from: Furniture,
  to: Furniture,
  blockers: Array<Blocker>,
): Furniture {
  const straight = furthest(from, to, blockers)
  if (straight.x === to.x && straight.y === to.y) return straight

  const acrossFirst = (() => {
    const step = furthest(from, at(from, to.x, from.y), blockers)
    return furthest(step, at(step, step.x, to.y), blockers)
  })()
  const downFirst = (() => {
    const step = furthest(from, at(from, from.x, to.y), blockers)
    return furthest(step, at(step, to.x, step.y), blockers)
  })()

  const best =
    distance(acrossFirst, to) <= distance(downFirst, to)
      ? acrossFirst
      : downFirst
  return distance(best, to) <= distance(straight, to) ? best : straight
}

/**
 * Where a piece of furniture really ends up, having been asked to move, grow
 * or turn: as near to what was asked as it can stand without ending up inside
 * something else.
 *
 * An item already inside something — a plan drawn before any of this, or a
 * room pushed over the top of it — is let through untouched. Holding it to the
 * rule would only wall it in, since the one move that could put it right is the
 * move it would not be allowed to make. That is asked at `REST` rather than at
 * `TOUCH`, because it is what the walk below assumes about where it sets off
 * from: somewhere already lapping is somewhere the walk could not leave.
 */
export function settleFurniture(
  from: Furniture,
  to: Furniture,
  blockers: Array<Blocker>,
): Furniture {
  if (!fits(from, blockers, REST)) return to
  const turned = from.rotation !== to.rotation
  const resized = from.w !== to.w || from.h !== to.h
  return turned || resized
    ? furthest(from, to, blockers)
    : slide(from, to, blockers)
}

/**
 * Settle only the end of a free pointer drag. Starting at the occupied drop
 * point, look back along the drag for the nearest clear placement, then move
 * forward from there until the item rests against what it was dropped on.
 * Obstacles crossed earlier in the drag therefore do not affect the result.
 */
export function settleFurnitureDrop(
  from: Furniture,
  to: Furniture,
  blockers: Array<Blocker>,
): Furniture {
  if (fits(to, blockers, REST)) return to
  const strides = Math.min(
    PROBE_LIMIT,
    Math.max(1, Math.ceil(travelled(from, to) / PROBE)),
  )
  for (let i = 1; i <= strides; i++) {
    const clear = between(from, to, 1 - i / strides)
    if (fits(clear, blockers, REST)) return furthest(clear, to, blockers)
  }
  return to
}
