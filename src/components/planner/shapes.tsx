import { openingEnds, pointOnWall, wallAt } from '#/lib/planner/openings.ts'
import { WALL_THICKNESS } from '#/lib/planner/walls.ts'

import type { Furniture, Opening, Point, Room } from '#/lib/planner/types.ts'
import type { Span, Wall } from '#/lib/planner/openings.ts'

/** A wall never thins below this on screen, however far the plan is zoomed out. */
const MIN_WALL_PX = 2

/** How thick a wall should be drawn at this zoom, in world centimetres. */
function wallWidth(scale: number): number {
  return Math.max(WALL_THICKNESS, MIN_WALL_PX / scale)
}

/**
 * A room's floor: the polygon its wall centrelines enclose, filled so it
 * occludes the grid and so the room's interior is what a click lands on.
 *
 * The walls are not drawn here. They belong to the plan rather than to any one
 * room — the wall between two rooms is a single wall — so they go down in one
 * pass of their own, over every floor.
 */
export function RoomFloor({
  room,
  selected,
  onPointerDown,
}: {
  room: Room
  selected: boolean
  onPointerDown: (event: React.PointerEvent) => void
}) {
  return (
    <polygon
      points={room.points.map((p) => `${p.x},${p.y}`).join(' ')}
      className={`cursor-move ${selected ? 'fill-muted' : 'fill-background'}`}
      stroke="none"
      onPointerDown={onPointerDown}
    />
  )
}

/**
 * The walls of one room, stroked at the wall's own thickness in world units so
 * that the band straddles the centreline. Two rooms sitting flush lay identical
 * bands over each other and come out as the one wall they share; nothing has to
 * be merged for that to happen, which is the whole reason walls are drawn this
 * way rather than as outlines.
 *
 * Butt caps, so an opening's gap is cut square at its jambs rather than being
 * closed back up by the cap, and mitred joins so corners come to a point.
 */
export function RoomWalls({ d, scale }: { d: string; scale: number }) {
  return (
    <path
      d={d}
      fill="none"
      className="stroke-foreground"
      strokeWidth={wallWidth(scale)}
      strokeLinejoin="miter"
      strokeMiterlimit={8}
      strokeLinecap="butt"
    />
  )
}

/**
 * The stretches of a selected room's walls that a neighbour also owns, laid
 * over the wall in outline. This is the plan saying which rooms are joined:
 * without it a party wall looks exactly like a wall that happens to have
 * another room behind it.
 */
export function SharedWalls({
  room,
  spans,
  scale,
}: {
  room: Room
  spans: Array<{ wall: number; span: Span }>
  scale: number
}) {
  return (
    <g className="pointer-events-none">
      {spans.map(({ wall, span }, i) => {
        const frame = wallAt(room.points, wall)
        if (!frame) return null
        const a = pointOnWall(frame, span[0])
        const b = pointOnWall(frame, span[1])
        return (
          <line
            key={`${wall}-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-snap"
            strokeWidth={wallWidth(scale)}
            strokeLinecap="butt"
            opacity={0.55}
          />
        )
      })}
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

/**
 * The symbols are all sized off the wall itself, so that they read as things
 * cut into a wall with body rather than as marks laid beside a line: the jamb
 * tick spans the wall's full thickness, the glazing lines carry its two faces
 * across the gap, and a sliding panel stands clear on the far side of one.
 */
const JAMB = WALL_THICKNESS
const PANE = WALL_THICKNESS / 2
const SLIDE = WALL_THICKNESS

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
          <Segment from={start} to={end} />
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
