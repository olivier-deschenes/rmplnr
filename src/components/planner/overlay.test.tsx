import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WallDimensions } from './overlay.tsx'

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
