import type { FurnitureKind, OpeningKind } from './types.ts'

export const FURNITURE_CATEGORIES = [
  'seating',
  'sleeping',
  'tables',
  'storage',
  'media',
  'kitchen',
  'fixtures',
  'decor',
  'other',
] as const

export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number]

export const FURNITURE_CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  seating: 'Seating',
  sleeping: 'Sleeping',
  tables: 'Tables and desks',
  storage: 'Storage',
  media: 'Media',
  kitchen: 'Kitchen and appliances',
  fixtures: 'Fixtures',
  decor: 'Decor',
  other: 'Other',
}

export type FurniturePreset = {
  label: string
  /** Dimensionally accurate footprint in centimetres. */
  w: number
  h: number
  category: FurnitureCategory
  /** Whether this footprint is kept out of walls and other solid items. */
  collides: boolean
  keywords?: string
}

/** Default footprints in centimetres. Add new furniture kinds here. */
export const FURNITURE_PRESETS: Record<FurnitureKind, FurniturePreset> = {
  table: {
    label: 'Table',
    w: 140,
    h: 80,
    category: 'tables',
    collides: true,
  },
  sofa: {
    label: 'Sofa',
    w: 200,
    h: 90,
    category: 'seating',
    collides: true,
  },
  bed: {
    label: 'Bed',
    w: 150,
    h: 200,
    category: 'sleeping',
    collides: true,
    keywords: 'double mattress',
  },
  desk: {
    label: 'Desk',
    w: 120,
    h: 60,
    category: 'tables',
    collides: true,
    keywords: 'work table',
  },
  chair: {
    label: 'Chair',
    w: 50,
    h: 50,
    category: 'seating',
    collides: true,
    keywords: 'seat',
  },
  dresser: {
    label: 'Dresser',
    w: 120,
    h: 50,
    category: 'storage',
    collides: true,
    keywords: 'drawers chest',
  },
  tv: {
    label: 'TV',
    w: 120,
    h: 20,
    category: 'media',
    collides: true,
    keywords: 'television screen',
  },
  kitchen: {
    label: 'Kitchen counter',
    w: 240,
    h: 60,
    category: 'kitchen',
    collides: true,
    keywords: 'sink hob cabinets',
  },
  appliance: {
    label: 'Appliance',
    w: 60,
    h: 60,
    category: 'kitchen',
    collides: true,
    keywords: 'fridge washer dryer',
  },
  radiator: {
    label: 'Radiator',
    w: 100,
    h: 15,
    category: 'fixtures',
    collides: true,
    keywords: 'heater',
  },
  column: {
    label: 'Column',
    w: 30,
    h: 30,
    category: 'fixtures',
    collides: true,
    keywords: 'pillar post',
  },
  rug: {
    label: 'Rug',
    w: 200,
    h: 300,
    category: 'decor',
    collides: false,
    keywords: 'carpet mat',
  },
  box: {
    label: 'Generic object',
    w: 100,
    h: 100,
    category: 'other',
    collides: true,
    keywords: 'box custom',
  },
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
