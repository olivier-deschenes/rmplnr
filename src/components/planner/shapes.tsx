import type { Furniture, Room } from '#/lib/planner/types.ts'

type RoomShapeProps = {
  room: Room
  selected: boolean
  onPointerDown: (event: React.PointerEvent) => void
}

/**
 * A room is drawn as a filled polygon so its floor occludes the grid and its
 * interior is clickable. Walls carry the heaviest stroke in the drawing.
 */
export function RoomShape({ room, selected, onPointerDown }: RoomShapeProps) {
  return (
    <polygon
      points={room.points.map((p) => `${p.x},${p.y}`).join(' ')}
      className="fill-background stroke-foreground cursor-move"
      strokeWidth={selected ? 3 : 2}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      onPointerDown={onPointerDown}
    />
  )
}

type FurnitureShapeProps = {
  item: Furniture
  selected: boolean
  onPointerDown: (event: React.PointerEvent) => void
}

export function FurnitureShape({
  item,
  selected,
  onPointerDown,
}: FurnitureShapeProps) {
  const left = item.x - item.w / 2
  const top = item.y - item.h / 2

  return (
    <g
      transform={`rotate(${item.rotation} ${item.x} ${item.y})`}
      className="fill-background stroke-foreground cursor-move"
      strokeWidth={selected ? 2.25 : 1.25}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      onPointerDown={onPointerDown}
    >
      <rect x={left} y={top} width={item.w} height={item.h} />
      {item.kind === 'table' ? (
        <TableGlyph left={left} top={top} w={item.w} h={item.h} />
      ) : (
        <SofaGlyph left={left} top={top} w={item.w} h={item.h} />
      )}
    </g>
  )
}

type GlyphProps = { left: number; top: number; w: number; h: number }

/** Tabletop: an inset outline inside the footprint. */
function TableGlyph({ left, top, w, h }: GlyphProps) {
  const inset = Math.min(w, h) * 0.08
  return (
    <rect
      x={left + inset}
      y={top + inset}
      width={w - inset * 2}
      height={h - inset * 2}
      fill="none"
    />
  )
}

/** Sofa facing "down": backrest along the top edge, an arm on each side. */
function SofaGlyph({ left, top, w, h }: GlyphProps) {
  const back = h * 0.22
  const arm = w * 0.12
  return (
    <>
      <rect x={left} y={top} width={w} height={back} fill="none" />
      <rect x={left} y={top} width={arm} height={h} fill="none" />
      <rect x={left + w - arm} y={top} width={arm} height={h} fill="none" />
      <line
        x1={left + w / 2}
        y1={top + back}
        x2={left + w / 2}
        y2={top + h}
        fill="none"
      />
    </>
  )
}
