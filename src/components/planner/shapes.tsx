import {
  openingEnds,
  pointOnWall,
  roomWallAt,
  wallSegments,
} from '#/lib/planner/openings.ts'
import { WALL_THICKNESS } from '#/lib/planner/walls.ts'

import type { CSSProperties, ReactElement } from 'react'
import type {
  Furniture,
  FurnitureKind,
  Opening,
  Point,
  Room,
} from '#/lib/planner/types.ts'
import type { Span, Wall } from '#/lib/planner/openings.ts'
import type { Enclosure } from '#/lib/planner/enclosures.ts'

/** A wall never thins below this on screen, however far the plan is zoomed out. */
const MIN_WALL_PX = 2

/** How thick a wall should be drawn at this zoom, in world centimetres. */
function wallWidth(scale: number): number {
  return Math.max(WALL_THICKNESS, MIN_WALL_PX / scale)
}

/**
 * How much of a chosen colour survives into a fill. A plan is read off its
 * outlines, its glyphs and the names written over them, and a solid fill buries
 * all three; a wash leaves them legible while still saying across the whole
 * plan, at a glance, which things go together. A floor is washed thinner than
 * an object because it covers so much more paper.
 */
const ROOM_WASH = 0.13
const ITEM_WASH = 0.2

/** Thinner again for a footprint others may stand on, so both stay readable. */
const SOFT_WASH = 0.11

/** The colour laid on as a fill only, for a shape that draws no edge of its own. */
function wash(color: string, alpha: number): CSSProperties {
  return { fill: color, fillOpacity: alpha }
}

/**
 * A coloured thing on the plan: the colour at full strength on every line it
 * draws — its edge and its glyph — and the same colour washed almost back to
 * the paper behind them.
 */
function inked(color: string, alpha: number): CSSProperties {
  return { stroke: color, ...wash(color, alpha) }
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
  if (room.closed === false) return null
  const points = room.points.map((p) => `${p.x},${p.y}`).join(' ')

  if (!room.color) {
    return (
      <polygon
        points={points}
        className={`cursor-move ${selected ? 'fill-muted' : 'fill-background'}`}
        stroke="none"
        onPointerDown={onPointerDown}
      />
    )
  }

  // Two coats: the paper first, so the grid stays covered whatever the wash is
  // thinned to, and the colour over it. A room takes no outline of its own —
  // the wall is its edge, and it is drawn later, in one pass over every floor.
  return (
    <g className="cursor-move" onPointerDown={onPointerDown}>
      <polygon points={points} className="fill-background" stroke="none" />
      <polygon
        points={points}
        style={wash(room.color, ROOM_WASH)}
        stroke="none"
      />
    </g>
  )
}

/**
 * The floor of a space the walls close in that was never drawn as a room.
 *
 * Drawn exactly as a room's floor is, because it is one — a space walled in
 * against a wall that was already there is a room, whatever order its walls
 * happened to be drawn in. What is different is only what it does when nobody
 * has named it yet: it is washed the faintest amount in the accent, which is
 * the plan saying *there is a room here* to someone who has not noticed that
 * their walls closed. Naming it settles it down into an ordinary floor.
 */
export function EnclosureFloor({
  enclosure,
  selected = false,
  /** False on a plan being printed or exported, which has nobody to prompt. */
  hint = true,
  onPointerDown,
}: {
  enclosure: Enclosure
  selected?: boolean
  hint?: boolean
  onPointerDown?: (event: React.PointerEvent) => void
}) {
  const points = enclosure.points.map((p) => `${p.x},${p.y}`).join(' ')
  const color = enclosure.space?.color

  return (
    <g
      className={onPointerDown && 'cursor-pointer'}
      onPointerDown={onPointerDown}
    >
      <polygon
        points={points}
        className={selected ? 'fill-muted' : 'fill-background'}
        stroke="none"
      />
      {color ? (
        <polygon points={points} style={wash(color, ROOM_WASH)} stroke="none" />
      ) : (
        hint &&
        !enclosure.space && (
          <polygon
            points={points}
            className="fill-snap"
            fillOpacity={0.08}
            stroke="none"
          />
        )
      )}
    </g>
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
        const frame = roomWallAt(room, wall)
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

/**
 * The one wall the pointer has hold of, laid over the wall in the selection
 * colour at the wall's own thickness so that what is selected is the wall
 * itself rather than the little bar in the middle of it.
 *
 * Cut at the jambs like the wall underneath, because a doorway is a hole and
 * selecting the wall does not fill it back in.
 */
export function SelectedWall({
  room,
  index,
  gaps,
  scale,
}: {
  room: Room
  index: number
  /** What is cut through this wall: the doorways and windows. */
  gaps: Array<Span>
  scale: number
}) {
  const frame = roomWallAt(room, index)
  if (!frame) return null
  return (
    <g className="pointer-events-none">
      {wallSegments(frame, gaps).map(([a, b], i) => (
        <line
          key={i}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          className="stroke-selection"
          strokeWidth={wallWidth(scale)}
          strokeLinecap="butt"
        />
      ))}
    </g>
  )
}

type FurnitureShapeProps = {
  item: Furniture
  selected: boolean
  onPointerDown: (event: React.PointerEvent) => void
}

/**
 * One piece of furniture: its footprint, and the glyph that says what it is.
 *
 * A colour is worn on the edge and washed out inside it, so that the outline,
 * the glyph and the name over it all keep reading — and so that a plan with a
 * colour on every object still looks like a drawing rather than a chart. The
 * paper coat under the wash is what keeps the grid, and anything else beneath,
 * from showing through a colour that is mostly transparent.
 *
 * A footprint that does not collide — a rug, say — skips that coat and is
 * washed thinner still: things are meant to stand on it and be seen doing so.
 */
export function FurnitureShape({
  item,
  selected,
  onPointerDown,
}: FurnitureShapeProps) {
  const left = item.x - item.w / 2
  const top = item.y - item.h / 2
  const Glyph = FURNITURE_GLYPHS[item.kind]
  const soft = item.collides === false
  const box = { x: left, y: top, width: item.w, height: item.h }

  return (
    <g
      transform={`rotate(${item.rotation} ${item.x} ${item.y})`}
      className={
        item.color
          ? 'cursor-move'
          : `stroke-foreground cursor-move ${soft ? 'fill-muted/40' : 'fill-background'}`
      }
      style={
        item.color ? inked(item.color, soft ? SOFT_WASH : ITEM_WASH) : undefined
      }
      strokeWidth={selected ? 2.25 : 1.25}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      onPointerDown={onPointerDown}
    >
      {item.color && !soft && (
        <rect {...box} className="fill-background" stroke="none" />
      )}
      <rect {...box} strokeDasharray={soft ? '6 4' : undefined} />
      <Glyph left={left} top={top} w={item.w} h={item.h} />
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

/**
 * How an upholstered arm, a back and a seat cushion actually measure, in
 * centimetres. Drawing them at their own size rather than at a fraction of the
 * footprint is what makes a suite come out looking like a suite: a sofa, a
 * loveseat and a chair from one collection get the same arms and the same back,
 * and differ only in how many cushions fit between the arms — which is the one
 * thing that really does differ between them.
 */
const ARM_CM = 22
const BACK_CM = 22
const CUSHION_CM = 60

/** A chair with this much of both dimensions is an armchair, not a dining one. */
const ARMCHAIR_CM = 70

/**
 * Upholstered seating facing "down": an arm down each side, the back laid
 * between them along the top edge, and the seat divided into cushions.
 *
 * The arm and the back thin down on a footprint too small to hold them at their
 * true size, so a seat is left however far the piece is dragged in.
 */
function SeatingGlyph({ left, top, w, h }: GlyphProps) {
  const arm = Math.min(ARM_CM, w * 0.25)
  const back = Math.min(BACK_CM, h * 0.3)
  const seat = w - arm * 2
  const cushions = Math.max(1, Math.round(seat / CUSHION_CM))

  return (
    <>
      <rect x={left + arm} y={top} width={seat} height={back} fill="none" />
      <rect x={left} y={top} width={arm} height={h} fill="none" />
      <rect x={left + w - arm} y={top} width={arm} height={h} fill="none" />
      {Array.from({ length: cushions - 1 }, (_, i) => {
        const x = left + arm + (seat * (i + 1)) / cushions
        return <line key={i} x1={x} y1={top + back} x2={x} y2={top + h} />
      })}
    </>
  )
}

/** Bed frame with pillows at the head and the duvet edge below them. */
function BedGlyph({ left, top, w, h }: GlyphProps) {
  const inset = Math.min(w, h) * 0.06
  const pillowGap = inset
  const pillowW = (w - inset * 2 - pillowGap) / 2
  const pillowH = Math.min(h * 0.2, pillowW * 0.6)
  return (
    <>
      <rect
        x={left + inset}
        y={top + inset}
        width={pillowW}
        height={pillowH}
        rx={inset}
        fill="none"
      />
      <rect
        x={left + inset + pillowW + pillowGap}
        y={top + inset}
        width={pillowW}
        height={pillowH}
        rx={inset}
        fill="none"
      />
      <line
        x1={left + inset}
        y1={top + inset + pillowH + inset}
        x2={left + w - inset}
        y2={top + inset + pillowH + inset}
      />
    </>
  )
}

/** A desk is read from its working edge and shallow cable tray. */
function DeskGlyph({ left, top, w, h }: GlyphProps) {
  const inset = Math.min(w, h) * 0.1
  return (
    <>
      <rect
        x={left + inset}
        y={top + inset}
        width={w - inset * 2}
        height={h - inset * 2}
        fill="none"
      />
      <line
        x1={left + w * 0.3}
        y1={top + inset}
        x2={left + w * 0.7}
        y2={top + inset}
      />
    </>
  )
}

/**
 * A chair, of whichever sort its footprint says it is. An armchair belongs to
 * the same family as the sofa it is bought beside and is drawn as one seat of
 * it; below that size a chair is a dining chair, and is only a seat and a back.
 */
function ChairGlyph(props: GlyphProps): ReactElement {
  if (props.w >= ARMCHAIR_CM && props.h >= ARMCHAIR_CM)
    return <SeatingGlyph {...props} />

  const { left, top, w, h } = props
  const inset = Math.min(w, h) * 0.14
  return (
    <>
      <rect
        x={left + inset}
        y={top + inset * 1.7}
        width={w - inset * 2}
        height={h - inset * 2.7}
        fill="none"
      />
      <line
        x1={left + inset}
        y1={top + inset}
        x2={left + w - inset}
        y2={top + inset}
      />
    </>
  )
}

/** Dresser drawers, kept abstract enough to resize cleanly. */
function DresserGlyph({ left, top, w, h }: GlyphProps) {
  return (
    <>
      {[1, 2].map((row) => (
        <line
          key={row}
          x1={left}
          y1={top + (h * row) / 3}
          x2={left + w}
          y2={top + (h * row) / 3}
        />
      ))}
      {[1, 3, 5].map((row) => (
        <line
          key={row}
          x1={left + w * 0.46}
          y1={top + (h * row) / 6}
          x2={left + w * 0.54}
          y2={top + (h * row) / 6}
        />
      ))}
    </>
  )
}

/** A screen seen from above, with its central stand. */
function TvGlyph({ left, top, w, h }: GlyphProps) {
  return (
    <>
      <line
        x1={left + w * 0.08}
        y1={top + h * 0.25}
        x2={left + w * 0.92}
        y2={top + h * 0.25}
      />
      <line
        x1={left + w / 2}
        y1={top + h * 0.25}
        x2={left + w / 2}
        y2={top + h * 0.75}
      />
      <line
        x1={left + w * 0.4}
        y1={top + h * 0.75}
        x2={left + w * 0.6}
        y2={top + h * 0.75}
      />
    </>
  )
}

/**
 * A run of kitchen units with its back to the top edge. The counter itself is
 * only a rectangle, so what says kitchen is what stands on it: a sink at one
 * end and a four-ring hob at the other, drawn the way a plan draws them.
 */
function KitchenGlyph({ left, top, w, h }: GlyphProps) {
  const margin = Math.min(w, h) * 0.12
  const depth = h - margin * 2
  const bay = Math.min(w * 0.3, depth * 1.5)
  const midY = top + h / 2
  const sinkX = left + w * 0.27
  const hobX = left + w * 0.73
  const ring = Math.min(bay, depth) * 0.18
  return (
    <>
      <rect
        x={sinkX - bay / 2}
        y={top + margin}
        width={bay}
        height={depth}
        rx={margin}
        fill="none"
      />
      <circle cx={sinkX} cy={midY} r={ring * 0.45} fill="none" />
      {BURNERS.map(([dx, dy]) => (
        <circle
          key={`${dx},${dy}`}
          cx={hobX + dx * bay * 0.27}
          cy={midY + dy * depth * 0.27}
          r={ring}
          fill="none"
        />
      ))}
    </>
  )
}

/** Generic appliance with a front door, suited to a fridge, washer or dryer. */
function ApplianceGlyph({ left, top, w, h }: GlyphProps) {
  const radius = Math.min(w, h) * 0.28
  return (
    <>
      <circle cx={left + w / 2} cy={top + h / 2} r={radius} fill="none" />
      <line
        x1={left + w * 0.2}
        y1={top + h * 0.14}
        x2={left + w * 0.8}
        y2={top + h * 0.14}
      />
    </>
  )
}

/** Parallel fins make the shallow footprint read as a radiator. */
function RadiatorGlyph({ left, top, w, h }: GlyphProps) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((fin) => (
        <line
          key={fin}
          x1={left + (w * fin) / 6}
          y1={top + h * 0.2}
          x2={left + (w * fin) / 6}
          y2={top + h * 0.8}
        />
      ))}
    </>
  )
}

/** Structural column shown as its circular core inside the exact footprint. */
function ColumnGlyph({ left, top, w, h }: GlyphProps) {
  return (
    <circle
      cx={left + w / 2}
      cy={top + h / 2}
      r={Math.min(w, h) * 0.38}
      fill="none"
    />
  )
}

/** An inset bound edge distinguishes a rug without giving it solid depth. */
function RugGlyph({ left, top, w, h }: GlyphProps) {
  const inset = Math.min(w, h) * 0.06
  return (
    <rect
      x={left + inset}
      y={top + inset}
      width={w - inset * 2}
      height={h - inset * 2}
      rx={inset}
      fill="none"
    />
  )
}

/** The four corners of the hob, as unit offsets from its centre. */
const BURNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const

/**
 * Nothing at all, and on purpose. A box is whatever the plan needs it to be —
 * a fridge, a rug, a chimney breast, a crate of something in the way — so it is
 * given no symbol to be read as one thing rather than another. What it is comes
 * from the name written over it and the footprint it is dragged out to.
 */
function BoxGlyph(): ReactElement {
  return <></>
}

/**
 * One glyph per kind, so a kind cannot reach the plan wearing another's face.
 * The box is the one blank in here, and its comment says why.
 */
const FURNITURE_GLYPHS: Record<
  FurnitureKind,
  (props: GlyphProps) => ReactElement
> = {
  table: TableGlyph,
  sofa: SeatingGlyph,
  bed: BedGlyph,
  desk: DeskGlyph,
  chair: ChairGlyph,
  dresser: DresserGlyph,
  tv: TvGlyph,
  kitchen: KitchenGlyph,
  appliance: ApplianceGlyph,
  radiator: RadiatorGlyph,
  column: ColumnGlyph,
  rug: RugGlyph,
  box: BoxGlyph,
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

/** The quarter disc a leaf sweeps, filled, for the pointer to land in. */
function sector(
  hinge: Point,
  jamb: Point,
  towards: Point,
  length: number,
): string {
  const tip = step(hinge, towards, length)
  const cross =
    (tip.x - hinge.x) * (jamb.y - hinge.y) -
    (tip.y - hinge.y) * (jamb.x - hinge.x)
  return (
    `M${hinge.x},${hinge.y} L${tip.x},${tip.y} ` +
    `A${length},${length} 0 0 ${cross > 0 ? 1 : 0} ${jamb.x},${jamb.y} Z`
  )
}

/**
 * What a click on an opening lands in: the whole of the ground its symbol
 * covers, not just the gap in the wall. A door is mostly the quarter disc it
 * swings through — the biggest thing about it on the page, and the part a hand
 * reaches for — so that sweep is filled here and takes the pointer too.
 *
 * All of it is invisible, and all of it is kept below the furniture: a sofa
 * standing in a doorway's swing still takes its own clicks.
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
  const { start, end, centre, width } = openingEnds(wall, opening)
  const across = wall.normal
  const towards =
    opening.swing === 'out' ? across : { x: -across.x, y: -across.y }
  const hinged = opening.hinge === 'start' ? start : end
  const latch = opening.hinge === 'start' ? end : start
  const panel = [
    start,
    end,
    step(end, towards, SLIDE),
    step(start, towards, SLIDE),
  ]

  return (
    <g
      fill="transparent"
      stroke="transparent"
      className="cursor-move"
      onPointerDown={onPointerDown}
    >
      {/* The gap itself, always: a window or a cased opening is only this. */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        strokeWidth={14}
        strokeLinecap="round"
        {...CRISP}
      />
      {opening.kind === 'door' && (
        <path d={sector(hinged, latch, towards, width)} />
      )}
      {opening.kind === 'double-door' && (
        <>
          <path d={sector(start, centre, towards, width / 2)} />
          <path d={sector(end, centre, towards, width / 2)} />
        </>
      )}
      {opening.kind === 'sliding-door' && (
        <polygon points={panel.map((p) => `${p.x},${p.y}`).join(' ')} />
      )}
    </g>
  )
}
