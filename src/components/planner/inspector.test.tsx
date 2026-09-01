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
