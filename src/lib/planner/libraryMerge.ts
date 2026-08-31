import type { Project } from './types.ts'

/**
 * Whether two things read out of a plan say the same thing.
 *
 * One side of every comparison here has been through storage and back, so it
 * is JSON and nothing else: no dates, no maps, no cycles. A key explicitly set
 * to `undefined` is the same as one that is not there at all, which is the
 * difference between a room built by spreading over another and the same room
 * parsed back out of a file.
 */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => same(value, b[i]))
    )
  }
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((k) => left[k] !== undefined)
  const other = Object.keys(right).filter((k) => right[k] !== undefined)
  return (
    keys.length === other.length && keys.every((k) => same(left[k], right[k]))
  )
}

/** What a plan is, drawing and all — everything two tabs could disagree over. */
type Drawing = Pick<Project, 'rooms' | 'furniture' | 'openings'>

/** Whether two plans hold the same drawing. Their names are not part of it. */
export function samePlan(a: Drawing, b: Drawing): boolean {
  return (
    same(a.rooms, b.rooms) &&
    same(a.furniture, b.furniture) &&
    same(a.openings, b.openings)
  )
}

/** Whether two libraries hold the same plans, in the same order. */
export function sameLibrary(a: Array<Project>, b: Array<Project>): boolean {
  return same(a, b)
}

/** Whether two plans are the same plan in every respect, name included. */
function sameProject(a: Project, b: Project): boolean {
  return a.name === b.name && samePlan(a, b)
}

/** One plan two tabs have both changed, named as this tab knows it. */
export type ConflictedPlan = { id: string; name: string }

export type LibraryMerge =
  | { kind: 'merged'; projects: Array<Project> }
  | { kind: 'conflict'; plans: Array<ConflictedPlan> }

const byId = (projects: Array<Project>) =>
  new Map(projects.map((p) => [p.id, p]))

/**
 * Put together what two tabs have made of one browser's library.
 *
 * `base` is the library both tabs last agreed on — what storage held when this
 * tab last read it or wrote it. `mine` is what this tab has made of it since,
 * and `theirs` is what another tab has just written down.
 *
 * A plan only one of the two has touched is taken from whichever touched it,
 * which is what lets one plan be drawn on in one tab while another is drawn on
 * in the next. A plan both have touched is reported rather than decided:
 * either answer would throw away work somebody did on purpose, and which of
 * the two to keep is not a question this can answer.
 *
 * A plan deleted in one tab and left alone in the other stays deleted —
 * deleting a plan is deliberate and has no undo, so it is not something an
 * untouched copy elsewhere should quietly bring back.
 */
export function mergeLibraries(
  base: Array<Project>,
  mine: Array<Project>,
  theirs: Array<Project>,
): LibraryMerge {
  const wasThere = byId(base)
  const here = byId(mine)
  const there = byId(theirs)
  const plans: Array<ConflictedPlan> = []
  const projects: Array<Project> = []

  // Their order runs the list: this tab is taking their library on, and the
  // plans it has of its own are the only ones it has any say over.
  for (const theirsP of theirs) {
    const baseP = wasThere.get(theirsP.id)
    const mineP = here.get(theirsP.id)

    if (!mineP) {
      // Not here: either this tab deleted it, or that tab has just made it.
      if (!baseP) projects.push(theirsP)
      else if (!sameProject(baseP, theirsP)) {
        plans.push({ id: theirsP.id, name: theirsP.name })
      }
      continue
    }

    if (sameProject(mineP, theirsP) || (baseP && sameProject(baseP, mineP))) {
      projects.push(theirsP)
    } else if (baseP && sameProject(baseP, theirsP)) {
      projects.push(mineP)
    } else {
      plans.push({ id: mineP.id, name: mineP.name })
      projects.push(mineP)
    }
  }

  for (const mineP of mine) {
    if (there.has(mineP.id)) continue
    const baseP = wasThere.get(mineP.id)
    // New here since they last looked, so it is this tab's to add. Otherwise
    // that tab deleted it, and only an edit made here since stands in the way.
    if (!baseP) projects.push(mineP)
    else if (!sameProject(baseP, mineP)) {
      plans.push({ id: mineP.id, name: mineP.name })
      projects.push(mineP)
    }
  }

  return plans.length > 0
    ? { kind: 'conflict', plans }
    : { kind: 'merged', projects }
}
