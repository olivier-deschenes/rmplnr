import { describe, expect, it } from 'bun:test'

import { wallLabels } from './dimensions.ts'
import type { Opening, Point, Room, Units } from './types.ts'

const run = (id: string, points: Array<Point>): Room => ({
  id,
  name: id,
  points,
  closed: false,
})

const host = run('host', [
  { x: 0, y: 0 },
  { x: 600, y: 0 },
])
const branch = run('branch', [
  { x: 200, y: 0 },
  { x: 200, y: 200 },
])

function labels(
  rooms: Array<Room>,
  openings: Array<Opening> = [],
  units: Units = 'metric',
) {
  return wallLabels(
    rooms,
    [],
    openings,
    { tx: 100, ty: 100, scale: 1 },
    units,
    {
      width: 1200,
      height: 1200,
    },
  )
}

function hostLabels(
  rooms: Array<Room>,
  openings: Array<Opening> = [],
  units?: Units,
) {
  return labels(rooms, openings, units).filter(
    (label) => label.roomId === 'host',
  )
}

describe('wall junction dimensions', () => {
  it('labels both sides of a perpendicular attachment with distinct selectable labels', () => {
    const result = hostLabels([host, branch])
    expect(result.map((label) => label.text).sort()).toEqual([
      '200 cm',
      '400 cm',
    ])
    expect(new Set(result.map((label) => label.key)).size).toBe(2)
    expect(result.every((label) => label.wall === 0)).toBe(true)
    expect(result.find((label) => label.text === '200 cm')?.box.centre.x).toBe(
      200,
    )
    expect(result.find((label) => label.text === '400 cm')?.box.centre.x).toBe(
      500,
    )
  })

  it('splits multiple attachments, crossings and reversed wall directions', () => {
    const crossing = run('crossing', [
      { x: 450, y: -100 },
      { x: 450, y: 200 },
    ])
    for (const wall of [
      host,
      { ...host, points: [...host.points].reverse() },
    ]) {
      expect(
        hostLabels([wall, branch, crossing])
          .map((label) => label.text)
          .sort(),
      ).toEqual(['150 cm', '200 cm', '250 cm'])
    }
  })

  it('handles rotated geometry and keeps the selected unit format', () => {
    const rotated = [host, branch].map((room) => ({
      ...room,
      points: room.points.map(({ x, y }) => ({
        x: (x - y) / Math.SQRT2,
        y: (x + y) / Math.SQRT2,
      })),
    }))
    expect(
      hostLabels(rotated)
        .map((label) => label.text)
        .sort(),
    ).toEqual(['200 cm', '400 cm'])
    expect(
      hostLabels(rotated, [], 'imperial').every(
        (label) => !label.text.includes('cm'),
      ),
    ).toBe(true)
  })

  it('does not split for nearby walls, collinear overlaps or endpoint-only corners', () => {
    const nearby = {
      ...branch,
      points: [
        { x: 200, y: 2 },
        { x: 200, y: 200 },
      ],
    }
    const collinear = run('overlap', [
      { x: 100, y: 0 },
      { x: 300, y: 0 },
    ])
    const corner = run('corner', [
      { x: 600, y: 0 },
      { x: 600, y: 200 },
    ])
    expect(
      hostLabels([host, nearby, collinear, corner]).map((label) => label.text),
    ).toEqual(['600 cm'])
  })

  it('does not count an attachment removed by an opening', () => {
    const gap: Opening = {
      id: 'gap',
      kind: 'opening',
      roomId: 'branch',
      wall: 0,
      t: 0.25,
      width: 100,
      hinge: 'start',
      swing: 'in',
    }
    expect(
      hostLabels([host, branch], [gap]).map((label) => label.text),
    ).toEqual(['600 cm'])
  })

  it('keeps a door within a wall from creating extra wall dimensions', () => {
    const door: Opening = {
      id: 'door',
      kind: 'door',
      roomId: 'host',
      wall: 0,
      t: 0.75,
      width: 80,
      hinge: 'start',
      swing: 'in',
    }
    expect(
      hostLabels([host, branch], [door])
        .map((label) => label.text)
        .sort(),
    ).toEqual(['200 cm', '400 cm'])
  })

  it('deduplicates shared walls after splitting them at attachments', () => {
    const duplicate = {
      ...host,
      id: 'duplicate',
      points: [...host.points].reverse(),
    }
    const result = labels([host, duplicate, branch]).filter(
      (label) => label.roomId !== 'branch',
    )
    expect(result.map((label) => label.text).sort()).toEqual([
      '200 cm',
      '400 cm',
    ])
  })

  it('measures Plan 2’s bedroom and the wall below it separately', () => {
    const right = run('host', [
      { x: 187.05499999999995, y: -177.6775 },
      { x: 187.05499999999995, y: -847.4074999999999 },
    ])
    const partition = run('partition', [
      { x: -132.08000000000004, y: -529.4074999999999 },
      { x: 187.05499999999995, y: -529.4074999999999 },
    ])
    const result = wallLabels(
      [right, partition],
      [],
      [],
      { tx: 600, ty: 1000, scale: 1 },
      'metric',
      {
        width: 1200,
        height: 1200,
      },
    ).filter((label) => label.roomId === 'host')
    expect(result.map((label) => label.text).sort()).toEqual([
      '318 cm',
      '351.73 cm',
    ])
  })
})
