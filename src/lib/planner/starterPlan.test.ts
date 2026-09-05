import { describe, expect, it } from 'bun:test'

import { blockersFor, fits, overlaps } from './collision.ts'
import {
  furnitureCorners,
  pointInPolygon,
  polygonArea,
  rectPolygon,
} from './geometry.ts'
import { openingEnds, openingWall, projectAlong } from './openings.ts'
import { parseProjectFile, serializeProject } from './planSerialization.ts'
import { createStarterPlan } from './starterPlan.ts'
import { sharedWalls, wallGaps } from './walls.ts'

import type { Project } from './types.ts'

function ids(project: Project): Array<string> {
  return [
    project.id,
    ...project.rooms.map((room) => room.id),
    ...project.furniture.map((item) => item.id),
    ...project.openings.map((opening) => opening.id),
  ]
}

describe('starter plan', () => {
  it('creates independent plans that can be saved and imported', () => {
    const first = createStarterPlan()
    const second = createStarterPlan()
    const allIds = [...ids(first), ...ids(second)]

    expect(new Set(allIds).size).toBe(allIds.length)
    expect(parseProjectFile(serializeProject(first))).toEqual(first)
    first.rooms[0].points[0].x = 999
    first.furniture[0].name = 'Changed'
    expect(second.rooms[0].points[0].x).toBe(0)
    expect(second.furniture[0].name).toBe('Kitchen counter')
    expect(
      second.openings.every((opening) =>
        second.rooms.some((room) => room.id === opening.roomId),
      ),
    ).toBe(true)
  })

  it('has three locked rooms sharing walls without overlapping floor', () => {
    const { rooms } = createStarterPlan()

    expect(rooms).toHaveLength(3)
    expect(rooms.every((room) => room.locked)).toBe(true)
    expect(
      rooms.reduce((area, room) => area + polygonArea(room.points), 0),
    ).toBe(408_000)
    for (const [index, room] of rooms.entries()) {
      for (const other of rooms.slice(index + 1)) {
        expect(overlaps(room.points, other.points, 0)).toBe(false)
      }
      for (const [wall, point] of room.points.entries()) {
        const next = room.points[(wall + 1) % room.points.length]
        expect(point.x === next.x || point.y === next.y).toBe(true)
      }
      expect(
        room.points.some((_, wall) => sharedWalls(rooms, room.id, wall).length),
      ).toBe(true)
    }
  })

  it('keeps every measured footprint inside a room and clear of walls and furniture', () => {
    const { rooms, furniture, openings } = createStarterPlan()

    for (const item of furniture) {
      expect(
        rooms.some((room) =>
          furnitureCorners(item).every((point) =>
            pointInPolygon(point, room.points),
          ),
        ),
      ).toBe(true)
      expect(
        fits(item, blockersFor(rooms, furniture, openings, item.id), 0),
      ).toBe(true)
    }
  })

  it('provides one entrance and two interior doors with clear swings and shared gaps', () => {
    const { rooms, furniture, openings } = createStarterPlan()
    const doors = openings.filter((opening) => opening.kind === 'door')
    let entrances = 0
    let interiorDoors = 0

    for (const opening of openings) {
      const wall = openingWall(rooms, opening)!
      expect(wall).not.toBeNull()
      expect(opening.t * wall.length - opening.width / 2).toBeGreaterThan(0)
      expect(opening.t * wall.length + opening.width / 2).toBeLessThan(
        wall.length,
      )
    }

    for (const door of doors) {
      const wall = openingWall(rooms, door)!
      const ends = openingEnds(wall, door)
      const hinge = door.hinge === 'start' ? ends.start : ends.end
      const tip = door.hinge === 'start' ? ends.end : ends.start
      const direction = door.swing === 'in' ? -1 : 1
      // The full quarter-square conservatively contains the door's sweep.
      const sweep = rectPolygon(hinge, {
        x: tip.x + wall.normal.x * direction * door.width,
        y: tip.y + wall.normal.y * direction * door.width,
      })
      expect(
        furniture.every((item) => !overlaps(sweep, furnitureCorners(item), 0)),
      ).toBe(true)

      const shares = sharedWalls(rooms, door.roomId, door.wall)
      if (shares.length === 0) entrances++
      else interiorDoors++
      for (const share of shares) {
        const centre = projectAlong(share.frame, ends.centre)
        expect(
          wallGaps(rooms, openings, share.roomId, share.wall).some(
            ([start, end]) => start < centre && end > centre,
          ),
        ).toBe(true)
      }
    }

    expect(entrances).toBe(1)
    expect(interiorDoors).toBe(2)
  })
})
