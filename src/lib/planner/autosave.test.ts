import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { plannerStore, saveNow, startAutosave } from './store.ts'
import { PrefsSchema } from './types.ts'

import type { PlannerStorage } from './store.ts'
import type { Project } from './types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

/** Long enough that nothing is written unless something asks for it to be. */
const NEVER = 60_000

function plan(): Project {
  return {
    id: PLAN,
    name: 'Flat',
    rooms: [],
    furniture: [],
    openings: [],
  }
}

/** A browser store that can be told to refuse a write, the way a full one does. */
function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    /** Set to have the next and every later write throw. */
    refuse: null as Error | null,
    getItem(key: string) {
      return items.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (this.refuse) throw this.refuse
      items.set(key, value)
    },
  }
}

function quotaError(): Error {
  const error = new Error('The quota has been exceeded.')
  error.name = 'QuotaExceededError'
  return error
}

/** The library as it actually reached storage. */
function written(storage: PlannerStorage) {
  const raw = storage.getItem('rmplnr.projects.v1')
  return raw === null ? null : JSON.parse(raw)
}

let stop: (() => void) | null = null

/** Start the autosave over a fresh library with one plan open. */
function open(storage: PlannerStorage | null, debounceMs = NEVER) {
  plannerStore.actions.loadLibrary({ version: 1, projects: [plan()] })
  plannerStore.actions.openProject(PLAN)
  const lifecycle = new EventTarget()
  stop = startAutosave({ storage, lifecycle, debounceMs })
  return lifecycle
}

beforeEach(() => {
  plannerStore.actions.closeProject()
  plannerStore.actions.setUnits('metric')
  plannerStore.actions.setCollide(true)
  plannerStore.actions.setCustomFurniturePresets([])
  plannerStore.actions.setPersistence({ status: 'saved', failure: null })
})

afterEach(() => {
  stop?.()
  stop = null
})

describe('autosave', () => {
  it('says an edit is unsaved until it is written down', async () => {
    const storage = memoryStorage()
    open(storage, 1)

    plannerStore.actions.addFurniture('sofa')
    expect(plannerStore.state.persistence).toEqual({
      status: 'saving',
      failure: null,
    })
    expect(written(storage)).toBeNull()

    await Bun.sleep(20)

    expect(plannerStore.state.persistence).toEqual({
      status: 'saved',
      failure: null,
    })
    expect(written(storage).projects[0].furniture).toHaveLength(1)
  })

  it('writes the pending edit out when the page goes away', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('sofa')
    lifecycle.dispatchEvent(new Event('pagehide'))

    expect(written(storage).projects[0].furniture).toHaveLength(1)
    expect(plannerStore.state.persistence.status).toBe('saved')
  })

  it('leaves storage alone for a change that is not part of the plan', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.setTool('rect')
    plannerStore.actions.zoomTo(2)
    plannerStore.actions.select({ type: 'room', id: 'nothing' })
    lifecycle.dispatchEvent(new Event('pagehide'))

    expect(plannerStore.state.persistence.status).toBe('saved')
    expect(written(storage)).toBeNull()
  })

  it('keeps preferences, which are not part of any one plan', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.setUnits('imperial')
    lifecycle.dispatchEvent(new Event('pagehide'))

    expect(JSON.parse(storage.getItem('rmplnr.prefs.v1')!)).toEqual({
      version: 1,
      units: 'imperial',
      collide: true,
    })
  })

  it('persists custom furniture presets with editor preferences', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)

    plannerStore.actions.addFurniture('desk')
    const desk = plannerStore.state.furniture[0]
    plannerStore.actions.updateFurniture(desk.id, {
      name: 'Compact desk',
      w: 105,
      h: 55,
    })
    plannerStore.actions.saveFurniturePreset(desk.id)
    lifecycle.dispatchEvent(new Event('pagehide'))

    const prefs = PrefsSchema.parse(
      JSON.parse(storage.getItem('rmplnr.prefs.v1')!),
    )
    expect(prefs.customFurniturePresets).toHaveLength(1)
    expect(prefs.customFurniturePresets[0]).toMatchObject({
      name: 'Compact desk',
      kind: 'desk',
      w: 105,
      h: 55,
      collides: true,
    })
  })

  it('reports a full store, and keeps the edit and the editor alive', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)
    storage.refuse = quotaError()

    plannerStore.actions.addFurniture('sofa')
    lifecycle.dispatchEvent(new Event('pagehide'))

    expect(plannerStore.state.persistence).toEqual({
      status: 'error',
      failure: 'quota',
    })
    // Editing carries on: the failure is visible, not fatal.
    plannerStore.actions.addFurniture('table')
    expect(plannerStore.state.furniture).toHaveLength(2)

    // And nothing that failed to be written is ever marked as written, so
    // room made afterwards saves everything rather than only the last edit.
    storage.refuse = null
    saveNow()

    expect(plannerStore.state.persistence).toEqual({
      status: 'saved',
      failure: null,
    })
    expect(written(storage).projects[0].furniture).toHaveLength(2)
  })

  it('names a blocked store rather than dropping the plan quietly', () => {
    const lifecycle = open(null)

    plannerStore.actions.addFurniture('sofa')
    lifecycle.dispatchEvent(new Event('pagehide'))

    expect(plannerStore.state.persistence).toEqual({
      status: 'error',
      failure: 'blocked',
    })
  })

  it('stops writing once it is stopped', () => {
    const storage = memoryStorage()
    const lifecycle = open(storage)
    stop?.()
    stop = null

    plannerStore.actions.addFurniture('sofa')
    lifecycle.dispatchEvent(new Event('pagehide'))
    saveNow()

    expect(written(storage)).toBeNull()
  })
})
