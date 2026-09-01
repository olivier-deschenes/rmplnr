import { describe, expect, it } from 'bun:test'

import { calibratedDimensions, createUnderlayStore } from './underlay.ts'

import type { Underlay, UnderlayStorage } from './underlay.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'
const COPY = '22222222-2222-4222-8222-222222222222'

function background(overrides: Partial<Underlay> = {}): Underlay {
  return {
    id: 'underlay-1',
    projectId: PLAN,
    name: 'main-floor.png',
    source: 'image',
    page: null,
    mimeType: 'image/png',
    blob: new Blob([new Uint8Array(1024 * 1024)], { type: 'image/png' }),
    pixelWidth: 1000,
    pixelHeight: 500,
    x: 20,
    y: 30,
    width: 800,
    height: 400,
    opacity: 0.5,
    visible: true,
    ...overrides,
  }
}

function memoryStorage(): UnderlayStorage & {
  values: Map<string, Underlay>
  failure: Error | null
} {
  const values = new Map<string, Underlay>()
  return {
    values,
    failure: null,
    async get(projectId) {
      return values.get(projectId) ?? null
    },
    async put(underlay) {
      if (this.failure) throw this.failure
      values.set(underlay.projectId, underlay)
    },
    async delete(projectId) {
      if (this.failure) throw this.failure
      values.delete(projectId)
    },
  }
}

describe('underlay calibration', () => {
  it('turns one known image span into an accurate plan size', () => {
    const result = calibratedDimensions(
      1000,
      500,
      { x: 100, y: 80 },
      { x: 600, y: 80 },
      400,
    )

    expect(result).toEqual({
      ok: true,
      width: 800,
      height: 400,
      centimetresPerPixel: 0.8,
    })
  })

  it('rejects a zero distance instead of inventing a scale', () => {
    const result = calibratedDimensions(
      1000,
      500,
      { x: 100, y: 80 },
      { x: 100, y: 80 },
      400,
    )

    expect(result.ok).toBe(false)
  })
})

describe('underlay persistence', () => {
  it('restores the Blob and calibrated placement outside plan storage', async () => {
    const storage = memoryStorage()
    const first = createUnderlayStore(storage)

    await first.actions.open(PLAN)
    await first.actions.replace(background())
    first.actions.close(PLAN)

    const reopened = createUnderlayStore(storage)
    await reopened.actions.open(PLAN)

    expect(reopened.state.underlay).toMatchObject({
      projectId: PLAN,
      width: 800,
      height: 400,
      opacity: 0.5,
      visible: true,
    })
    expect(reopened.state.underlay?.blob.size).toBe(1024 * 1024)
  })

  it('writes one final position after a canvas drag', async () => {
    const storage = memoryStorage()
    const store = createUnderlayStore(storage)
    await store.actions.open(PLAN)
    await store.actions.replace(background())

    store.actions.previewPosition(120, 230)
    expect(storage.values.get(PLAN)).toMatchObject({ x: 20, y: 30 })

    await store.actions.commitPosition()
    expect(storage.values.get(PLAN)).toMatchObject({ x: 120, y: 230 })
  })

  it('copies and deletes the background with its plan', async () => {
    const storage = memoryStorage()
    const store = createUnderlayStore(storage)
    await store.actions.open(PLAN)
    await store.actions.replace(background())

    await store.actions.copyProject(PLAN, COPY)
    expect(storage.values.get(COPY)).toMatchObject({ projectId: COPY })
    expect(storage.values.get(COPY)?.id).not.toBe('underlay-1')

    await store.actions.deleteProject(COPY)
    expect(storage.values.has(COPY)).toBe(false)
  })

  it('keeps the live underlay and reports a refused write', async () => {
    const storage = memoryStorage()
    const store = createUnderlayStore(storage)
    await store.actions.open(PLAN)
    storage.failure = Object.assign(new Error('full'), {
      name: 'QuotaExceededError',
    })

    await store.actions.replace(background())

    expect(store.state.underlay?.name).toBe('main-floor.png')
    expect(store.state.status).toBe('error')
    expect(store.state.failure).toBe('quota')
  })
})
