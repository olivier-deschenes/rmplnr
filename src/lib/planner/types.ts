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

export const PlanSchema = z.object({
  version: z.literal(1),
  rooms: z.array(RoomSchema),
  furniture: z.array(FurnitureSchema),
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
export type Plan = z.infer<typeof PlanSchema>
export type Units = z.infer<typeof UnitsSchema>
export type Prefs = z.infer<typeof PrefsSchema>

export type Rect = { x: number; y: number; w: number; h: number }

export type Selection = { type: 'room' | 'furniture'; id: string } | null

export type Tool = 'select' | 'room' | 'rect'

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
