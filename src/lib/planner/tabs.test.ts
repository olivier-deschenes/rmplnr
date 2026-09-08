import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  keepThisTab,
  plannerStore,
  saveNow,
  startAutosave,
  takeOtherTab,
} from './store.ts'

import type { PlannerStorage } from './store.ts'
import type { Furniture, Project } from './types.ts'

const PLAN_A = '11111111-1111-4111-8111-111111111111'
const PLAN_B = '22222222-2222-4222-8222-222222222222'

const LIBRARY_KEY = 'rmplnr.projects.v1'

/** Another tab, as far as this one can tell: a name that is not its own. */
const OTHER = 'another-tab'

/** Long enough that nothing is written unless something asks for it to be. */
const NEVER = 60_000

function sofa(id: string): Furniture {
  return {
    id,
    kind: 'sofa',
    name: 'Sofa',
    x: 0,
    y: 0,
    w: 200,
    h: 90,
    rotation: 0,
  }
}

function plan(
  id: string,
  name: string,
  furniture: Array<Furniture> = [],
): Project {
  return { id, name, walls: [], furniture, openings: [], spaces: [] }
}

function library() {
  return [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House')]
}

/** One browser's storage, shared by every tab in the test. */
function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

/** The library as it actually stands in storage, stamp and all. */
function stored(storage: PlannerStorage) {
  const raw = storage.getItem(LIBRARY_KEY)
  return raw === null ? null : JSON.parse(raw)
}

/** What another tab left behind, and the news of it reaching this one. */
function otherTabWrote(
  storage: PlannerStorage,
  lifecycle: EventTarget,
  projects: Array<Project>,
  revision: number,
) {
  storage.setItem(
    LIBRARY_KEY,
    JSON.stringify({ version: 1, projects, writer: OTHER, revision }),
  )
  lifecycle.dispatchEvent(new Event('storage'))
}

let stop: (() => void) | null = null

/**
 * A tab open on `Flat`, in a browser where another tab has already saved the
 * library once — which is the state the two of them last agreed on.
 */
function open(storage: PlannerStorage, debounceMs = NEVER) {
  storage.setItem(
    LIBRARY_KEY,
    JSON.stringify({
      version: 1,
      projects: library(),
      writer: OTHER,
      revision: 1,
    }),
  )
  plannerStore.actions.loadLibrary({ version: 1, projects: library() })
  plannerStore.actions.openProject(PLAN_A)
  const lifecycle = new EventTarget()
  stop = startAutosave({ storage, lifecycle, debounceMs })
  return lifecycle
}

beforeEach(() => {
  plannerStore.actions.closeProject()
  plannerStore.actions.setConflict(null)
  plannerStore.actions.setPersistence({ status: 'saved', failure: null })
})

afterEach(() => {
  stop?.()
  stop = null
})

describe('two tabs on one browser', () => {
  it('keeps both plans when the tabs are drawing on different ones', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    // Here: a sofa in the open plan, not yet written down.
    plannerStore.actions.addFurniture('sofa')
    // There: a sofa in the other plan, written down.
    otherTabWrote(
      storage,
      lifecycle,
      [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House', [sofa('theirs')])],
      2,
    )

    expect(plannerStore.state.conflict).toBeNull()

    const projects: Array<Project> = stored(storage).projects
    expect(projects[0].furniture).toHaveLength(1)
    expect(projects[1].furniture[0].id).toBe('theirs')
    // Merged and written on the spot, under a revision above the one merged in.
    expect(stored(storage).revision).toBe(3)
    expect(plannerStore.state.persistence.status).toBe('saved')
  })

  it('shows the other tab’s work on a plan this one has not touched', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    otherTabWrote(
      storage,
      lifecycle,
      [plan(PLAN_A, 'Flat', [sofa('theirs')]), plan(PLAN_B, 'House')],
      2,
    )

    expect(plannerStore.state.conflict).toBeNull()
    expect(plannerStore.state.furniture[0].id).toBe('theirs')
    // Nothing of this tab's was outstanding, so nothing was written back.
    expect(stored(storage).revision).toBe(2)
  })

  it('leaves the open plan’s history alone when another plan changes', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    const undoable = plannerStore.state.history.past.length
    expect(undoable).toBeGreaterThan(0)

    otherTabWrote(
      storage,
      lifecycle,
      [plan(PLAN_A, 'Flat'), plan(PLAN_B, 'House', [sofa('theirs')])],
      2,
    )

    expect(plannerStore.state.history.past).toHaveLength(undoable)
    expect(plannerStore.state.furniture).toHaveLength(1)
  })

  it('asks rather than choosing when both tabs drew on the same plan', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    otherTabWrote(
      storage,
      lifecycle,
      [plan(PLAN_A, 'Flat', [sofa('theirs')]), plan(PLAN_B, 'House')],
      2,
    )

    expect(plannerStore.state.conflict).toEqual({
      plans: [{ id: PLAN_A, name: 'Flat' }],
    })
    // Neither version is written over the other, and asking again changes
    // nothing: the answer is the reader's.
    saveNow()
    expect(stored(storage).writer).toBe(OTHER)
    expect(stored(storage).projects[0].furniture[0].id).toBe('theirs')
    expect(plannerStore.state.persistence.status).toBe('saving')
  })

  it('writes this tab’s version over the other’s when asked to keep it', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    otherTabWrote(
      storage,
      lifecycle,
      [plan(PLAN_A, 'Flat', [sofa('theirs')]), plan(PLAN_B, 'House')],
      2,
    )
    keepThisTab()

    expect(plannerStore.state.conflict).toBeNull()
    expect(stored(storage).projects[0].furniture[0].id).not.toBe('theirs')
    expect(stored(storage).revision).toBe(3)
    expect(plannerStore.state.persistence).toEqual({
      status: 'saved',
      failure: null,
    })
  })

  it('takes the other tab’s version onto the canvas when asked to', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    otherTabWrote(
      storage,
      lifecycle,
      [plan(PLAN_A, 'Flat', [sofa('theirs')]), plan(PLAN_B, 'House')],
      2,
    )
    takeOtherTab()

    expect(plannerStore.state.conflict).toBeNull()
    expect(plannerStore.state.furniture).toEqual([sofa('theirs')])
    // Their copy is what storage holds, and this tab has nothing left to add.
    expect(stored(storage).revision).toBe(2)
    expect(stored(storage).writer).toBe(OTHER)
    expect(plannerStore.state.persistence).toEqual({
      status: 'saved',
      failure: null,
    })
  })

  it('catches the other tab even without being told about it', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    // No storage event: the page is going away, and the last thing it does is
    // write down what it has. It looks first even so.
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        projects: [
          plan(PLAN_A, 'Flat', [sofa('theirs')]),
          plan(PLAN_B, 'House'),
        ],
        writer: OTHER,
        revision: 2,
      }),
    )
    lifecycle.dispatchEvent(new Event('pagehide'))

    expect(plannerStore.state.conflict).not.toBeNull()
    expect(stored(storage).projects[0].furniture[0].id).toBe('theirs')
  })

  it('does not read its own write as news from somewhere else', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    saveNow()
    const mine = stored(storage)
    lifecycle.dispatchEvent(new Event('storage'))

    expect(plannerStore.state.conflict).toBeNull()
    expect(stored(storage)).toEqual(mine)
  })

  it('stops once both tabs hold the same library', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    saveNow()
    const settled = stored(storage).projects

    // The other tab takes this one's library on and stamps it as its own,
    // which must not start the two of them writing at each other.
    otherTabWrote(storage, lifecycle, settled, 4)

    expect(plannerStore.state.conflict).toBeNull()
    expect(stored(storage).revision).toBe(4)
    expect(stored(storage).writer).toBe(OTHER)
  })

  it('lets go of a plan the other tab deleted', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    otherTabWrote(storage, lifecycle, [plan(PLAN_A, 'Flat')], 2)

    expect(plannerStore.state.conflict).toBeNull()
    expect(plannerStore.state.projects.map((p) => p.id)).toEqual([PLAN_A])
  })
})
