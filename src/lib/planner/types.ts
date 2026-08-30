import { z } from 'zod'

/** All world coordinates are centimetres; units.ts turns them into display text. */
export const SNAP_ANGLE = 15
export const MIN_SIZE = 5

export const MIN_SCALE = 0.1
export const MAX_SCALE = 5
export const DEFAULT_SCALE = 0.6

export const PointSchema = z.object({ x: z.number(), y: z.number() })

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  points: z.array(PointSchema).min(3),
})

export const FurnitureKindSchema = z.enum(['table', 'sofa'])

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

export const UnitsSchema = z.enum(['metric', 'imperial'])

/** Editor preferences, stored apart from the plan they are viewed through. */
export const PrefsSchema = z.object({
  version: z.literal(1),
  units: UnitsSchema,
})

export type Point = z.infer<typeof PointSchema>
export type Room = z.infer<typeof RoomSchema>
export type FurnitureKind = z.infer<typeof FurnitureKindSchema>
export type Furniture = z.infer<typeof FurnitureSchema>
export type OpeningKind = z.infer<typeof OpeningKindSchema>
export type Opening = z.infer<typeof OpeningSchema>
export type Plan = z.infer<typeof PlanSchema>
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

export type Tool = 'select' | 'room' | 'rect' | 'opening'

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
