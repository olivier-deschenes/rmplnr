import { createStore } from '@tanstack/store'

import { distance } from './geometry.ts'

import type { Point, Rect } from './types.ts'

export type UnderlaySource = 'image' | 'pdf'

/**
 * One plan's tracing background. The Blob is deliberately kept in IndexedDB,
 * beside this small amount of placement metadata, and never enters the plan
 * library in localStorage.
 */
export type Underlay = {
  id: string
  projectId: string
  name: string
  source: UnderlaySource
  page: number | null
  mimeType: string
  blob: Blob
  pixelWidth: number
  pixelHeight: number
  /** Top-left corner and calibrated size, in plan centimetres. */
  x: number
  y: number
  width: number
  height: number
  opacity: number
  visible: boolean
}

export type UnderlayStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error'
export type UnderlayFailure = 'quota' | 'blocked' | 'unknown'

export type UnderlayState = {
  projectId: string | null
  underlay: Underlay | null
  status: UnderlayStatus
  failure: UnderlayFailure | null
  /** True only while the explicit canvas positioning mode is active. */
  positioning: boolean
}

export interface UnderlayStorage {
  get: (projectId: string) => Promise<Underlay | null>
  put: (underlay: Underlay) => Promise<void>
  delete: (projectId: string) => Promise<void>
}

export type CalibrationResult =
  | { ok: true; width: number; height: number; centimetresPerPixel: number }
  | { ok: false; error: string }

/** Turn a known span in the source image into its real plan size. */
export function calibratedDimensions(
  pixelWidth: number,
  pixelHeight: number,
  first: Point,
  second: Point,
  knownCentimetres: number,
): CalibrationResult {
  if (
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight) ||
    pixelWidth <= 0 ||
    pixelHeight <= 0
  ) {
    return { ok: false, error: 'The underlay image has no usable size.' }
  }
  if (!Number.isFinite(knownCentimetres) || knownCentimetres <= 0) {
    return { ok: false, error: 'Enter a distance greater than zero.' }
  }

  const pixels = distance(first, second)
  if (!Number.isFinite(pixels) || pixels < 1) {
    return {
      ok: false,
      error: 'Choose two different points on the known distance.',
    }
  }

  const centimetresPerPixel = knownCentimetres / pixels
  return {
    ok: true,
    width: pixelWidth * centimetresPerPixel,
    height: pixelHeight * centimetresPerPixel,
    centimetresPerPixel,
  }
}

export function underlayBounds(underlay: Underlay): Rect {
  return {
    x: underlay.x,
    y: underlay.y,
    w: underlay.width,
    h: underlay.height,
  }
}

const DATABASE = 'rmplnr.assets.v1'
const DATABASE_VERSION = 1
const STORE = 'underlays'

function browserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const indexedDb = (globalThis as Partial<typeof globalThis>).indexedDB
    if (!indexedDb) {
      reject(new DOMException('IndexedDB is unavailable.', 'SecurityError'))
      return
    }

    const request = indexedDb.open(DATABASE, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'projectId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open underlay storage.'))
    request.onblocked = () =>
      reject(new Error('Underlay storage is blocked by another tab.'))
  })
}

function validUnderlay(value: unknown): value is Underlay {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<Underlay>
  return (
    typeof record.id === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.name === 'string' &&
    (record.source === 'image' || record.source === 'pdf') &&
    (record.page === null ||
      (typeof record.page === 'number' && Number.isInteger(record.page))) &&
    typeof record.mimeType === 'string' &&
    record.blob instanceof Blob &&
    typeof record.pixelWidth === 'number' &&
    record.pixelWidth > 0 &&
    typeof record.pixelHeight === 'number' &&
    record.pixelHeight > 0 &&
    typeof record.x === 'number' &&
    Number.isFinite(record.x) &&
    typeof record.y === 'number' &&
    Number.isFinite(record.y) &&
    typeof record.width === 'number' &&
    record.width > 0 &&
    typeof record.height === 'number' &&
    record.height > 0 &&
    typeof record.opacity === 'number' &&
    record.opacity >= 0 &&
    record.opacity <= 1 &&
    typeof record.visible === 'boolean'
  )
}

/** The browser repository. IndexedDB stores Blobs without base64 expansion. */
export const indexedDbUnderlayStorage: UnderlayStorage = {
  async get(projectId) {
    const database = await browserDatabase()
    try {
      const transaction = database.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(projectId)
      const value = await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () =>
          reject(request.error ?? new Error('Could not read the underlay.'))
      })
      return validUnderlay(value) ? value : null
    } finally {
      database.close()
    }
  },

  async put(underlay) {
    const database = await browserDatabase()
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(underlay)
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Could not save the underlay.'))
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Could not save the underlay.'))
      })
    } finally {
      database.close()
    }
  },

  async delete(projectId) {
    const database = await browserDatabase()
    try {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(projectId)
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () =>
          reject(
            transaction.error ?? new Error('Could not delete the underlay.'),
          )
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error('Could not delete the underlay.'),
          )
      })
    } finally {
      database.close()
    }
  },
}

function failureOf(error: unknown): UnderlayFailure {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : ''
  if (name === 'QuotaExceededError') return 'quota'
  if (name === 'SecurityError' || name === 'InvalidStateError') return 'blocked'
  return 'unknown'
}

const initialState: UnderlayState = {
  projectId: null,
  underlay: null,
  status: 'idle',
  failure: null,
  positioning: false,
}

/**
 * Keep the asynchronous asset repository coherent with the plan route. Writes
 * are serialized, so a quick opacity drag can never let an older value land
 * after the final one.
 */
export function createUnderlayStore(storage: UnderlayStorage) {
  let routeRequest = 0
  let writeVersion = 0
  let writes: Promise<void> = Promise.resolve()

  return createStore(initialState, ({ setState, get }) => {
    const save = (underlay: Underlay): Promise<void> => {
      const version = ++writeVersion
      setState((state) =>
        state.projectId === underlay.projectId
          ? { ...state, status: 'saving', failure: null }
          : state,
      )

      const operation = writes.then(() => storage.put(underlay))
      writes = operation.catch(() => undefined)

      return operation.then(
        () => {
          if (version !== writeVersion) return
          setState((state) =>
            state.projectId === underlay.projectId
              ? { ...state, status: 'saved', failure: null }
              : state,
          )
        },
        (error: unknown) => {
          if (version !== writeVersion) return
          setState((state) =>
            state.projectId === underlay.projectId
              ? {
                  ...state,
                  status: 'error',
                  failure: failureOf(error),
                }
              : state,
          )
        },
      )
    }

    const remove = async (): Promise<void> => {
      const projectId = get().projectId
      const removed = get().underlay
      if (!projectId) return
      const version = ++writeVersion
      setState((state) => ({
        ...state,
        underlay: null,
        positioning: false,
        status: 'saving',
        failure: null,
      }))
      const operation = writes.then(() => storage.delete(projectId))
      writes = operation.catch(() => undefined)
      await operation.then(
        () => {
          if (version !== writeVersion) return
          setState((state) =>
            state.projectId === projectId
              ? { ...state, status: 'saved', failure: null }
              : state,
          )
        },
        (error: unknown) => {
          if (version !== writeVersion) return
          setState((state) =>
            state.projectId === projectId
              ? {
                  ...state,
                  underlay: removed,
                  status: 'error',
                  failure: failureOf(error),
                }
              : state,
          )
        },
      )
    }

    return {
      async open(projectId: string) {
        const request = ++routeRequest
        setState(() => ({
          projectId,
          underlay: null,
          status: 'loading',
          failure: null,
          positioning: false,
        }))
        try {
          await writes
          const underlay = await storage.get(projectId)
          if (request !== routeRequest || get().projectId !== projectId) return
          setState(() => ({
            projectId,
            underlay,
            status: 'saved',
            failure: null,
            positioning: false,
          }))
        } catch (error) {
          if (request !== routeRequest || get().projectId !== projectId) return
          setState(() => ({
            projectId,
            underlay: null,
            status: 'error',
            failure: failureOf(error),
            positioning: false,
          }))
        }
      },

      close(projectId?: string) {
        if (projectId && get().projectId !== projectId) return
        routeRequest += 1
        setState(() => initialState)
      },

      replace(underlay: Underlay): Promise<void> {
        routeRequest += 1
        setState(() => ({
          projectId: underlay.projectId,
          underlay,
          status: 'saving',
          failure: null,
          positioning: false,
        }))
        return save(underlay)
      },

      update(
        patch: Partial<Pick<Underlay, 'x' | 'y' | 'opacity' | 'visible'>>,
      ) {
        const current = get().underlay
        if (!current) return
        const next = { ...current, ...patch }
        setState((state) => {
          if (state.underlay?.id !== current.id) return state
          return { ...state, underlay: next }
        })
        void save(next)
      },

      /** Change the live canvas position without writing every pointer frame. */
      previewPosition(x: number, y: number) {
        setState((state) =>
          state.underlay
            ? { ...state, underlay: { ...state.underlay, x, y } }
            : state,
        )
      },

      commitPosition() {
        const underlay = get().underlay
        return underlay ? save(underlay) : Promise.resolve()
      },

      setPositioning(positioning: boolean) {
        setState((state) =>
          state.underlay && state.positioning !== positioning
            ? { ...state, positioning }
            : state,
        )
      },

      remove,

      /** Carry the current plan's background along when the plan is copied. */
      async copyProject(sourceProjectId: string, targetProjectId: string) {
        await writes
        const source =
          get().projectId === sourceProjectId
            ? get().underlay
            : await storage.get(sourceProjectId)
        if (!source) return
        await storage.put({
          ...source,
          id: crypto.randomUUID(),
          projectId: targetProjectId,
        })
      },

      /** Remove an asset together with a plan, including one not currently open. */
      async deleteProject(projectId: string) {
        if (get().projectId === projectId) {
          await remove()
          return
        }
        await writes
        await storage.delete(projectId)
      },
    }
  })
}

export const underlayStore = createUnderlayStore(indexedDbUnderlayStorage)
