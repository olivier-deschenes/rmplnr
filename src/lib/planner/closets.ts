import { MIN_SIZE } from './types.ts'
import {
  clampT,
  fittedWidth,
  pointOnWall,
  projectT,
  wallAt,
  wallDistance,
} from './openings.ts'

import type { ClosetAttachment, Point, Room } from './types.ts'
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
export function closetSize(room: Room): { width: number; depth: number } {
  return {
    width: wallAt(room.points, 0)?.length ?? MIN_SIZE,
    depth: wallAt(room.points, 1)?.length ?? MIN_SIZE,
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
    points: [end, start, farStart, farEnd],
    width,
    depth,
  }
}

/** Put every closet back on its host wall after that room changes. */
export function reflowClosets(rooms: Array<Room>): Array<Room> {
  return rooms.map((room) => {
    if (room.kind !== 'closet' || !room.attachment) return room
    const host = rooms.find(
      (candidate) => candidate.id === room.attachment?.roomId,
    )
    const wall = host && wallAt(host.points, room.attachment.wall)
    if (!wall) return room
    const size = closetSize(room)
    const placed = placeCloset(wall, room.attachment, size.width, size.depth)
    return { ...room, points: placed.points, attachment: placed.attachment }
  })
}

/**
 * Adding or removing a host-room corner renumbers its walls. Read each closet
 * back onto whichever new wall passes nearest the old attachment point before
 * its outline is reflowed.
 */
export function reattachClosets(
  rooms: Array<Room>,
  hostId: string,
  before: Array<Point>,
  after: Array<Point>,
): Array<Room> {
  return rooms.map((room) => {
    const attachment = room.attachment
    if (room.kind !== 'closet' || attachment?.roomId !== hostId) return room
    const previous = wallAt(before, attachment.wall)
    if (!previous) return room
    const centre = pointOnWall(previous, attachment.t)

    let best: { wall: number; frame: Wall; distance: number } | null = null
    for (let wall = 0; wall < after.length; wall++) {
      const frame = wallAt(after, wall)
      if (!frame) continue
      const distance = wallDistance(frame, centre)
      if (!best || distance < best.distance) best = { wall, frame, distance }
    }
    if (!best) return room
    return {
      ...room,
      attachment: {
        ...attachment,
        wall: best.wall,
        t: projectT(best.frame, centre),
      },
    }
  })
}
