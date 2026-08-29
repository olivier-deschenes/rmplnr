import { OPENING_PRESETS } from './presets.ts'
import { polygonBounds } from './geometry.ts'

import type { Snapshot } from './history.ts'
import type { Furniture, Opening, OpeningKind, Room } from './types.ts'

/**
 * The words the history panel reads a change out in.
 *
 * Every route into the plan hands over a patch rather than an intent — a drag,
 * an arrow key and a typed field all end up calling the same updater — so what
 * a change did has to be read back off the fields it carries. That reading
 * lives here, away from the store, which is left saying only what changed.
 */

/** The kind of an opening as it reads mid-sentence: `Moved sliding door`. */
export function openingName(kind: OpeningKind): string {
  return OPENING_PRESETS[kind].label.toLowerCase()
}

/** What the selection is called, for changes that name what they act on. */
export function selectionName(state: Snapshot): string {
  const selection = state.selection
  if (!selection) return 'selection'
  if (selection.type === 'room') {
    return state.rooms.find((r) => r.id === selection.id)?.name ?? 'room'
  }
  if (selection.type === 'furniture') {
    return state.furniture.find((f) => f.id === selection.id)?.name ?? 'item'
  }
  const opening = state.openings.find((o) => o.id === selection.id)
  return opening ? openingName(opening.kind) : 'opening'
}

export function describeFurniture(
  item: Furniture,
  patch: Partial<Furniture>,
): string {
  if (patch.name !== undefined) return `Renamed ${item.name}`
  // A resize sends the new size along with the centre it turned around, so the
  // size has the first say in what to call it.
  if (patch.w !== undefined || patch.h !== undefined)
    return `Resized ${item.name}`
  if (patch.rotation !== undefined) return `Rotated ${item.name}`
  if (patch.x !== undefined || patch.y !== undefined)
    return `Moved ${item.name}`
  return `Changed ${item.name}`
}

export function describeRoom(room: Room, patch: Partial<Room>): string {
  if (patch.name !== undefined) return `Renamed ${room.name}`
  if (!patch.points) return `Changed ${room.name}`
  // Dragging a room hands over a whole new outline, exactly as resizing it
  // does; what tells the two apart is whether the box around it kept its size.
  const before = polygonBounds(room.points)
  const after = polygonBounds(patch.points)
  const sameSize =
    Math.abs(before.w - after.w) < 0.5 && Math.abs(before.h - after.h) < 0.5
  return `${sameSize ? 'Moved' : 'Resized'} ${room.name}`
}

export function describeOpening(
  opening: Opening,
  patch: Partial<Opening>,
): string {
  const name = openingName(opening.kind)
  if (patch.kind !== undefined && patch.kind !== opening.kind) {
    return `Changed ${name} to ${openingName(patch.kind)}`
  }
  // Dragging a jamb moves the centre as it widens the gap, so width leads.
  if (patch.width !== undefined) return `Resized ${name}`
  if (patch.t !== undefined) return `Moved ${name}`
  if (patch.hinge !== undefined) return `Rehung ${name}`
  if (patch.swing !== undefined) return `Flipped ${name}`
  return `Changed ${name}`
}
