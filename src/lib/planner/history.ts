import type {
  Furniture,
  Opening,
  WallRun,
  Selection,
  Space,
  WallDraft,
} from './types.ts'

/** How many steps back the editor keeps before the oldest one drops off. */
export const HISTORY_LIMIT = 100

/** How many changes the history panel lists, newest first. */
export const HISTORY_ROWS = 10

/** How many undone steps it keeps on show above them, greyed out. */
const UNDONE_ROWS = 3

/**
 * What one undo puts back: the plan itself, plus the editing state a change is
 * seen through — the polygon being traced at the time, and what was selected,
 * so an undone delete hands the thing back ready to be worked on again.
 *
 * The store never mutates in place, so a step costs a handful of references:
 * everything the change left alone is shared with the state it came from.
 */
export type Snapshot = {
  walls: Array<WallRun>
  furniture: Array<Furniture>
  openings: Array<Opening>
  spaces: Array<Space>
  draft: WallDraft | null
  selection: Selection
}

/**
 * One step back, and what taking it undoes: `snapshot` is where the plan stood
 * before the change, and `text` names the change that followed — the same words
 * the history panel reads out, written when the step is recorded because that
 * is the only moment both sides of the change are in hand.
 */
export type Step = {
  snapshot: Snapshot
  text: string
}

export type History = {
  past: Array<Step>
  future: Array<Step>
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
    walls: state.walls,
    furniture: state.furniture,
    openings: state.openings,
    spaces: state.spaces,
    draft: state.draft,
    selection: state.selection,
  }
}

/**
 * Record where the plan stands as the point an undo comes back to, under the
 * name of the change about to be made. Recording anything drops the redo
 * stack: once the plan takes a different turn, the future it used to have is
 * no longer reachable.
 */
export function pushHistory(
  history: History,
  state: Snapshot,
  label: string | null,
  text: string,
): History {
  if (label !== null && label === history.label) {
    // Folded into the step already on top, which is the one undo returns to —
    // and which the change doing the folding has already named.
    return history.future.length === 0 ? history : { ...history, future: [] }
  }
  return {
    past: [...history.past, { snapshot: snapshotOf(state), text }].slice(
      -HISTORY_LIMIT,
    ),
    future: [],
    label,
  }
}

/**
 * One line of the history panel: a change, and how many times in a row it was
 * made. `undone` marks the ones an undo has stepped back past, which are still
 * listed for as long as a redo could bring them back.
 */
export type Action = {
  text: string
  count: number
  undone: boolean
}

/** Collapse a run of identical changes — four nudges — into one line. */
function fold(steps: Array<Step>, undone: boolean): Array<Action> {
  const rows: Array<Action> = []
  for (const step of steps) {
    const top = rows.at(-1)
    if (top && top.text === step.text) top.count += 1
    else rows.push({ text: step.text, count: 1, undone })
  }
  return rows
}

/**
 * The recent changes to the plan, newest first: the undone ones — which sit
 * ahead of where the plan now stands, furthest out first — and then the ones
 * still in effect, back from the latest.
 */
export function recentActions(
  history: History,
  limit = HISTORY_ROWS,
): Array<Action> {
  return [
    ...fold(history.future.slice(-UNDONE_ROWS), true),
    ...fold([...history.past].reverse(), false).slice(0, limit),
  ]
}
