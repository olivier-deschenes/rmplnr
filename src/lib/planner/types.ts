import { z } from 'zod'

/** All world coordinates are centimetres; units.ts turns them into display text. */
export const SNAP_ANGLE = 15
export const MIN_SIZE = 5

export const MIN_SCALE = 0.1
export const MAX_SCALE = 5
export const DEFAULT_SCALE = 0.6

export const PointSchema = z.object({ x: z.number(), y: z.number() })

export const ClosetAttachmentSchema = z.object({
  /** The room whose outside face this closet sits against. */
  roomId: z.string(),
  wall: z.number().int().min(0),
  /** Centre of the closet, as a fraction along the host wall. */
  t: z.number().min(0).max(1),
})

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  points: z.array(PointSchema).min(3),
  /** Ordinary rooms omit this; closets carry their wall attachment below. */
  kind: z.literal('closet').optional(),
  attachment: ClosetAttachmentSchema.optional(),
})

export const FurnitureKindSchema = z.enum(['table', 'sofa', 'kitchen', 'box'])

export const FurnitureSchema = z.object({
  id: z.string(),
  kind: FurnitureKindSchema,
  name: z.string(),
  /** Centre of the unrotated box, which keeps the rotation maths simple. */
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number(),
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
 * An opening belongs to one wall of one room — the edge running from
 * `points[wall]` to the point after it — and holds its place along that wall as
 * a fraction of its length, so it stays where it was put when the room is
 * resized or a corner is dragged. Its width, like every other length here, is
 * in centimetres.
 */
export const OpeningSchema = z.object({
  id: z.string(),
  kind: OpeningKindSchema,
  roomId: z.string(),
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

export const PlanSchema = z.object({
  version: z.literal(1),
  rooms: z.array(RoomSchema),
  furniture: z.array(FurnitureSchema),
  /** Missing from plans saved before walls could be broken into. */
  openings: z.array(OpeningSchema).default([]),
})

/**
 * A plan under a name of its own.
 *
 * A project is the plan and nothing besides: units, snapping and the rest
 * belong to whoever is drawing rather than to any one plan, and stay in the
 * preferences, where switching from one project to another leaves them alone.
 */
export const ProjectSchema = PlanSchema.omit({ version: true }).extend({
  /**
   * A UUID, which is also the name the plan answers to in the URL. Anything
   * read back that is not one — a plan saved before they were — is given one
   * here rather than costing the reader the plan.
   */
  id: z.uuid().catch(() => crypto.randomUUID()),
  name: z.string(),
})

/**
 * Every project saved. Which one is open is not in here: that is what the URL
 * says, so a plan can be linked to and come back to on its own.
 */
export const LibrarySchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
})

export const PROJECT_SCHEMA_VERSION = 1 as const

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
export const ProjectRecordSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.uuid(),
  name: z.string().trim().min(1),
  rooms: z.array(RoomSchema),
  furniture: z.array(FurnitureSchema),
  openings: z.array(OpeningSchema),
})

export const UnitsSchema = z.enum(['metric', 'imperial'])

/** Editor preferences, stored apart from the plan they are viewed through. */
export const PrefsSchema = z.object({
  version: z.literal(1),
  units: UnitsSchema,
  /** Missing from preferences saved before furniture could get in the way. */
  collide: z.boolean().default(true),
})

export type Point = z.infer<typeof PointSchema>
export type ClosetAttachment = z.infer<typeof ClosetAttachmentSchema>
export type Room = z.infer<typeof RoomSchema>
export type FurnitureKind = z.infer<typeof FurnitureKindSchema>
export type Furniture = z.infer<typeof FurnitureSchema>
export type OpeningKind = z.infer<typeof OpeningKindSchema>
export type Opening = z.infer<typeof OpeningSchema>
export type Plan = z.infer<typeof PlanSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>
export type Library = z.infer<typeof LibrarySchema>
export type Units = z.infer<typeof UnitsSchema>
export type Prefs = z.infer<typeof PrefsSchema>

export type Rect = { x: number; y: number; w: number; h: number }

export type Selection = {
  type: 'room' | 'furniture' | 'opening'
  id: string
} | null

/**
 * The name being typed over on the plan itself. Only the things that carry a
 * name of their own are in here: an opening is called after its kind, and has
 * nothing to rename.
 */
export type Rename = { type: 'room' | 'furniture'; id: string } | null

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
  | { type: 'room'; room: Room; openings: Array<Opening> }
  | { type: 'furniture'; item: Furniture }
  | { type: 'opening'; opening: Opening }

export type Tool = 'select' | 'room' | 'rect' | 'opening' | 'closet'

/** The two opposite corners of a rectangle room being dragged out. */
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
