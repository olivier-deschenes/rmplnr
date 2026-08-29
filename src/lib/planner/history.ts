import type { Furniture, Opening, Point, Room, Selection } from './types.ts'

/** How many steps back the editor keeps before the oldest one drops off. */
export const HISTORY_LIMIT = 100

/**
 * What one undo puts back: the plan itself, plus the editing state a change is
 * seen through — the polygon being traced at the time, and what was selected,
 * so an undone delete hands the thing back ready to be worked on again.
 *
 * The store never mutates in place, so a step costs a handful of references:
 * everything the change left alone is shared with the state it came from.
 */
export type Snapshot = {
  rooms: Array<Room>
  furniture: Array<Furniture>
  openings: Array<Opening>
  draft: Array<Point> | null
  selection: Selection
}

export type History = {
  past: Array<Snapshot>
  future: Array<Snapshot>
  /**
   * What the step on top of `past` was recorded for. A change arriving under
   * the same label folds into that step rather than stacking one of its own,
   * which is what turns the hundred small moves of a drag into a single undo.
   * `null` closes the top step, so whatever comes next starts a fresh one.
   */
  label: string | null
}

export const EMPTY_HISTORY: History = { past: [], future: [], label: null }

/** Lift the undoable part out of a wider state. */
export function snapshotOf(state: Snapshot): Snapshot {
  return {
    rooms: state.rooms,
    furniture: state.furniture,
    openings: state.openings,
    draft: state.draft,
    selection: state.selection,
  }
}

/**
 * Record where the plan stands as the point an undo comes back to. Recording
 * anything drops the redo stack: once the plan takes a different turn, the
 * future it used to have is no longer reachable.
 */
export function pushHistory(
  history: History,
  state: Snapshot,
  label: string | null,
): History {
  if (label !== null && label === history.label) {
    // Folded into the step already on top, which is the one undo returns to.
    return history.future.length === 0 ? history : { ...history, future: [] }
  }
  return {
    past: [...history.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
    future: [],
    label,
  }
}
