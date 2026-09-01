import { describe, expect, it } from 'bun:test'

import {
  fromProjectRecord,
  parseLibraryBackupFile,
  parseProjectFile,
  parseRmplnrFile,
  serializeLibraryBackup,
  serializeProject,
  serializeProjectRecord,
  toLibraryBackupRecord,
  toProjectRecord,
} from './planSerialization.ts'
import { hashProject } from '#/features/github/hash.ts'

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

  it('keeps underlay assets out of normal plan exports', () => {
    const withUnderlay = {
      ...plan(),
      underlay: { id: 'underlay-1', blob: new Blob(['large asset']) },
    } as Project

    expect(serializeProject(withUnderlay)).toBe(serializeProject(plan()))
    expect(serializeProject(withUnderlay)).not.toContain('underlay')
  })

  it('agrees with the record form, so a hash means the same on both sides', () => {
    expect(serializeProjectRecord(toProjectRecord(plan()))).toBe(
      serializeProject(plan()),
    )
  })

  it('preserves a closet and its independent door', () => {
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
      },
    }
    const door: Project['openings'][number] = {
      id: 'closet-door-1',
      kind: 'sliding-door',
      roomId: closet.id,
      wall: 0,
      t: 0.5,
      width: 160,
      hinge: 'start',
      swing: 'in',
    }
    const project = plan({
      rooms: [...plan().rooms, closet],
      openings: [...plan().openings, door],
    })

    expect(parseProjectFile(serializeProject(project))).toEqual(project)
  })

  it('preserves locked and explicitly unlocked rooms', () => {
    const project = plan({
      rooms: [
        { ...plan().rooms[0], locked: true },
        {
          ...plan().rooms[0],
          id: 'room-2',
          name: 'Kitchen',
          locked: false,
        },
      ],
    })

    expect(parseProjectFile(serializeProject(project))).toEqual(project)
  })

  it('changes the serialized content and hash for a lock-only change', async () => {
    const unlocked = plan()
    const locked = plan({
      rooms: [{ ...plan().rooms[0], locked: true }],
    })

    expect(serializeProject(locked)).not.toBe(serializeProject(unlocked))
    expect(await hashProject(locked)).not.toBe(await hashProject(unlocked))
  })

  it('trims a plan name into a file its own parser accepts', () => {
    const project = plan({ name: '  Flat  ' })
    const contents = serializeProject(project)

    expect(parseProjectFile(contents).name).toBe('Flat')
  })

  it('refuses to create an external file with a blank plan name', () => {
    expect(() => serializeProject(plan({ name: ' \n ' }))).toThrow(
      'Enter a plan name.',
    )
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

describe('library backups', () => {
  const other = plan({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'House',
    rooms: [{ ...plan().rooms[0], id: 'room-2', locked: true }],
  })

  it('round-trips every plan without changing its id', () => {
    const projects = [plan(), other]
    const contents = serializeLibraryBackup(projects)

    expect(parseLibraryBackupFile(contents)).toEqual({
      version: 1,
      projects,
    })
    expect(JSON.parse(contents)).toMatchObject({
      schemaVersion: 1,
      kind: 'rmplnr-library',
    })
  })

  it('trims names into a backup its own parser accepts', () => {
    const library = parseLibraryBackupFile(
      serializeLibraryBackup([plan({ name: '  Flat  ' })]),
    )

    expect(library.projects[0].name).toBe('Flat')
  })

  it('recognizes both kinds of rmplnr JSON', () => {
    expect(parseRmplnrFile(serializeProject(plan())).kind).toBe('project')
    expect(parseRmplnrFile(serializeLibraryBackup([plan()])).kind).toBe(
      'library',
    )
  })

  it('rejects the whole backup when any plan is invalid', () => {
    const backup = toLibraryBackupRecord([plan(), other])
    const invalid = JSON.parse(JSON.stringify(backup))
    invalid.projects[1].rooms[0].points = [{ x: 0, y: 0 }]

    expect(() => parseLibraryBackupFile(JSON.stringify(invalid))).toThrow(
      'projects.1.rooms.0.points',
    )
  })

  it('rejects duplicate plan ids in a backup', () => {
    const duplicate = {
      schemaVersion: 1,
      kind: 'rmplnr-library',
      projects: [toProjectRecord(plan()), toProjectRecord(plan())],
    }

    expect(() => parseLibraryBackupFile(JSON.stringify(duplicate))).toThrow(
      'unique ID',
    )
  })

  it('explains malformed JSON without exposing a parser exception', () => {
    expect(() => parseRmplnrFile('{')).toThrow('not valid JSON')
  })
})
