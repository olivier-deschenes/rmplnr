import type { FurnitureKind, OpeningKind } from './types.ts'

/** Default footprint in centimetres. Add new furniture kinds here. */
export const FURNITURE_PRESETS: Record<
  FurnitureKind,
  { label: string; w: number; h: number }
> = {
  table: { label: 'Table', w: 140, h: 80 },
  sofa: { label: 'Sofa', w: 200, h: 90 },
}

/** Footprint for a rectangle room dropped with a click instead of a drag. */
export const DEFAULT_ROOM = { w: 400, h: 300 }

export const FURNITURE_KINDS = Object.keys(
  FURNITURE_PRESETS,
) as Array<FurnitureKind>

/** Default clear width in centimetres. Add new kinds of opening here. */
export const OPENING_PRESETS: Record<
  OpeningKind,
  { label: string; width: number }
> = {
  door: { label: 'Door', width: 80 },
  'double-door': { label: 'Double door', width: 150 },
  'sliding-door': { label: 'Sliding door', width: 160 },
  window: { label: 'Window', width: 120 },
  opening: { label: 'Opening', width: 100 },
}

export const OPENING_KINDS = Object.keys(OPENING_PRESETS) as Array<OpeningKind>

/** The three the toolbar draws with; the rest are a menu away in the inspector. */
export const OPENING_TOOLS = [
  'door',
  'window',
  'opening',
] as const satisfies ReadonlyArray<OpeningKind>

/** Kinds hung on a hinge, which sweep an arc and can be hung from either end. */
export const HINGED_KINDS: Array<OpeningKind> = ['door', 'double-door']

/** Kinds that sit on one face of their wall, and so need to be told which. */
export const SIDED_KINDS: Array<OpeningKind> = [...HINGED_KINDS, 'sliding-door']
