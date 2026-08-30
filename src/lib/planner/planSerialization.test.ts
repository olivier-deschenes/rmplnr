import { describe, expect, it } from 'bun:test'

import {
  fromProjectRecord,
  parseProjectFile,
  serializeProject,
  serializeProjectRecord,
  toProjectRecord,
} from './planSerialization.ts'

import type { Project } from './types.ts'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'

function plan(overrides: Partial<Project> = {}): Project {
  return {
    id: PLAN_ID,
    name: 'Flat',
    rooms: [
      {
        id: 'room-1',
        name: 'Living',
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
        ],
      },
    ],
    furniture: [
      {
        id: 'sofa-1',
        kind: 'sofa',
        name: 'Sofa',
        x: 100,
        y: 100,
        w: 200,
        h: 90,
        rotation: 0,
      },
    ],
    openings: [
      {
        id: 'door-1',
        kind: 'door',
        roomId: 'room-1',
        wall: 0,
        t: 0.5,
        width: 80,
        hinge: 'start',
        swing: 'in',
      },
    ],
    ...overrides,
  }
}

describe('serializeProject', () => {
  it('round-trips a plan through the file format', () => {
    expect(parseProjectFile(serializeProject(plan()))).toEqual(plan())
  })

  it('ends the file with exactly one newline', () => {
    const contents = serializeProject(plan())
    expect(contents.endsWith('}\n')).toBe(true)
    expect(contents.endsWith('\n\n')).toBe(false)
  })

  it('writes the same bytes however the plan object was built', () => {
    const reordered: Project = {
      openings: plan().openings,
      furniture: plan().furniture,
      rooms: plan().rooms,
      name: plan().name,
      id: plan().id,
    }
    expect(serializeProject(reordered)).toBe(serializeProject(plan()))
  })

  it('ignores fields the editor does not save', () => {
    const strayField = { ...plan(), scale: 0.6 } as Project
    expect(serializeProject(strayField)).toBe(serializeProject(plan()))
  })

  it('agrees with the record form, so a hash means the same on both sides', () => {
    expect(serializeProjectRecord(toProjectRecord(plan()))).toBe(
      serializeProject(plan()),
    )
  })

  it('preserves a closet and its host-wall attachment', () => {
    const closet: Project['rooms'][number] = {
      id: 'closet-1',
      kind: 'closet',
      name: 'Closet',
      points: [
        { x: 290, y: 0 },
        { x: 110, y: 0 },
        { x: 110, y: -60 },
        { x: 290, y: -60 },
      ],
      attachment: {
        roomId: 'room-1',
        wall: 0,
        t: 0.5,
        openingId: 'closet-door-1',
      },
    }
    const project = plan({ rooms: [...plan().rooms, closet] })

    expect(parseProjectFile(serializeProject(project))).toEqual(project)
  })
})

describe('toProjectRecord', () => {
  it('stamps the schema version onto what leaves the browser', () => {
    expect(toProjectRecord(plan()).schemaVersion).toBe(1)
  })

  it('drops the schema version again on the way back in', () => {
    expect(fromProjectRecord(toProjectRecord(plan()))).toEqual(plan())
  })
})

describe('parseProjectFile', () => {
  it('rejects a file with no schema version', () => {
    const { schemaVersion: _dropped, ...rest } = toProjectRecord(plan())
    expect(() => parseProjectFile(JSON.stringify(rest))).toThrow()
  })

  it('rejects a plan whose id is not a UUID', () => {
    const record = { ...toProjectRecord(plan()), id: 'not-a-uuid' }
    expect(() => parseProjectFile(JSON.stringify(record))).toThrow()
  })

  it('rejects a room with fewer than three corners', () => {
    const record = toProjectRecord(plan())
    record.rooms[0].points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(() => parseProjectFile(JSON.stringify(record))).toThrow()
  })

  it('rejects text that is not JSON', () => {
    expect(() => parseProjectFile('{')).toThrow()
  })
})
