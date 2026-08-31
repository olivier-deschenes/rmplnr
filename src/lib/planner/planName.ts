import { ProjectNameSchema } from './types.ts'

/**
 * What the plan-name field is showing and complaining about.
 *
 * `draft` is null while the field simply mirrors the stored name, and holds
 * the half-typed text once the user starts editing. `error` is only ever set
 * by something the user typed: a name handed to the field from the store is
 * never worth complaining about, and the store has no blank ones to hand over.
 */
export type PlanNameEdit = {
  draft: string | null
  error: string | null
}

/** A field nobody has typed into: it shows the stored name, and is content. */
export const UNTOUCHED_PLAN_NAME: PlanNameEdit = { draft: null, error: null }

/**
 * The outcome of an edit: what the field should now show, and the name to
 * store, which is null when there is nothing valid to store yet.
 */
export type PlanNameEdited = {
  edit: PlanNameEdit
  commit: string | null
}

function complaint(name: string): string | null {
  const parsed = ProjectNameSchema.safeParse(name)
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? 'Enter a plan name.')
}

/** A keystroke. A valid name goes straight to the store; a blank one waits. */
export function typePlanName(next: string): PlanNameEdited {
  const parsed = ProjectNameSchema.safeParse(next)
  return parsed.success
    ? { edit: { draft: next, error: null }, commit: parsed.data }
    : { edit: { draft: next, error: complaint(next) }, commit: null }
}

/**
 * Leaving the field, or pressing Enter in it. Either way the draft is done
 * with: a blank attempt gives the field back its last valid stored value, and
 * says why it did.
 */
export function commitPlanName(shown: string): PlanNameEdited {
  const error = complaint(shown)
  return {
    edit: { draft: null, error },
    commit: error === null ? ProjectNameSchema.parse(shown) : null,
  }
}

/**
 * A different name has arrived from the store — the library finished loading,
 * or an undo, or another panel renamed the plan. A field the user is in the
 * middle of typing into keeps its draft; an untouched one takes the new name
 * as given, and drops any complaint left over from an earlier name.
 */
export function refreshPlanName(edit: PlanNameEdit): PlanNameEdit {
  return edit.draft === null ? UNTOUCHED_PLAN_NAME : edit
}
