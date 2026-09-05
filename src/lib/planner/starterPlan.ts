import { rectPolygon } from './geometry.ts'
import { FURNITURE_PRESETS } from './presets.ts'

import type {
  Furniture,
  FurnitureKind,
  Opening,
  Project,
  Room,
} from './types.ts'

/** A measured example with a clear path from the entrance to every room. */
export function createStarterPlan(): Project {
  const living: Room = {
    id: crypto.randomUUID(),
    name: 'Living & kitchen',
    points: rectPolygon({ x: 0, y: 0 }, { x: 400, y: 600 }),
    locked: true,
  }
  const bedroom: Room = {
    id: crypto.randomUUID(),
    name: 'Bedroom',
    points: rectPolygon({ x: 400, y: 0 }, { x: 680, y: 360 }),
    locked: true,
  }
  const bathroom: Room = {
    id: crypto.randomUUID(),
    name: 'Bathroom',
    points: rectPolygon({ x: 400, y: 360 }, { x: 680, y: 600 }),
    locked: true,
  }

  function furniture(
    kind: FurnitureKind,
    x: number,
    y: number,
    details: Partial<Pick<Furniture, 'name' | 'w' | 'h' | 'rotation'>> = {},
  ): Furniture {
    const preset = FURNITURE_PRESETS[kind]
    return {
      id: crypto.randomUUID(),
      kind,
      name: preset.label,
      x,
      y,
      w: preset.w,
      h: preset.h,
      rotation: 0,
      collides: preset.collides,
      ...details,
    }
  }

  function opening(
    room: Room,
    kind: Opening['kind'],
    wall: number,
    t: number,
    width: number,
  ): Opening {
    return {
      id: crypto.randomUUID(),
      roomId: room.id,
      kind,
      wall,
      t,
      width,
      hinge: 'start',
      swing: 'in',
    }
  }

  return {
    id: crypto.randomUUID(),
    name: 'Studio apartment',
    rooms: [living, bedroom, bathroom],
    furniture: [
      furniture('kitchen', 180, 50, { w: 320 }),
      furniture('sofa', 80, 395, { rotation: 270 }),
      furniture('table', 220, 430, { name: 'Coffee table', w: 100, h: 55 }),
      furniture('bed', 560, 85, { rotation: 90 }),
      furniture('dresser', 545, 320),
      furniture('box', 610, 535, { name: 'Shower', w: 100, h: 100 }),
      furniture('box', 610, 402.5, { name: 'Vanity', w: 80, h: 45 }),
      furniture('box', 480, 535, { name: 'Toilet', w: 40, h: 70 }),
    ],
    openings: [
      opening(living, 'door', 2, 315 / 400, 90),
      opening(bedroom, 'door', 3, 74 / 360, 80),
      opening(bathroom, 'door', 3, 190 / 240, 80),
      opening(living, 'window', 3, 400 / 600, 140),
      opening(bedroom, 'window', 1, 0.6, 120),
      opening(bathroom, 'window', 2, 0.5, 80),
    ],
  }
}
