import type { FurnitureKind } from './types.ts'

/** Default footprint in centimetres. Add new furniture kinds here. */
export const FURNITURE_PRESETS: Record<
  FurnitureKind,
  { label: string; w: number; h: number }
> = {
  table: { label: 'Table', w: 140, h: 80 },
  sofa: { label: 'Sofa', w: 200, h: 90 },
}

export const FURNITURE_KINDS = Object.keys(
  FURNITURE_PRESETS,
) as Array<FurnitureKind>
