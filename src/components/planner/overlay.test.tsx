import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FurnitureEditor, OpeningEditor, WallDimensions } from './overlay.tsx'

import type { Furniture, Opening, Viewport } from '#/lib/planner/types.ts'
import type { Wall } from '#/lib/planner/openings.ts'

const VIEWPORT: Viewport = { tx: 0, ty: 0, scale: 1 }

const ITEM: Furniture = {
  id: 'item-1',
  kind: 'table',
  name: 'Dining table',
  x: 200,
  y: 150,
  w: 160,
  h: 90,
  rotation: 0,
}

const WALL: Wall = {
  a: { x: 0, y: 0 },
  b: { x: 400, y: 0 },
  length: 400,
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: -1 },
}

const OPENING: Opening = {
  id: 'opening-1',
  kind: 'door',
  roomId: 'room-1',
  wall: 0,
  t: 0.5,
  width: 80,
  hinge: 'start',
  swing: 'in',
}

it('exposes a displayed wall measurement as a selectable control', () => {
  const html = renderToStaticMarkup(
    <svg>
      <WallDimensions
        labels={[
          {
            key: 'room-1:0',
            roomId: 'room-1',
            roomName: 'Living',
            wall: 0,
            text: '4.00 m',
            box: {
              centre: { x: 100, y: 20 },
              w: 48,
              h: 16,
              angle: 0,
            },
            leader: null,
          },
        ]}
        selected={{ roomId: 'room-1', wall: 0 }}
        onSelect={() => {}}
      />
    </svg>,
  )

  expect(html).toContain('role="button"')
  expect(html).toContain('aria-label="Edit wall 1 of Living, 4.00 m"')
  expect(html).toContain('aria-pressed="true"')
})

it('gives an item its resize and rotate handles only under the edit tool', () => {
  const furniture = (handles: boolean) =>
    renderToStaticMarkup(
      <svg>
        <FurnitureEditor
          item={ITEM}
          viewport={VIEWPORT}
          units="metric"
          avoid={[]}
          onHandleDown={handles ? () => {} : undefined}
          onRotateDown={handles ? () => {} : undefined}
        />
      </svg>,
    )

  const editing = furniture(true)
  expect(editing).toContain('cursor-grab')
  expect(editing).toContain('resize')

  // Under move there is nothing there to catch: no rotate handle on its stem
  // and none of the eight around the box.
  const moving = furniture(false)
  expect(moving).not.toContain('cursor-grab')
  expect(moving).not.toContain('resize')

  // What is left is what says which item is selected and how big it is, which
  // is worth knowing whether or not it can be changed from here.
  expect(moving).toContain('<polygon')
  expect(moving).toContain('160 × 90 cm')
})

it('gives an opening its jamb handles only under the edit tool', () => {
  const opening = (handles: boolean) =>
    renderToStaticMarkup(
      <svg>
        <OpeningEditor
          opening={OPENING}
          wall={WALL}
          viewport={VIEWPORT}
          units="metric"
          avoid={[]}
          onEndDown={handles ? () => {} : undefined}
        />
      </svg>,
    )

  expect(opening(true)).toContain('resize')
  expect(opening(false)).not.toContain('resize')
  // The width still reads out either way.
  expect(opening(false)).toContain('80')
})
