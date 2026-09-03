import { beforeEach, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Inspector } from './inspector.tsx'

import { plannerStore } from '#/lib/planner/store.ts'

import type { Project } from '#/lib/planner/types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

function plan(): Project {
  return { id: PLAN, name: 'Plan 1', rooms: [], furniture: [], openings: [] }
}

beforeEach(() => {
  plannerStore.actions.closeProject()
  plannerStore.actions.loadLibrary({ version: 1, projects: [plan()] })
})

/*
  The editor renders before the library has been restored and a plan opened,
  so the name field's first value is the empty one it is handed, not one the
  user typed. It has nothing to complain about yet.
*/
it('does not fault the plan name before the plan has loaded', () => {
  const html = renderToStaticMarkup(<Inspector />)

  expect(html).not.toContain('Enter a plan name.')
  expect(html).not.toContain('aria-invalid="true"')
})

it('shows a loaded plan name without faulting it', () => {
  plannerStore.actions.openProject(PLAN)

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('value="Plan 1"')
  expect(html).not.toContain('Enter a plan name.')
  expect(html).not.toContain('aria-invalid="true"')
})

it('shows exact length and angle controls for a selected wall', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  const room = plannerStore.state.rooms[0]
  plannerStore.actions.setRoomLocked(room.id, false)
  plannerStore.actions.select({ type: 'wall', id: room.id, index: 0 })

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('Wall 1 of 4')
  expect(html).toContain('Length cm')
  expect(html).toContain('Angle °')
  expect(html).toContain('value="400"')
  expect(html).toContain('value="0"')
  expect(html).toContain('Start corner')
})

it('offers room rotation controls and holds them while the room is locked', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('Rotate 90°')
  expect(html).toContain('Choose color')
  expect(html).toContain('Default')
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Rotate Room 1 90 degrees counterclockwise"/,
  )
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Rotate Room 1 90 degrees clockwise"/,
  )
})

it('places a disabled width and height swap control between locked room fields', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()

  const html = renderToStaticMarkup(<Inspector />)
  const width = html.indexOf('Width cm')
  const swap = html.indexOf('aria-label="Swap width and height for Room 1"')
  const height = html.indexOf('Height cm')

  expect(width).toBeGreaterThan(-1)
  expect(swap).toBeGreaterThan(width)
  expect(height).toBeGreaterThan(swap)
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Swap width and height for Room 1"/,
  )
})

it('edits catalogue footprints in imperial units and can save a custom preset', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.setUnits('imperial')
  plannerStore.actions.addFurniture('bed')

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('Bed')
  expect(html).toContain('Width in')
  expect(html).toContain('Depth in')
  expect(html).toContain('value="59.06"')
  expect(html).toContain('value="78.74"')
  expect(html).toContain('Solid footprint')
  expect(html).toContain('Choose color')
  expect(html).toContain('Save as custom preset')
})
