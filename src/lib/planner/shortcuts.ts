import type { Hotkey } from '@tanstack/react-hotkeys'

import type { OPENING_TOOLS } from './presets.ts'
import type { Tool } from './types.ts'

/**
 * Every key the plan answers to, in one table.
 *
 * The canvas registers these with TanStack Hotkeys and the toolbar prints them
 * on its tooltips, so a binding cannot be moved in one place and left stale in
 * the other. `Mod` is ⌘ on a Mac and Ctrl everywhere else, and the toolbar
 * hands each string to `formatForDisplay` rather than spelling out a symbol
 * that would be a lie on half the machines that read it.
 */

/** The tools a key of their own reaches; openings are picked by kind below. */
export type DrawTool = Exclude<Tool, 'opening' | 'closet'>

export const TOOL_KEYS = {
  move: 'V',
  edit: 'A',
  room: 'R',
  rect: 'E',
} as const satisfies Record<DrawTool, Hotkey>

/**
 * Keyed off the toolbar's own list, so a kind cannot reach the bar without a
 * key to reach it by.
 */
export const OPENING_KEYS = {
  door: 'D',
  window: 'W',
  opening: 'O',
} as const satisfies Record<(typeof OPENING_TOOLS)[number], Hotkey>

/** The edits, and the keys that belong to the plan rather than to one tool. */
export const EDIT_KEYS = {
  undo: 'Mod+Z',
  redo: 'Mod+Shift+Z',
  /** ⌘Y redoes as well, for the hand that learned the shortcut on Windows. */
  redoAlt: 'Mod+Y',
  copy: 'Mod+C',
  paste: 'Mod+V',
  duplicate: 'Mod+D',
  cancel: 'Escape',
  commit: 'Enter',
  remove: 'Delete',
  /** Backspace deletes too, the two being one key to most hands. */
  removeAlt: 'Backspace',
  /** Held rather than struck: space turns any drag into a pan. */
  pan: 'Space',
} as const satisfies Record<string, Hotkey>

/**
 * Which way each arrow pushes the selection, before the step the plan is
 * snapping to scales it.
 */
export const NUDGE_KEYS: ReadonlyArray<{
  key: Hotkey
  shifted: Hotkey
  delta: readonly [number, number]
}> = [
  { key: 'ArrowLeft', shifted: 'Shift+ArrowLeft', delta: [-1, 0] },
  { key: 'ArrowRight', shifted: 'Shift+ArrowRight', delta: [1, 0] },
  { key: 'ArrowUp', shifted: 'Shift+ArrowUp', delta: [0, -1] },
  { key: 'ArrowDown', shifted: 'Shift+ArrowDown', delta: [0, 1] },
]

/** Shift covers ten steps of ground at a time. */
export const NUDGE_COARSE = 10
