import { z } from 'zod'
import { interiorPoint, outwardSign } from './geometry.ts'

/** All world coordinates are centimetres; units.ts turns them into display text. */
export const SNAP_ANGLE = 15
export const MIN_SIZE = 5

export const MIN_SCALE = 0.1
export const MAX_SCALE = 5
export const DEFAULT_SCALE = 0.6

export const PointSchema = z.object({ x: z.number(), y: z.number() })

/** A canvas fill chosen by the reader. Kept strict so saved plans stay CSS-safe. */
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const ClosetAttachmentSchema = z.object({
  /** The wall run this closet is attached to. */
  runId: z.string(),
  wall: z.number().int().min(0),
  /** Centre of the closet, as a fraction along the host wall. */
  t: z.number().min(0).max(1),
})

/** Consecutive points are walls. There is never an implicit closing edge. */
export const WallRunSchema = z.object({
  id: z.string(),
  name: z.string(),
  points: z.array(PointSchema).min(2),
  kind: z.literal('closet').optional(),
  attachment: ClosetAttachmentSchema.optional(),
  locked: z.boolean().optional(),
})

/** Names and colours belong to the enclosed floor, independently of its walls. */
export const SpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: ColorSchema.optional(),
  /** A point that was inside this space when it was named. */
  seed: PointSchema,
})

export const FurnitureKindSchema = z.enum([
  'table',
  'sofa',
  'bed',
  'desk',
  'chair',
  'dresser',
  'tv',
  'kitchen',
  'appliance',
  'radiator',
  'column',
  'rug',
  'box',
])

export const FurnitureSchema = z.object({
  id: z.string(),
  kind: FurnitureKindSchema,
  name: z.string(),
  color: ColorSchema.optional(),
  /** Centre of the unrotated box, which keeps the rotation maths simple. */
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number(),
  /**
   * False for footprints that may sit under other objects, such as rugs.
   * Missing from older plans, where every item behaved as a solid object.
   */
  collides: z.boolean().optional(),
})

/** A reusable local footprint saved from one item in a plan. */
export const CustomFurniturePresetSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Enter a preset name.').max(80),
  kind: FurnitureKindSchema,
  w: z.number().min(MIN_SIZE),
  h: z.number().min(MIN_SIZE),
  collides: z.boolean(),
})

export const OpeningKindSchema = z.enum([
  'door',
  'double-door',
  'sliding-door',
  'window',
  'opening',
])

/**
 * A break in a wall: a door, a window, or a plain gap.
 *
 * An opening belongs to one segment of a wall run — the edge running from
 * `points[wall]` to the point after it — and holds its place along that wall as
 * a fraction of its length, so it stays where it was put when the wall is
 * resized or a corner is dragged. Its width, like every other length here, is
 * in centimetres.
 */
export const OpeningSchema = z.object({
  id: z.string(),
  kind: OpeningKindSchema,
  runId: z.string(),
  wall: z.number().int().min(0),
  /** Centre of the opening, as a fraction along its wall. */
  t: z.number().min(0).max(1),
  /** Clear width between the jambs. */
  width: z.number().positive(),
  /** The end of the wall a door is hinged at. */
  hinge: z.enum(['start', 'end']),
  /** The side of the wall a door swings towards. */
  swing: z.enum(['in', 'out']),
})

// Version 1 stored closed room polygons and open wall runs in the same array.
// This is the only place that understands that representation.
const LegacyRoomSchema = WallRunSchema.omit({ attachment: true })
  .extend({
    color: ColorSchema.optional(),
    closed: z.boolean().optional(),
    attachment: ClosetAttachmentSchema.omit({ runId: true })
      .extend({ roomId: z.string() })
      .optional(),
  })
  .refine((room) => room.closed === false || room.points.length >= 3)
const LegacyOpeningSchema = OpeningSchema.omit({ runId: true }).extend({
  roomId: z.string(),
})
const LegacyGeometrySchema = z.object({
  rooms: z.array(LegacyRoomSchema),
  openings: z.array(LegacyOpeningSchema).default([]),
  spaces: z.array(SpaceSchema).default([]),
})

function migrateLegacyPlan(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if ('walls' in record || !('rooms' in record)) return value
  if (record.version !== undefined && record.version !== 1) return value
  if (record.schemaVersion !== undefined && record.schemaVersion !== 1)
    return value
  const parsed = LegacyGeometrySchema.safeParse(value)
  if (!parsed.success) return value
  const { rooms, openings, spaces } = parsed.data
  const reversed = new Map(
    rooms.map((room) => [
      room.id,
      room.closed !== false && outwardSign(room.points) < 0,
    ]),
  )
  const attachment = (old: { roomId: string; wall: number; t: number }) => {
    const host = rooms.find((room) => room.id === old.roomId)
    return {
      runId: old.roomId,
      wall:
        reversed.get(old.roomId) && host
          ? host.points.length - 1 - old.wall
          : old.wall,
      t: reversed.get(old.roomId) ? 1 - old.t : old.t,
    }
  }
  return {
    ...record,
    ...(record.version === 1 ? { version: 2 } : {}),
    ...(record.schemaVersion === 1 ? { schemaVersion: 2 } : {}),
    walls: rooms.map((room, index) => {
      const points =
        room.closed === false
          ? room.points
          : reversed.get(room.id)
            ? [
                room.points[0],
                ...room.points.slice(1).reverse(),
                room.points[0],
              ]
            : [...room.points, room.points[0]]
      return {
        id: room.id,
        name:
          room.kind === 'closet' || room.closed === false
            ? room.name
            : `Walls ${index + 1}`,
        points,
        ...(room.kind ? { kind: room.kind } : {}),
        ...(room.locked === undefined ? {} : { locked: room.locked }),
        ...(room.attachment ? { attachment: attachment(room.attachment) } : {}),
      }
    }),
    openings: openings.map(({ roomId, ...opening }) => ({
      ...opening,
      ...attachment({ roomId, wall: opening.wall, t: opening.t }),
      hinge: reversed.get(roomId)
        ? opening.hinge === 'start'
          ? 'end'
          : 'start'
        : opening.hinge,
    })),
    spaces: [
      ...rooms
        .filter((room) => room.closed !== false)
        .map((room) => ({
          id: `room-label:${room.id}`,
          name: room.name,
          ...(room.color ? { color: room.color } : {}),
          seed: interiorPoint(room.points),
        })),
      ...spaces,
    ],
  }
}

const PlanGeometrySchema = z.object({
  walls: z.array(WallRunSchema),
  furniture: z.array(FurnitureSchema),
  openings: z.array(OpeningSchema).default([]),
  spaces: z.array(SpaceSchema).default([]),
})

export const PlanSchema = z.preprocess(
  migrateLegacyPlan,
  PlanGeometrySchema.extend({ version: z.literal(2) }),
)

/** A named plan. Preferences belong to the editor, not the plan. */
export const ProjectSchema = z.preprocess(
  migrateLegacyPlan,
  PlanGeometrySchema.extend({
    id: z.uuid().catch(() => crypto.randomUUID()),
    name: z.string(),
  }),
)

/**
 * Every project saved. Which one is open is not in here: that is what the URL
 * says, so a plan can be linked to and come back to on its own.
 */
export const LibrarySchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
})

/**
 * The library as this browser's storage holds it: every project, under a stamp
 * saying which tab wrote it and how many writes had gone before.
 *
 * The stamp is how a second tab tells a change it has not seen from an echo of
 * its own last write, and how it tells a newer copy from the one it already
 * has. Libraries written before tabs watched each other carry no stamp, and
 * read as revision zero, written by nobody — which is older than anything any
 * tab writes from here on, and so is never mistaken for news.
 */
export const StoredLibrarySchema = LibrarySchema.extend({
  writer: z.string().optional(),
  revision: z.number().int().nonnegative().optional(),
})

export const PROJECT_SCHEMA_VERSION = 2 as const

/** A plan name as it may leave the browser. */
export const ProjectNameSchema = z.string().trim().min(1, 'Enter a plan name.')

/**
 * A plan as it is written down outside this browser — one file per plan in a
 * GitHub repository.
 *
 * It is `ProjectSchema` with two differences, and both come of the file being
 * read back by somebody other than the editor that wrote it. It says which
 * schema it is, so a file can outlive the shape it was written in. And its id
 * is required to be a UUID rather than quietly replaced with one: a plan's id
 * is also its filename, and a reader that invents an id on the way in would
 * commit the same plan back under a second name.
 */
export const ProjectRecordSchema = z.preprocess(
  migrateLegacyPlan,
  z.object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: z.uuid(),
    name: ProjectNameSchema,
    walls: z.array(WallRunSchema),
    furniture: z.array(FurnitureSchema),
    openings: z.array(OpeningSchema),
    /** Missing from files written before walls alone could enclose a room. */
    spaces: z.array(SpaceSchema).default([]),
  }),
)

export const LIBRARY_BACKUP_SCHEMA_VERSION = 1 as const

/**
 * Every local plan in one portable file.
 *
 * This is deliberately not `StoredLibrarySchema`: a backup belongs to the
 * reader, not to the tab that happened to write localStorage last, so writer
 * and revision stamps never leave the browser. Each project stays in the same
 * strict external shape as a single-plan file, including its original UUID.
 */
export const LibraryBackupRecordSchema = z
  .object({
    schemaVersion: z.literal(LIBRARY_BACKUP_SCHEMA_VERSION),
    kind: z.literal('rmplnr-library'),
    projects: z.array(ProjectRecordSchema),
  })
  .superRefine((backup, context) => {
    const ids = new Set<string>()
    backup.projects.forEach((project, index) => {
      if (ids.has(project.id)) {
        context.addIssue({
          code: 'custom',
          path: ['projects', index, 'id'],
          message: 'Every plan in a library backup must have a unique ID.',
        })
      }
      ids.add(project.id)
    })
  })

// Keep the original values so existing preferences retain their display format.
export const UnitsSchema = z.enum([
  'metric',
  'metric-mixed',
  'imperial-inches',
  'imperial',
])

/** Editor preferences, stored apart from the plan they are viewed through. */
export const PrefsSchema = z.object({
  version: z.literal(1),
  units: UnitsSchema,
  /** Missing from preferences saved before furniture could get in the way. */
  collide: z.boolean().default(true),
  /** Missing from preferences saved before reusable furniture was available. */
  customFurniturePresets: z.array(CustomFurniturePresetSchema).default([]),
})

export type Point = z.infer<typeof PointSchema>
export type WallDraft =
  { start: Point } | { runId: string; end: 'start' | 'end' }
export type ClosetAttachment = z.infer<typeof ClosetAttachmentSchema>
export type WallRun = z.infer<typeof WallRunSchema>
export type Space = z.infer<typeof SpaceSchema>
export type FurnitureKind = z.infer<typeof FurnitureKindSchema>
export type Furniture = z.infer<typeof FurnitureSchema>
export type CustomFurniturePreset = z.infer<typeof CustomFurniturePresetSchema>
export type OpeningKind = z.infer<typeof OpeningKindSchema>
export type Opening = z.infer<typeof OpeningSchema>
export type Plan = z.infer<typeof PlanSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>
export type LibraryBackupRecord = z.infer<typeof LibraryBackupRecordSchema>
export type Library = z.infer<typeof LibrarySchema>
export type StoredLibrary = z.infer<typeof StoredLibrarySchema>
export type Units = z.infer<typeof UnitsSchema>
export type Prefs = z.infer<typeof PrefsSchema>

export type Rect = { x: number; y: number; w: number; h: number }

export type Selection =
  | {
      type: 'run' | 'furniture' | 'opening'
      id: string
    }
  | {
      /**
       * One of the spaces the walls close in that was never drawn as a room of
       * its own. Its `id` is the space's key from `enclosures.ts`, which is
       * made out of its corners — so moving one of its walls drops the
       * selection, there being nothing left that was selected.
       */
      type: 'enclosure'
      id: string
    }
  | {
      /** A wall segment, running from `points[index]` to the next corner. */
      type: 'wall'
      /** The run that contains the segment. */
      id: string
      index: number
    }
  | null

/**
 * The name being typed over on the plan itself. Only the things that carry a
 * name of their own are in here: an opening is called after its kind, and has
 * nothing to rename.
 */
export type Rename = {
  type: 'run' | 'furniture' | 'enclosure'
  id: string
} | null

/**
 * What a copy took: something lifted whole out of the plan, along with
 * whatever belongs to it. A room is not only its outline — the doors and
 * windows cut into it are part of what was copied, the same way deleting it
 * takes them down with it.
 *
 * Everything here is the thing itself rather than its id, so what was copied
 * outlives the original being changed, or deleted out from under it.
 */
export type Clipboard =
  | { type: 'run'; run: WallRun; openings: Array<Opening> }
  | { type: 'furniture'; item: Furniture }
  | { type: 'opening'; opening: Opening }

/**
 * A colour lifted off one piece of furniture to be put down on others, the way
 * a format painter carries one.
 *
 * It holds the colour itself rather than the item it came from, so it outlives
 * that item being recoloured or deleted — and `undefined` is a colour here too:
 * the default one, which paints a plain footprint back.
 *
 * `sticky` is the brush kept in hand rather than tapped once: it stays after
 * the first item it paints instead of being spent on it.
 */
export type StyleBrush = { color: string | undefined; sticky: boolean }

/**
 * What the pointer is for. `move` and `edit` both work on what is already on
 * the plan; the rest put something new down.
 */
export type Tool = 'move' | 'edit' | 'run' | 'rect' | 'opening' | 'closet'

/**
 * The two tools that take hold of what is already there.
 *
 * `move` carries things about and nothing else: a room, a piece of furniture
 * or a door goes where it is dragged and comes back the same size and at the
 * same angle it left. `edit` is the one that reshapes — corners, walls, the
 * resize handles, the rotate handle and the jambs of an opening are all its.
 *
 * The split is there because the two are wanted at different times. Laying a
 * plan out is a long stretch of dragging things around, and a resize handle
 * caught by mistake in the middle of it is a room silently made the wrong
 * size — so the handles are not on the canvas at all until they are asked for.
 */
export type PointerTool = Extract<Tool, 'move' | 'edit'>

/** Whether a tool takes hold of what is on the plan rather than drawing. */
export function isPointerTool(tool: Tool): tool is PointerTool {
  return tool === 'move' || tool === 'edit'
}

/** The two opposite corners of rectangular walls being drawn. */
export type RectDraft = { start: Point; end: Point }

/** screen = world * scale + (tx, ty) */
export type Viewport = { tx: number; ty: number; scale: number }

/**
 * Resize handles, named by the corner or edge they sit on. `nw` drags the
 * top-left, `n` drags the top edge, and so on, in the item's own frame.
 */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: Array<Handle> = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

/** Unit offsets from the centre, per handle, in the item's unrotated frame. */
export const HANDLE_DIR: Record<Handle, Point> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
}
