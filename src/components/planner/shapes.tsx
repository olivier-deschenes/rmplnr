import { openingEnds, outlinePath } from '#/lib/planner/openings.ts'

import type { Furniture, Opening, Point, Room } from '#/lib/planner/types.ts'
import type { Wall } from '#/lib/planner/openings.ts'

type RoomShapeProps = {
  room: Room
  /** This room's openings, which are cut out of the walls drawn here. */
  openings: Array<Opening>
  selected: boolean
  onPointerDown: (event: React.PointerEvent) => void
}

/**
 * A room is a filled polygon so its floor occludes the grid and its interior is
 * clickable, with the walls stroked over it as a separate path: they carry the
 * heaviest line in the drawing, and they are the part a door has to interrupt.
 */
export function RoomShape({
  room,
  openings,
  selected,
  onPointerDown,
}: RoomShapeProps) {
  return (
    <g onPointerDown={onPointerDown} className="cursor-move">
      <polygon
        points={room.points.map((p) => `${p.x},${p.y}`).join(' ')}
        className="fill-background"
        stroke="none"
      />
      <path
        d={outlinePath(room.points, openings)}
        fill="none"
        className="stroke-foreground"
        strokeWidth={selected ? 3 : 2}
        strokeLinejoin="round"
        strokeLinecap="square"
        vectorEffect="non-scaling-stroke"
      />
    </g>
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

// --- openings ---------------------------------------------------------------

/** Length of the tick drawn across a wall at each jamb, in centimetres. */
const JAMB = 12
/** How far a window's glazing sits either side of the wall line. */
const PANE = 4
/** How far a sliding panel stands off the wall it runs along. */
const SLIDE = 8

/**
 * `vector-effect` is not an inherited property, so every stroked element has to
 * ask for it in turn: without it the symbols would fatten up with the zoom.
 */
const CRISP = { vectorEffect: 'non-scaling-stroke' } as const

function step(p: Point, dir: Point, by: number): Point {
  return { x: p.x + dir.x * by, y: p.y + dir.y * by }
}

function Segment({ from, to }: { from: Point; to: Point }) {
  return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} {...CRISP} />
}

/** The tick standing across the wall where an opening stops. */
function Jamb({ at, across }: { at: Point; across: Point }) {
  return (
    <Segment
      from={step(at, across, -JAMB / 2)}
      to={step(at, across, JAMB / 2)}
    />
  )
}

/**
 * The quarter circle a door leaf sweeps, from the open leaf round to the jamb
 * it shuts against. Which way round SVG draws it follows from which side of the
 * leaf the jamb lies on.
 */
function Swing({
  hinge,
  tip,
  jamb,
  radius,
}: {
  hinge: Point
  tip: Point
  jamb: Point
  radius: number
}) {
  const cross =
    (tip.x - hinge.x) * (jamb.y - hinge.y) -
    (tip.y - hinge.y) * (jamb.x - hinge.x)
  return (
    <path
      d={`M${tip.x},${tip.y} A${radius},${radius} 0 0 ${cross > 0 ? 1 : 0} ${jamb.x},${jamb.y}`}
      className="stroke-foreground/45"
      {...CRISP}
    />
  )
}

/** A leaf standing open at right angles to its wall, and the arc it sweeps. */
function Leaf({
  hinge,
  jamb,
  towards,
  length,
}: {
  hinge: Point
  jamb: Point
  towards: Point
  length: number
}) {
  const tip = step(hinge, towards, length)
  return (
    <>
      <Segment from={hinge} to={tip} />
      <Swing hinge={hinge} tip={tip} jamb={jamb} radius={length} />
    </>
  )
}

type OpeningShapeProps = {
  opening: Opening
  wall: Wall
  selected?: boolean
  /** Half-drawn, for the opening the pointer is about to place. */
  ghost?: boolean
}

/**
 * The symbol an opening draws in the gap it has already made in the wall: a
 * plain pair of jambs for a cased opening, glazing for a window, and for a door
 * the leaf and the arc it swings through — the piece that says whether it will
 * foul the furniture next to it.
 */
export function OpeningShape({
  opening,
  wall,
  selected,
  ghost,
}: OpeningShapeProps) {
  const { start, end, centre, width } = openingEnds(wall, opening)
  const along = wall.tangent
  const across = wall.normal
  // Doors open into the room unless they are told otherwise; the wall's normal
  // faces the other way, out of it.
  const towards =
    opening.swing === 'out' ? across : { x: -across.x, y: -across.y }

  const hinged = opening.hinge === 'start' ? start : end
  const latch = opening.hinge === 'start' ? end : start

  return (
    <g
      className={`stroke-foreground fill-none ${ghost ? 'opacity-40' : ''}`}
      strokeWidth={selected ? 2.5 : 1.5}
      strokeLinecap="round"
    >
      <Jamb at={start} across={across} />
      <Jamb at={end} across={across} />

      {opening.kind === 'window' && (
        <>
          <Segment
            from={step(start, across, PANE)}
            to={step(end, across, PANE)}
          />
          <Segment
            from={step(start, across, -PANE)}
            to={step(end, across, -PANE)}
          />
        </>
      )}

      {opening.kind === 'door' && (
        <Leaf hinge={hinged} jamb={latch} towards={towards} length={width} />
      )}

      {opening.kind === 'double-door' && (
        <>
          <Leaf
            hinge={start}
            jamb={centre}
            towards={towards}
            length={width / 2}
          />
          <Leaf
            hinge={end}
            jamb={centre}
            towards={towards}
            length={width / 2}
          />
        </>
      )}

      {opening.kind === 'sliding-door' && (
        <>
          {/* One panel on the wall line and the other standing off it, the two
              overlapping in the middle: a pair that slides past itself. */}
          <Segment from={start} to={step(centre, along, width * 0.06)} />
          <Segment
            from={step(step(centre, along, -width * 0.06), towards, SLIDE)}
            to={step(end, towards, SLIDE)}
          />
        </>
      )}
    </g>
  )
}

/**
 * The band a click on an opening lands in. It is invisible and is kept below
 * the furniture, so a sofa pushed against a window still takes its own clicks.
 */
export function OpeningTarget({
  opening,
  wall,
  onPointerDown,
}: {
  opening: Opening
  wall: Wall
  onPointerDown: (event: React.PointerEvent) => void
}) {
  const { start, end } = openingEnds(wall, opening)
  return (
    <line
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
      className="stroke-transparent cursor-move"
      strokeWidth={14}
      strokeLinecap="round"
      {...CRISP}
      onPointerDown={onPointerDown}
    />
  )
}
