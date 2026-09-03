import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FurnitureShape, RoomFloor } from './shapes.tsx'

it('draws chosen colors on rooms and furniture', () => {
  const room = renderToStaticMarkup(
    <RoomFloor
      room={{
        id: 'room-1',
        name: 'Living room',
        color: '#f59e0b',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      }}
      selected={false}
      onPointerDown={() => {}}
    />,
  )
  const furniture = renderToStaticMarkup(
    <svg>
      <FurnitureShape
        item={{
          id: 'sofa-1',
          kind: 'sofa',
          name: 'Sofa',
          color: '#0ea5e9',
          x: 50,
          y: 50,
          w: 100,
          h: 50,
          rotation: 0,
        }}
        selected={false}
        onPointerDown={() => {}}
      />
    </svg>,
  )

  expect(room).toContain('fill:#f59e0b')
  expect(furniture).toContain('fill:#0ea5e9')
})
