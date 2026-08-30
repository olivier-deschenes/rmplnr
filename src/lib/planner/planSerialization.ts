import { PROJECT_SCHEMA_VERSION, ProjectRecordSchema } from './types.ts'

import type {
  Furniture,
  Opening,
  Project,
  ProjectRecord,
  Room,
} from './types.ts'

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
    points: room.points.map((point) => ({ x: point.x, y: point.y })),
    ...(room.kind ? { kind: room.kind } : {}),
    ...(room.attachment
      ? {
          attachment: {
            roomId: room.attachment.roomId,
            wall: room.attachment.wall,
            t: room.attachment.t,
            openingId: room.attachment.openingId,
          },
        }
      : {}),
  }
}

function toCanonicalFurniture(item: Furniture): Furniture {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    rotation: item.rotation,
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
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    rooms: project.rooms.map(toCanonicalRoom),
    furniture: project.furniture.map(toCanonicalFurniture),
    openings: project.openings.map(toCanonicalOpening),
  }
}

/** A plan read back in, as the library holds them. */
export function fromProjectRecord(record: ProjectRecord): Project {
  return {
    id: record.id,
    name: record.name,
    rooms: record.rooms,
    furniture: record.furniture,
    openings: record.openings,
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

/**
 * Read one plan file. Throws with a reason rather than returning null: every
 * caller is reporting the bad file to the reader, and the reason is the report.
 */
export function parseProjectFile(contents: string): Project {
  const parsed: unknown = JSON.parse(contents)
  return fromProjectRecord(ProjectRecordSchema.parse(parsed))
}
