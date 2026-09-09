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

/** A 400 x 300 room with one box standing in the middle of it. */
function room() {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  // Dropped at the view centre, which a headless render puts outside the room:
  // it is stood in the middle by hand, with nothing settling it on the way.
  plannerStore.actions.setCollide(false)
  plannerStore.actions.addFurniture('box')
  const item = plannerStore.state.furniture[0]
  plannerStore.actions.updateFurniture(item.id, {
    x: 200,
    y: 150,
    w: 100,
    h: 60,
  })
  plannerStore.actions.setCollide(true)
  return { run: plannerStore.state.walls[0], item }
}

it('measures the room left on every side of a piece of furniture', () => {
  const { item } = room()
  plannerStore.actions.select({ type: 'furniture', id: item.id })

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('Gaps')
  // Named as they lie on the page, so the panel and the drawing agree — and
  // named by the direction alone, the unit being said once over the group.
  const labels = [...html.matchAll(/text-xs">([^<]*)</g)].map((m) => m[1])
  expect(labels).toContain('cm')
  expect(labels.filter((label) => /^(Left|Right|Up|Down)/.test(label))).toEqual(
    ['Left', 'Right', 'Up', 'Down'],
  )
  expect(html).toContain('Type a distance to move this')
})

/*
  A field a reader is aiming at must not move. Gaps are measured in the item's
  own frame, so turning it deals them out in a different order; the panel puts
  them back in the same cells.
*/
it('keeps each gap in its place when the item is turned', () => {
  const { item } = room()
  plannerStore.actions.select({ type: 'furniture', id: item.id })
  const order = (html: string) =>
    [...html.matchAll(/text-xs">([^<]*)</g)]
      .map((m) => m[1])
      .filter((label) => /^(Left|Right|Up|Down)/.test(label))

  const upright = order(renderToStaticMarkup(<Inspector />))

  plannerStore.actions.updateFurniture(item.id, { rotation: 90 })

  expect(order(renderToStaticMarkup(<Inspector />))).toEqual(upright)
})

/*
  Every other field in the panel is named by a noun and carries its unit as a
  suffix. A gap is named by the way it runs, and "Left ft + in" is not English.
*/
it('does not hang a unit off the end of a direction', () => {
  const { item } = room()
  plannerStore.actions.setUnits('imperial')
  plannerStore.actions.select({ type: 'furniture', id: item.id })

  const html = renderToStaticMarkup(<Inspector />)

  expect(html).toContain('Width ft + in')
  for (const side of ['Left', 'Right', 'Up', 'Down']) {
    expect(html).not.toContain(`${side} ft + in`)
  }
})

it('measures across a selected wall, and holds the fields while it is locked', () => {
  const { run } = room()
  plannerStore.actions.select({ type: 'wall', id: run.id, index: 0 })

  const unlocked = renderToStaticMarkup(<Inspector />)

  expect(unlocked).toContain('Gaps')
  expect(unlocked).toContain('Type a distance to move this')

  plannerStore.actions.setRunLocked(run.id, true)
  const locked = renderToStaticMarkup(<Inspector />)

  // The numbers stay readable; only the invitation to change them goes.
  expect(locked).toContain('Gaps')
  expect(locked).not.toContain('Type a distance to move this')
})

it('says nothing about gaps where there are none to report', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.addFurniture('box')
  plannerStore.actions.select({
    type: 'furniture',
    id: plannerStore.state.furniture[0].id,
  })

  // Nothing has been drawn for the box to stand next to.
  expect(renderToStaticMarkup(<Inspector />)).not.toContain('Gaps')
})
