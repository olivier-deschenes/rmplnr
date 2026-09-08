import { beforeEach, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Inspector } from './inspector.tsx'

import { plannerStore } from '#/lib/planner/store.ts'
import { freeEnclosures } from '#/lib/planner/enclosures.ts'

import type { Project } from '#/lib/planner/types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

function plan(): Project {
  return {
    id: PLAN,
    name: 'Plan 1',
    rooms: [],
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
  const room = plannerStore.state.rooms[0]
  plannerStore.actions.select({ type: 'wall', id: room.id, index: 0 })

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
  const room = plannerStore.state.rooms[0]
  plannerStore.actions.select({ type: 'wall', id: room.id, index: 0 })

  // A room has no wall to give up: it would stop being a room.
  const asRoom = renderToStaticMarkup(<Inspector />)

  expect(asRoom).not.toContain('Remove wall')
  expect(asRoom).toContain('convert the room to walls first')

  plannerStore.actions.convertRoomToWalls(room.id)
  plannerStore.actions.select({ type: 'wall', id: room.id, index: 0 })
  const unlocked = renderToStaticMarkup(<Inspector />)

  expect(unlocked).toContain('Remove wall')
  expect(unlocked).not.toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Remove wall 1 of Walls 1"/,
  )

  plannerStore.actions.setRoomLocked(room.id, true)

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
  const { rooms, spaces } = plannerStore.state
  const space = freeEnclosures(rooms, spaces)[0]
  plannerStore.actions.select({ type: 'enclosure', id: space.key })

  const unlocked = renderToStaticMarkup(<Inspector />)

  expect(unlocked).toContain('These walls close in a room')
  expect(unlocked).toContain('Locking it holds every run of walls around it')
  expect(unlocked).toContain('Unlocked')
  expect(unlocked).toContain('aria-pressed="false"')

  plannerStore.actions.setEnclosureLocked(space.key, true)
  const locked = renderToStaticMarkup(<Inspector />)

  expect(locked).toContain('Locked')
  expect(locked).toContain('aria-pressed="true"')
})

it('offers to convert a room to the walls it was drawn as', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  const room = plannerStore.state.rooms[0]
  plannerStore.actions.select({ type: 'room', id: room.id })

  expect(renderToStaticMarkup(<Inspector />)).toContain('Convert to walls')

  // Converting is a change to the outline, and the padlock holds those.
  plannerStore.actions.setRoomLocked(room.id, true)

  expect(renderToStaticMarkup(<Inspector />)).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Convert Room 1 to walls"/,
  )
})

it('offers room rotation controls and holds them while the room is locked', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.beginRect({ x: 0, y: 0 })
  plannerStore.actions.updateRect({ x: 400, y: 300 })
  plannerStore.actions.commitRect()
  plannerStore.actions.setRoomLocked(plannerStore.state.rooms[0].id, true)

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
  plannerStore.actions.setRoomLocked(plannerStore.state.rooms[0].id, true)

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
  plannerStore.actions.setUnits('imperial-inches')
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

it('offers the style brush on furniture, and says what it is doing once picked up', () => {
  plannerStore.actions.openProject(PLAN)
  plannerStore.actions.addFurniture('sofa')
  const item = plannerStore.state.furniture[0]

  expect(renderToStaticMarkup(<Inspector />)).toContain(
    'Copy color to furniture',
  )

  plannerStore.actions.pickUpStyle(item.id)
  const armed = renderToStaticMarkup(<Inspector />)

  expect(armed).toContain('Painting — click furniture')
  expect(armed).toContain('aria-pressed="true"')
  expect(armed).toContain('Double-click the brush to paint several.')

  plannerStore.actions.pickUpStyle(item.id, true)

  expect(renderToStaticMarkup(<Inspector />)).toContain(
    'Escape puts the brush down.',
  )
})

for (const [units, label, width, depth] of [
  ['imperial', 'ft + in', '4 ft 11.06 in', '6 ft 6.74 in'],
  ['metric-mixed', 'm + cm', '1 m 50 cm', '2 m 0 cm'],
] as const) {
  it(`uses ${label} in every furniture measurement input`, () => {
    plannerStore.actions.openProject(PLAN)
    plannerStore.actions.setUnits(units)
    plannerStore.actions.addFurniture('bed')
    const html = renderToStaticMarkup(<Inspector />)
    for (const name of ['Width', 'Depth', 'X', 'Y']) {
      expect(html).toContain(`${name} ${label}`)
    }
    expect(html).toContain(`value="${width}"`)
    expect(html).toContain(`value="${depth}"`)
  })
}
