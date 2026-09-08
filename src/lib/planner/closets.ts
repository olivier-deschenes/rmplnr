import { MIN_SIZE } from './types.ts'
import {
  clampT,
  fittedWidth,
  heldT,
  pointOnWall,
  projectT,
  runWallAt,
  wallAt,
  wallDistance,
} from './openings.ts'

import type { ClosetAttachment, Point, WallRun } from './types.ts'
import type { Wall } from './openings.ts'

/** A useful reach-in closet, in centimetres. */
export const DEFAULT_CLOSET = { width: 180, depth: 60 }

export type ClosetPlacement = {
  attachment: ClosetAttachment
  points: Array<Point>
  width: number
  depth: number
}

/** The width and depth carried by a closet's rectangular outline. */
export function closetSize(run: WallRun): { width: number; depth: number } {
  return {
    width: runWallAt(run, 0)?.length ?? MIN_SIZE,
    depth: runWallAt(run, 1)?.length ?? MIN_SIZE,
  }
}

/**
 * Build a closet against the outside of `wall`.
 *
 * Its first edge runs back along the host wall. That reverse direction is
 * important: it makes the strip beyond the host wall the closet's inside, so
 * a door set to open inward opens into the closet rather than into the room.
 */
export function placeCloset(
  wall: Wall,
  attachment: ClosetAttachment,
  wantedWidth: number,
  wantedDepth: number,
): ClosetPlacement {
  const width = fittedWidth(Math.max(MIN_SIZE, wantedWidth), wall.length)
  const depth = Math.max(MIN_SIZE, wantedDepth)
  const t = clampT(attachment.t, width, wall.length)
  const centre = pointOnWall(wall, t)
  const half = width / 2
  const start = {
    x: centre.x - wall.tangent.x * half,
    y: centre.y - wall.tangent.y * half,
  }
  const end = {
    x: centre.x + wall.tangent.x * half,
    y: centre.y + wall.tangent.y * half,
  }
  const farStart = {
    x: start.x + wall.normal.x * depth,
    y: start.y + wall.normal.y * depth,
  }
  const farEnd = {
    x: end.x + wall.normal.x * depth,
    y: end.y + wall.normal.y * depth,
  }

  return {
    attachment: { ...attachment, t },
    points: [end, start, farStart, farEnd, end],
    width,
    depth,
  }
}

/** Put every closet back on its host wall after that room changes. */
export function reflowClosets(walls: Array<WallRun>): Array<WallRun> {
  return walls.map((run) => {
    if (run.kind !== 'closet' || !run.attachment) return run
    const host = walls.find(
      (candidate) => candidate.id === run.attachment?.runId,
    )
    const wall = host && runWallAt(host, run.attachment.wall)
    if (!wall) return run
    const size = closetSize(run)
    const placed = placeCloset(wall, run.attachment, size.width, size.depth)
    return { ...run, points: placed.points, attachment: placed.attachment }
  })
}

/**
 * Hold every attached closet in place while its host wall is stretched, the
 * same way the openings cut into that wall are held: a room made wider grows
 * past its closet rather than dragging it along. `before` carries the corners
 * each reshaped host was drawn with; closets on rooms left alone, and on walls
 * that came through unstretched, are returned untouched.
 */
export function heldClosets(
  walls: Array<WallRun>,
  before: Map<string, Array<Point>>,
): Array<WallRun> {
  if (before.size === 0) return walls
  return walls.map((run) => {
    const attachment = run.kind === 'closet' ? run.attachment : undefined
    const was = attachment && before.get(attachment.runId)
    if (!attachment || !was) return run
    const host = walls.find((candidate) => candidate.id === attachment.runId)
    const previous = wallAt(was, attachment.wall)
    const now = host && runWallAt(host, attachment.wall)
    if (!previous || !now) return run
    const t = clampT(
      heldT(previous, now, attachment.t),
      closetSize(run).width,
      now.length,
    )
    return t === attachment.t
      ? run
      : { ...run, attachment: { ...attachment, t } }
  })
}

/**
 * Adding or removing a host-room corner renumbers its walls. Read each closet
 * back onto whichever new wall passes nearest the old attachment point before
 * its outline is reflowed.
 */
export function reattachClosets(
  walls: Array<WallRun>,
  hostId: string,
  before: Array<Point>,
  after: Array<Point>,
  closed = false,
): Array<WallRun> {
  return walls.map((run) => {
    const attachment = run.attachment
    if (run.kind !== 'closet' || attachment?.runId !== hostId) return run
    const previous = wallAt(before, attachment.wall, closed)
    if (!previous) return run
    const centre = pointOnWall(previous, attachment.t)

    let best: { wall: number; frame: Wall; distance: number } | null = null
    for (let wall = 0; wall < after.length; wall++) {
      const frame = wallAt(after, wall, closed)
      if (!frame) continue
      const distance = wallDistance(frame, centre)
      if (!best || distance < best.distance) best = { wall, frame, distance }
    }
    if (!best) return run
    return {
      ...run,
      attachment: {
        ...attachment,
        wall: best.wall,
        t: projectT(best.frame, centre),
      },
    }
  })
}
