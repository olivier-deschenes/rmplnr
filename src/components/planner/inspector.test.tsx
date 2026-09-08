import { beforeEach, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Inspector } from './inspector.tsx'

import { plannerStore } from '#/lib/planner/store.ts'
import { enclosuresOf } from '#/lib/planner/enclosures.ts'

import type { Project } from '#/lib/planner/types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

function plan(): Project {
  return {
    id: PLAN,
    name: 'Plan 1',
    walls: [],
    furniture: [],
    openings: [],
    spaces: [],
  }
}

beforeEach(() => {
  plannerStore.actions.setUnits('metric')
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
  const run = plannerStore.state.walls[0]
  plannerStore.actions.select({ type: 'wall', id: run.id, index: 0 })

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('Wall 1 of 4')
  expect(html).toContain('Length cm')
  expect(html).toContain('Angle °')
  expect(html).toContain('value="400"')
  expect(html).toContain('value="0"')
  expect(html).toContain('Start corner')
})

it('offers a remove-wall action on a run of walls, held while it is locked', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  const run = plannerStore.state.walls[0]
  plannerStore.actions.select({ type: 'wall', id: run.id, index: 0 })

  const unlocked = renderToStaticMarkup(<Inspector />)

  expect(unlocked).toContain('Remove wall')
  expect(unlocked).not.toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Remove wall 1 of Walls 1"/,
  )

  plannerStore.actions.setRunLocked(run.id, true)

  expect(renderToStaticMarkup(<Inspector />)).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Remove wall 1 of Walls 1"/,
  )
})

it('offers a padlock on the space a run of walls closes in', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  // Out from the room's left wall, round, and back onto it higher up.
  for (const point of [
    { x: 0, y: 0 },
    { x: -200, y: 0 },
    { x: -200, y: 150 },
    { x: 0, y: 150 },
  ]) {
    plannerStore.actions.addDraftPoint(point)
  }
  const { walls, spaces } = plannerStore.state
  const space = enclosuresOf(walls, spaces).find((floor) => floor.centre.x < 0)!
  plannerStore.actions.select({ type: 'enclosure', id: space.key })

  const unlocked = renderToStaticMarkup(<Inspector />)

  expect(unlocked).toContain('These walls close in a room')
  expect(unlocked).toContain('Locking this room holds the surrounding walls')
  expect(unlocked).toContain('Unlocked')
  expect(unlocked).toContain('aria-pressed="false"')

  plannerStore.actions.setEnclosureLocked(space.key, true)
  const locked = renderToStaticMarkup(<Inspector />)

  expect(locked).toContain('Locked')
  expect(locked).toContain('aria-pressed="true"')
})

it('shows floor details without room transforms or a conversion step', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  const html = renderToStaticMarkup(<Inspector />)
  expect(html).toContain('value="Room 1"')
  expect(html).not.toContain('Convert to walls')
  expect(html).not.toContain('Rotate 90°')
  expect(html).not.toContain('Swap width and height')
})
