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

  // The colour outlines the object and only tints what it encloses, so the
  // outline, the glyph and the label over it all survive it.
  expect(room).toContain('fill:#f59e0b')
  expect(room).toContain('fill-opacity:0.13')
  expect(furniture).toContain('stroke:#0ea5e9')
  expect(furniture).toContain('fill:#0ea5e9')
  expect(furniture).toContain('fill-opacity:0.2')
})

it('backs a coloured floor and footprint with paper, so nothing shows through', () => {
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

  expect(room.match(/<polygon/g)).toHaveLength(2)
  expect(room).toContain('fill-background')
})

it('washes a footprint others may stand on thinner, and lays no paper under it', () => {
  const rug = renderToStaticMarkup(
    <svg>
      <FurnitureShape
        item={{
          id: 'rug-1',
          kind: 'rug',
          name: 'Rug',
          color: '#0ea5e9',
          x: 50,
          y: 50,
          w: 200,
          h: 140,
          rotation: 0,
          collides: false,
        }}
        selected={false}
        onPointerDown={() => {}}
      />
    </svg>,
  )

  expect(rug).toContain('fill-opacity:0.11')
  expect(rug).not.toContain('fill-background')
  expect(rug).toContain('stroke-dasharray="6 4"')
})

/** One piece of a suite, on the plan, at the size the shop gives it in cm. */
function seat(kind: 'sofa' | 'chair', w: number, h: number) {
  return renderToStaticMarkup(
    <svg>
      <FurnitureShape
        item={{
          id: `${kind}-${w}`,
          kind,
          name: kind,
          x: 0,
          y: 0,
          w,
          h,
          rotation: 0,
        }}
        selected={false}
        onPointerDown={() => {}}
      />
    </svg>,
  )
}

/** How many seat cushions a glyph divided its seat into. */
function cushions(markup: string): number {
  return (markup.match(/<line/g)?.length ?? 0) + 1
}

/** Whether a piece drew arms: a band the full depth of the footprint. */
function hasArms(markup: string, depth: number): boolean {
  return markup.includes(`width="22" height="${depth}"`)
}

it('draws a suite with one set of arms, however wide the piece is', () => {
  // A sofa, a loveseat and an armchair from the same collection: the frame is
  // the same on all three, and only the number of cushions tells them apart.
  const sofa = seat('sofa', 226, 102)
  const loveseat = seat('sofa', 163, 102)
  const armchair = seat('chair', 99, 102)

  for (const piece of [sofa, loveseat, armchair]) {
    expect(hasArms(piece, 102)).toBe(true)
    expect(piece).toContain('height="22"')
  }

  expect(cushions(sofa)).toBe(3)
  expect(cushions(loveseat)).toBe(2)
  expect(cushions(armchair)).toBe(1)
})

it('keeps a dining chair a dining chair', () => {
  // Small enough to be pulled up to a table: a seat and a back, no arms.
  const chair = seat('chair', 50, 50)

  expect(hasArms(chair, 50)).toBe(false)
})

it('thins a suite frame rather than swallowing the seat it sits round', () => {
  const tiny = seat('sofa', 40, 30)

  expect(tiny).toContain('width="10"')
  expect(tiny).toContain('height="9"')
})
