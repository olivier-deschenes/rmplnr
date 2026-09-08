import {
  LIBRARY_BACKUP_SCHEMA_VERSION,
  LibraryBackupRecordSchema,
  PROJECT_SCHEMA_VERSION,
  ProjectRecordSchema,
} from './types.ts'

import type {
  Furniture,
  Library,
  LibraryBackupRecord,
  Opening,
  Project,
  ProjectRecord,
  Room,
  Space,
} from './types.ts'

export type ParsedRmplnrFile =
  { kind: 'project'; project: Project } | { kind: 'library'; library: Library }

/** A file the reader can fix, rather than an internal parser failure. */
export class RmplnrFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RmplnrFileError'
  }
}

/**
 * The one JSON shape a plan is written down in — by GitHub, and by the hashes
 * that decide whether two copies of a plan are the same one.
 *
 * Every field is spelled out below rather than spread, and in a fixed order,
 * so that the text of the file is a function of the plan alone. A plan that
 * picked up a field the editor does not save, by whatever route, does not get
 * to change the file; and two plans that draw the same rooms hash the same,
 * which is what lets the sync say "nothing changed" rather than committing
 * noise. Array order is kept: it is the order things were drawn in, and the
 * order they are drawn back in.
 */
function toCanonicalRoom(room: Room): Room {
  return {
    id: room.id,
    name: room.name,
    ...(room.color ? { color: room.color } : {}),
    points: room.points.map((point) => ({ x: point.x, y: point.y })),
    ...(room.closed === false ? { closed: false } : {}),
    ...(room.kind ? { kind: room.kind } : {}),
    ...(room.attachment
      ? {
          attachment: {
            roomId: room.attachment.roomId,
            wall: room.attachment.wall,
            t: room.attachment.t,
          },
        }
      : {}),
    ...(room.locked === undefined ? {} : { locked: room.locked }),
  }
}

function toCanonicalSpace(space: Space): Space {
  return {
    id: space.id,
    name: space.name,
    ...(space.color ? { color: space.color } : {}),
    seed: { x: space.seed.x, y: space.seed.y },
  }
}

function toCanonicalFurniture(item: Furniture): Furniture {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    ...(item.color ? { color: item.color } : {}),
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    rotation: item.rotation,
    ...(item.collides === undefined ? {} : { collides: item.collides }),
  }
}

function toCanonicalOpening(opening: Opening): Opening {
  return {
    id: opening.id,
    kind: opening.kind,
    roomId: opening.roomId,
    wall: opening.wall,
    t: opening.t,
    width: opening.width,
    hinge: opening.hinge,
    swing: opening.swing,
  }
}

/** A plan in the shape it leaves the browser in. */
export function toProjectRecord(project: Project): ProjectRecord {
  return ProjectRecordSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    rooms: project.rooms.map(toCanonicalRoom),
    furniture: project.furniture.map(toCanonicalFurniture),
    openings: project.openings.map(toCanonicalOpening),
    spaces: project.spaces.map(toCanonicalSpace),
  })
}

/** A plan read back in, as the library holds them. */
export function fromProjectRecord(record: ProjectRecord): Project {
  return {
    id: record.id,
    name: record.name,
    rooms: record.rooms,
    furniture: record.furniture,
    openings: record.openings,
    spaces: record.spaces,
  }
}

/** Pretty-printed canonical plan JSON with exactly one trailing newline. */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(toProjectRecord(project), null, 2)}\n`
}

/**
 * The same file, from a record that has already been over the wire. It goes
 * back through `serializeProject` rather than stringifying what it was handed,
 * so that a record and the plan inside it can never serialize differently —
 * which is the whole basis on which a content hash means anything.
 */
export function serializeProjectRecord(record: ProjectRecord): string {
  return serializeProject(fromProjectRecord(record))
}

/** Every plan in the strict shape used by a portable library backup. */
export function toLibraryBackupRecord(
  projects: Array<Project>,
): LibraryBackupRecord {
  return LibraryBackupRecordSchema.parse({
    schemaVersion: LIBRARY_BACKUP_SCHEMA_VERSION,
    kind: 'rmplnr-library',
    projects: projects.map(toProjectRecord),
  })
}

/** Drop the external version markers while keeping every plan UUID intact. */
export function fromLibraryBackupRecord(backup: LibraryBackupRecord): Library {
  return {
    version: 1,
    projects: backup.projects.map(fromProjectRecord),
  }
}

/** Pretty-printed library JSON with exactly one trailing newline. */
export function serializeLibraryBackup(projects: Array<Project>): string {
  return `${JSON.stringify(toLibraryBackupRecord(projects), null, 2)}\n`
}

function jsonValue(contents: string): unknown {
  try {
    return JSON.parse(contents)
  } catch {
    throw new RmplnrFileError('This file is not valid JSON.')
  }
}

type ValidationError = {
  issues: Array<{ path: Array<PropertyKey>; message: string }>
}

/** The first concrete place a strict schema found fault with a file. */
function validationDetail(error: ValidationError): string {
  const issue = error.issues[0]
  const path = issue.path.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

function projectFrom(value: unknown): Project {
  const parsed = ProjectRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new RmplnrFileError(
      `This is not a valid rmplnr plan. ${validationDetail(parsed.error)}`,
    )
  }
  return fromProjectRecord(parsed.data)
}

function libraryFrom(value: unknown): Library {
  const parsed = LibraryBackupRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new RmplnrFileError(
      `This is not a valid rmplnr library backup. ${validationDetail(parsed.error)}`,
    )
  }
  return fromLibraryBackupRecord(parsed.data)
}

/**
 * Read one plan file. Throws with a reason rather than returning null: every
 * caller is reporting the bad file to the reader, and the reason is the report.
 */
export function parseProjectFile(contents: string): Project {
  return projectFrom(jsonValue(contents))
}

/** Read a full-library backup and validate every plan before returning any. */
export function parseLibraryBackupFile(contents: string): Library {
  return libraryFrom(jsonValue(contents))
}

/**
 * Read either kind of JSON rmplnr writes. The outer library marker decides
 * which strict schema applies; no state changes until the whole file passes.
 */
export function parseRmplnrFile(contents: string): ParsedRmplnrFile {
  const value = jsonValue(contents)
  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null
  const isLibrary =
    record?.kind === 'rmplnr-library' || Array.isArray(record?.projects)

  return isLibrary
    ? { kind: 'library', library: libraryFrom(value) }
    : { kind: 'project', project: projectFrom(value) }
}
