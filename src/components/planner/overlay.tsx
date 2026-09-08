import { useEffect, useRef, useState } from 'react'

import { Input } from '#/components/ui/input.tsx'

import {
  handlePosition,
  normalizeAngle,
  polygonArea,
  polygonCentroid,
  worldToScreen,
} from '#/lib/planner/geometry.ts'
import { formatArea, formatLength, formatSize } from '#/lib/planner/units.ts'
import {
  LABEL_HEIGHT,
  STEP,
  findSpot,
  textWidth,
  uprightAngle,
} from '#/lib/planner/dimensions.ts'
import {
  openingEnds,
  roomWallAt,
  wallCount,
  wallSegments,
} from '#/lib/planner/openings.ts'
import { HANDLES, HANDLE_DIR } from '#/lib/planner/types.ts'

import type {
  Furniture,
  Handle,
  Opening,
  Point,
  RectDraft,
  Room,
  Units,
  Viewport,
} from '#/lib/planner/types.ts'
import type { Box, NameLabel, WallLabel } from '#/lib/planner/dimensions.ts'
import type { Clearance } from '#/lib/planner/clearances.ts'
import type { Enclosure } from '#/lib/planner/enclosures.ts'
import type { Guide } from '#/lib/planner/snapping.ts'
import type { Span, Wall } from '#/lib/planner/openings.ts'

const HANDLE_SIZE = 8
const ROTATE_OFFSET = 26
/** How far the selection's size readout hangs below the item's bottom edge. */
const READOUT_GAP = 20

/** Square handle centred on a screen point. */
function Square({
  at,
  className,
  onPointerDown,
  size = HANDLE_SIZE,
}: {
  at: Point
  className?: string
  onPointerDown?: (event: React.PointerEvent) => void
  size?: number
}) {
  return (
    <rect
      x={at.x - size / 2}
      y={at.y - size / 2}
      width={size}
      height={size}
      className={`fill-background stroke-foreground ${className ?? ''}`}
      strokeWidth={1.5}
      onPointerDown={onPointerDown}
    />
  )
}

/**
 * How wide a band is laid over a wall for the pointer to take hold of it. The
 * canvas measures its double-clicks against the same number, so that breaking a
 * wall and pushing it are aimed at exactly the same strip of the plan.
 */
export const WALL_GRAB = 14
/** The handle in the middle of a wall, drawn as a bar lying along it. */
const BAR_LENGTH = 18
const BAR_THICKNESS = 5

/**
 * Handle shaped like the wall it pushes: a short bar lying along it. On the
 * selected wall it keeps its pale fill and takes the selection colour in its
 * outline, so that it still reads as a handle sitting on the coloured wall
 * rather than disappearing into it.
 */
function Bar({
  at,
  angle,
  length,
  selected = false,
  className,
  onPointerDown,
}: {
  at: Point
  angle: number
  length: number
  selected?: boolean
  className?: string
  onPointerDown?: (event: React.PointerEvent) => void
}) {
  return (
    <rect
      x={-length / 2}
      y={-BAR_THICKNESS / 2}
      width={length}
      height={BAR_THICKNESS}
      rx={BAR_THICKNESS / 2}
      transform={`translate(${at.x} ${at.y}) rotate(${angle})`}
      className={`fill-background ${selected ? 'stroke-selection' : 'stroke-foreground'} ${className ?? ''}`}
      strokeWidth={1.5}
      onPointerDown={onPointerDown}
    />
  )
}

const RESIZE_CURSORS = [
  'cursor-ew-resize',
  'cursor-nwse-resize',
  'cursor-ns-resize',
  'cursor-nesw-resize',
]

/** Pick a resize cursor that still points the right way once the item is rotated. */
function resizeCursor(dir: Point, rotation: number): string {
  const deg = normalizeAngle(
    (Math.atan2(dir.y, dir.x) * 180) / Math.PI + rotation,
  )
  return RESIZE_CURSORS[Math.round(deg / 45) % 4]
}

/**
 * How far a guide runs on past the things it lines up, in screen pixels. A room
 * that has gone flush buries the guide under the wall it just landed on, so the
 * overhang is the whole of what there is to see: it has to be worth seeing.
 */
const GUIDE_OVERHANG = 26

/**
 * The lines a room has just locked onto. They are drawn only while something is
 * being dragged, and they say what the drag found: this edge and that one are
 * now the same line, which is what it takes for two rooms to share a wall.
 */
export function SnapGuides({
  guides,
  viewport,
}: {
  guides: Array<Guide>
  viewport: Viewport
}) {
  return (
    <g className="pointer-events-none">
      {guides.map((guide) => {
        const along = (at: number): Point =>
          guide.axis === 'x'
            ? { x: guide.value, y: at }
            : { x: at, y: guide.value }
        const a = worldToScreen(along(guide.from), viewport)
        const b = worldToScreen(along(guide.to), viewport)
        const overhang =
          guide.axis === 'x'
            ? { x: 0, y: GUIDE_OVERHANG }
            : { x: GUIDE_OVERHANG, y: 0 }
        return (
          <line
            key={`${guide.axis}-${guide.value}`}
            x1={a.x - overhang.x}
            y1={a.y - overhang.y}
            x2={b.x + overhang.x}
            y2={b.y + overhang.y}
            className="stroke-snap"
            strokeWidth={1}
            strokeDasharray="5 4"
          />
        )
      })}
    </g>
  )
}

/** How long the tick closing each end of a clearance is, in pixels. */
const TICK = 7
/** Clear space either side of a number standing on its own line. */
const CLEARANCE_GAP = 6
/** Where along its line a number may sit, as a fraction of the room it has. */
const CLEARANCE_SLIDES = [0, 0.5, -0.5, 1, -1]

/**
 * How much room is left around the thing being moved, while it is being moved.
 *
 * Each gap is drawn the way a gap is drawn on a drawing: a line across it,
 * ticked at both ends, with the number written on the line itself — which is
 * also what keeps it legible, since the plate the number sits on breaks the
 * line rather than lying over it. Where something is already written there the
 * number slides along its own line to get clear, and a gap too narrow to hold
 * it at all has it written just past the far end, out in the open.
 *
 * Each number joins the list the next one keeps out of, so the four sides of a
 * cabinet in a tight corner never write over one another.
 */
export function Clearances({
  clearances,
  viewport,
  units,
  /** Boxes a number keeps off: what the plan already has written on it. */
  avoid,
}: {
  clearances: Array<Clearance>
  viewport: Viewport
  units: Units
  avoid: Array<Box>
}) {
  const taken = [...avoid]

  const drawn = clearances.map(({ key, from, to, distance }) => {
    const a = worldToScreen(from, viewport)
    const b = worldToScreen(to, viewport)
    const run = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const along = { x: (b.x - a.x) / run, y: (b.y - a.y) / run }
    const tick = { x: (-along.y * TICK) / 2, y: (along.x * TICK) / 2 }

    const text = formatLength(distance, units)
    const needed = textWidth(text) + CLEARANCE_GAP * 2
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    // How far the number can slide and still stand on the line it measures.
    const runway = Math.max(0, (run - needed) / 2)
    const centres = [
      ...(run >= needed
        ? CLEARANCE_SLIDES.map((slide) => ({
            x: mid.x + along.x * runway * slide,
            y: mid.y + along.y * runway * slide,
          }))
        : []),
      // The last resort, and the only place a hand-width gap can be written:
      // just past the far end, clear of the thing that is on the move.
      { x: b.x + along.x * (needed / 2), y: b.y + along.y * (needed / 2) },
    ]

    const angle = uprightAngle(along)
    const spot = findSpot(centres, text, angle, taken)
    const box: Box = spot?.box ?? {
      centre: centres[centres.length - 1],
      w: textWidth(text),
      h: LABEL_HEIGHT,
      angle,
    }
    taken.push(box)
    return { key, a, b, tick, text, box }
  })

  return (
    <g className="pointer-events-none">
      {drawn.map(({ key, a, b, tick, text, box }) => (
        <g key={key} className="stroke-muted-foreground" strokeWidth={1}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          {[a, b].map((end, i) => (
            <line
              key={i}
              x1={end.x - tick.x}
              y1={end.y - tick.y}
              x2={end.x + tick.x}
              y2={end.y + tick.y}
            />
          ))}
          <g stroke="none">
            <Plate box={box} text={text} />
          </g>
        </g>
      ))}
    </g>
  )
}

export function RoomLabels({
  rooms,
  viewport,
  units,
  /** The room whose name is being typed over, and so is not written here. */
  renaming,
}: {
  rooms: Array<Room>
  viewport: Viewport
  units: Units
  renaming?: string
}) {
  return (
    <g className="pointer-events-none">
      {rooms
        .filter((room) => room.closed !== false)
        .map((room) => {
          const at = worldToScreen(polygonCentroid(room.points), viewport)
          return (
            <g key={room.id} textAnchor="middle">
              {room.id !== renaming && (
                <text
                  x={at.x}
                  y={at.y}
                  className="fill-foreground text-[11px] font-medium"
                >
                  {room.name}
                </text>
              )}
              <text
                x={at.x}
                y={at.y + 14}
                className="fill-muted-foreground text-[10px]"
              >
                {formatArea(polygonArea(room.points), units)}
              </text>
            </g>
          )
        })}
    </g>
  )
}

/**
 * The same, for the spaces the walls close in that were never drawn as rooms.
 *
 * A space nobody has named yet says so, in the accent and in the words a
 * reader can act on. That line is doing a job the plan cannot do any other
 * way: the walls have closed, the editor knows it, and until the reader is
 * told, the only difference between a room and a space is which order somebody
 * happened to draw four walls in.
 */
export function EnclosureLabels({
  enclosures,
  viewport,
  units,
  /** The space whose name is being typed over, and so is not written here. */
  renaming,
  /** False on a plan being printed or exported, which has nobody to prompt. */
  hint = true,
}: {
  enclosures: Array<Enclosure>
  viewport: Viewport
  units: Units
  renaming?: string
  hint?: boolean
}) {
  return (
    <g className="pointer-events-none">
      {enclosures.map((enclosure) => {
        const at = worldToScreen(enclosure.centre, viewport)
        const named = enclosure.space !== null
        return (
          <g key={enclosure.key} textAnchor="middle">
            {enclosure.key !== renaming && (named || hint) && (
              <text
                x={at.x}
                y={at.y}
                className={
                  named
                    ? 'fill-foreground text-[11px] font-medium'
                    : 'fill-snap text-[11px] font-medium'
                }
              >
                {enclosure.space?.name ?? 'Unnamed room'}
              </text>
            )}
            <text
              x={at.x}
              y={at.y + 14}
              className="fill-muted-foreground text-[10px]"
            >
              {formatArea(enclosure.area, units)}
            </text>
            {hint && !named && enclosure.key !== renaming && (
              <text
                x={at.x}
                y={at.y + 27}
                className="fill-muted-foreground text-[9px]"
              >
                double-click to name
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/**
 * What each piece of furniture is called, written across it in the same hand a
 * room's name is written in, on a plate of its own so that the glyph underneath
 * — a sofa's seat line, a tabletop — never runs through the letters.
 *
 * Where each name goes is settled in `dimensions.ts`, along with everything
 * else the plan writes on itself. A name with nowhere to stand on its own item
 * is left off rather than spilled over the drawing: zooming in brings it back,
 * and the inspector says what the thing is called whatever the zoom.
 */
export function FurnitureLabels({
  labels,
  /** The item whose name is being typed over, and so is not written here. */
  renaming,
}: {
  labels: Array<NameLabel>
  renaming?: string
}) {
  return (
    <g className="pointer-events-none">
      {labels.map(
        ({ id, text, box }) =>
          id !== renaming && (
            <Plate
              key={id}
              box={box}
              text={text}
              className="fill-foreground text-[11px] font-medium"
            />
          ),
      )}
    </g>
  )
}

/** How much of the canvas a name is given to be typed in, in pixels. */
const FIELD_WIDTH = 150
const FIELD_HEIGHT = 32

/**
 * A name being typed over where it is written on the plan: a room's own label,
 * or the middle of a piece of furniture.
 *
 * The box is a real text field laid into the drawing, so the plan does not have
 * to grow a text editor of its own. What is typed is held here until it is
 * committed — pressing Enter, or clicking away — which keeps a rename to one
 * step to undo however many keystrokes went into it.
 */
export function NameEditor({
  at,
  value,
  onCommit,
  onCancel,
}: {
  at: Point
  value: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  // Opened with the name as it stands, all of it selected: typing replaces the
  // lot, and an arrow key steps into it to be edited a word at a time instead.
  useEffect(() => {
    ref.current?.select()
  }, [])

  /** A name typed away to nothing is no name at all, so the old one stands. */
  const commit = () => {
    const name = draft.trim()
    onCommit(name.length === 0 ? value : name)
  }

  return (
    <foreignObject
      x={at.x - FIELD_WIDTH / 2}
      y={at.y - FIELD_HEIGHT / 2}
      width={FIELD_WIDTH}
      height={FIELD_HEIGHT}
    >
      <Input
        ref={ref}
        value={draft}
        aria-label="Name"
        className="bg-background h-8 text-center shadow-xs select-text"
        // The canvas underneath would otherwise read a press in the field as
        // the start of a pan, and a double-click picking out a word in it as a
        // fresh rename of whatever is behind the box.
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') onCancel()
        }}
      />
    </foreignObject>
  )
}

/** A number on its own opaque plate, so the grid never runs through digits. */
function Plate({
  box,
  text,
  className = 'fill-muted-foreground text-[10px]',
  plateClassName = 'fill-background',
}: {
  box: Box
  text: string
  /** How the text is written; the default is the hand dimensions use. */
  className?: string
  plateClassName?: string
}) {
  return (
    <g
      transform={`translate(${box.centre.x} ${box.centre.y}) rotate(${box.angle})`}
    >
      <rect
        x={-box.w / 2}
        y={-box.h / 2}
        width={box.w}
        height={box.h}
        className={plateClassName}
        strokeWidth={1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        className={className}
      >
        {text}
      </text>
    </g>
  )
}

/**
 * Every wall's length, on show whether or not its room is selected. The layout
 * in `dimensions.ts` has already found each label a spot clear of the plan and
 * of the other labels; a leader line appears where one could not stay put.
 */
export function WallDimensions({
  labels,
  selected,
  onSelect,
}: {
  labels: Array<WallLabel>
  selected?: { roomId: string; wall: number }
  onSelect?: (roomId: string, wall: number) => void
}) {
  return (
    <g className={onSelect ? undefined : 'pointer-events-none'}>
      {labels.map(({ key, roomId, roomName, wall, text, box, leader }) => {
        const active = selected?.roomId === roomId && selected.wall === wall
        return (
          <g
            key={key}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={
              onSelect
                ? `Edit wall ${wall + 1} of ${roomName}, ${text}`
                : undefined
            }
            aria-pressed={onSelect ? active : undefined}
            className={
              onSelect ? 'group cursor-pointer focus:outline-none' : ''
            }
            onPointerDown={(event) => {
              if (!onSelect || event.button !== 0) return
              event.stopPropagation()
              onSelect(roomId, wall)
            }}
            onDoubleClick={(event) => {
              if (onSelect) event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (!onSelect || (event.key !== 'Enter' && event.key !== ' ')) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              onSelect(roomId, wall)
            }}
          >
            {leader && (
              <line
                x1={leader.from.x}
                y1={leader.from.y}
                x2={leader.to.x}
                y2={leader.to.y}
                className="stroke-muted-foreground/60"
                strokeWidth={1}
              />
            )}
            <Plate
              box={box}
              text={text}
              className={
                active
                  ? 'fill-foreground text-[10px] font-medium'
                  : 'fill-muted-foreground text-[10px]'
              }
              plateClassName={
                active
                  ? 'fill-selection stroke-selection'
                  : 'fill-background group-focus-visible:stroke-foreground'
              }
            />
          </g>
        )
      })}
    </g>
  )
}

/**
 * The handles on a selected room: every side ready to be pushed, and — under
 * the edit tool — a square at every corner and a rotate handle above the
 * outline.
 *
 * Dragging a side — anywhere along the wall, or by the bar at its middle —
 * pushes that whole wall out or pulls it in, which is how a room is made
 * bigger without being redrawn. That is a move as much as an edit, so the
 * bands are there under either pointer tool. Dragging a corner reshapes the
 * room around it, and turning it is no different, so those two handlers are
 * not passed under move and their handles are not drawn — there is nothing
 * there to catch by mistake.
 *
 * Double-clicking a wall breaks it in two, but that gesture is not wired up
 * here: the press that starts it captures the pointer to the canvas, and the
 * browser hands the double-click to whatever holds the capture rather than to
 * the band under the pointer. The canvas takes it and finds the wall itself.
 */
export function RoomEditor({
  room,
  gaps,
  viewport,
  selectedWall,
  onVertexDown,
  onWallDown,
  onRotateDown,
}: {
  room: Room
  /** What is cut through each wall, wall by wall: the doorways and windows. */
  gaps: Array<Array<Span>>
  viewport: Viewport
  selectedWall?: number
  onVertexDown?: (index: number, event: React.PointerEvent) => void
  onWallDown: (index: number, event: React.PointerEvent) => void
  onRotateDown?: (event: React.PointerEvent) => void
}) {
  const topY = Math.min(...room.points.map((point) => point.y))
  const topWall = room.points
    .slice(0, wallCount(room))
    .findIndex((point, index) => {
      const next = room.points[(index + 1) % room.points.length]
      return Math.abs(point.y - topY) < 1e-6 && Math.abs(next.y - topY) < 1e-6
    })
  const topPoint =
    topWall >= 0
      ? {
          x:
            (room.points[topWall].x +
              room.points[(topWall + 1) % room.points.length].x) /
            2,
          y: topY,
        }
      : room.points.find((point) => Math.abs(point.y - topY) < 1e-6)!
  const top = worldToScreen(topPoint, viewport)
  const rotateHandle = { x: top.x, y: top.y - ROTATE_OFFSET }
  const walls = room.points.slice(0, wallCount(room)).map((point, i) => {
    const next = room.points[(i + 1) % room.points.length]
    const frame = roomWallAt(room, i)
    const a = worldToScreen(point, viewport)
    const b = worldToScreen(next, viewport)
    // The wall as it is actually built: the stretches either side of every
    // opening cut through it. A doorway is a hole rather than a piece of wall,
    // so neither the band nor the bar has any business lying across one.
    const bands = (
      frame ? wallSegments(frame, gaps[i] ?? []) : [[point, next]]
    ).map(([from, to]) => ({
      a: worldToScreen(from, viewport),
      b: worldToScreen(to, viewport),
    }))
    // The bar goes on the longest standing stretch rather than at the middle
    // of the wall, which on a wall with a door in the middle of it is a hole.
    const longest = bands.reduce<{ a: Point; b: Point } | null>(
      (best, band) =>
        !best ||
        Math.hypot(band.b.x - band.a.x, band.b.y - band.a.y) >
          Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y)
          ? band
          : best,
      null,
    )
    return {
      a,
      b,
      bands,
      mid: longest && {
        x: (longest.a.x + longest.b.x) / 2,
        y: (longest.a.y + longest.b.y) / 2,
      },
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      // Never longer than a good part of the stretch it lies on, so a short
      // one keeps its ends clear of the handle in the middle of it.
      length: longest
        ? Math.min(
            BAR_LENGTH,
            Math.hypot(longest.b.x - longest.a.x, longest.b.y - longest.a.y) *
              0.6,
          )
        : 0,
      // The normal is a world direction, and the page has the same directions
      // as the world — only bigger — so it names the cursor as it stands.
      cursor: frame ? resizeCursor(frame.normal, 0) : 'cursor-move',
    }
  })

  return (
    <g>
      {/*
        The whole wall takes the drag, not just the handle on it: a side is a
        big thing to have to grab by eight pixels in the middle. The band is
        laid over the wall as it is drawn, so what pushes is what it looks like
        — and it stops at the jambs, so the door underneath keeps its own
        clicks and can still be slid along the wall it hangs on.
      */}
      {walls.flatMap((wall, i) =>
        wall.bands.map((band, j) => (
          <line
            key={`wall-${i}-${j}`}
            x1={band.a.x}
            y1={band.a.y}
            x2={band.b.x}
            y2={band.b.y}
            stroke="transparent"
            strokeWidth={WALL_GRAB}
            strokeLinecap="butt"
            className={wall.cursor}
            onPointerDown={(event) => onWallDown(i, event)}
          />
        )),
      )}
      {walls.map((wall, i) =>
        wall.mid ? (
          <Bar
            key={`bar-${i}`}
            at={wall.mid}
            angle={wall.angle}
            length={wall.length}
            selected={i === selectedWall}
            className={wall.cursor}
            onPointerDown={(event) => onWallDown(i, event)}
          />
        ) : null,
      )}
      {/* Corners last, so the one at the end of a wall wins the pointer. */}
      {onVertexDown &&
        room.points.map((point, i) => (
          <Square
            key={`vertex-${i}`}
            at={worldToScreen(point, viewport)}
            className="cursor-move"
            onPointerDown={(event) => onVertexDown(i, event)}
          />
        ))}
      {onRotateDown && (
        <>
          <line
            x1={top.x}
            y1={top.y}
            x2={rotateHandle.x}
            y2={rotateHandle.y}
            className="stroke-foreground pointer-events-none"
            strokeWidth={1}
          />
          <circle
            cx={rotateHandle.x}
            cy={rotateHandle.y}
            r={5}
            className="fill-background stroke-foreground cursor-grab"
            strokeWidth={1.5}
            onPointerDown={onRotateDown}
          />
        </>
      )}
    </g>
  )
}

/**
 * A selected item: its rotated bounding box and its size on a plate, and —
 * under the edit tool — the eight resize handles and the rotate handle on its
 * stem. Under the move tool the handlers are not passed and the handles are
 * not drawn, so there is nothing there to catch by mistake.
 */
export function FurnitureEditor({
  item,
  viewport,
  units,
  avoid,
  onHandleDown,
  onRotateDown,
}: {
  item: Furniture
  viewport: Viewport
  units: Units
  /** Boxes the size readout backs away from: what the plan already says. */
  avoid: Array<Box>
  onHandleDown?: (handle: Handle, event: React.PointerEvent) => void
  onRotateDown?: (event: React.PointerEvent) => void
}) {
  const screenAt = (handle: Handle) =>
    worldToScreen(handlePosition(item, handle), viewport)

  const corners = (['nw', 'ne', 'se', 'sw'] as const).map(screenAt)
  const topMid = screenAt('n')
  const centre = worldToScreen({ x: item.x, y: item.y }, viewport)

  // Unit vector pointing out of the item's top edge, in screen space.
  const dx = topMid.x - centre.x
  const dy = topMid.y - centre.y
  const len = Math.hypot(dx, dy) || 1
  const stem = {
    x: topMid.x + (dx / len) * ROTATE_OFFSET,
    y: topMid.y + (dy / len) * ROTATE_OFFSET,
  }
  // The readout is the one label here that can be moved, and the wall
  // dimensions are the ones that have to stay put, so it is the readout that
  // gives way — dropping down past them, or standing down if it cannot clear.
  const below = screenAt('s')
  const readout = findSpot(
    [0, 1, 2, 3].map((i) => ({
      x: below.x,
      y: below.y + READOUT_GAP + i * STEP,
    })),
    formatSize(item.w, item.h, units),
    0,
    avoid,
  )

  return (
    <g>
      <polygon
        points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        className="stroke-foreground pointer-events-none"
        strokeWidth={1}
      />
      {onRotateDown && (
        <>
          <line
            x1={topMid.x}
            y1={topMid.y}
            x2={stem.x}
            y2={stem.y}
            className="stroke-foreground pointer-events-none"
            strokeWidth={1}
          />
          <circle
            cx={stem.x}
            cy={stem.y}
            r={5}
            className="fill-background stroke-foreground cursor-grab"
            strokeWidth={1.5}
            onPointerDown={onRotateDown}
          />
        </>
      )}
      {onHandleDown &&
        HANDLES.map((handle) => (
          <Square
            key={handle}
            at={screenAt(handle)}
            className={resizeCursor(HANDLE_DIR[handle], item.rotation)}
            onPointerDown={(event) => onHandleDown(handle, event)}
          />
        ))}
      {readout && (
        <g className="pointer-events-none">
          <Plate box={readout.box} text={formatSize(item.w, item.h, units)} />
        </g>
      )}
    </g>
  )
}

/**
 * A selected opening: its clear width on a plate beside it, and — under the
 * edit tool — a handle on each jamb, which widen it from that end.
 *
 * The opening itself is dragged by its own band on the canvas, so there is no
 * handle for that here — an opening can only ever run along its wall — which
 * is why it still slides along its wall under the move tool.
 */
export function OpeningEditor({
  opening,
  wall,
  viewport,
  units,
  avoid,
  onEndDown,
}: {
  opening: Opening
  wall: Wall
  viewport: Viewport
  units: Units
  /** Boxes the width readout backs away from: what the plan already says. */
  avoid: Array<Box>
  onEndDown?: (end: 'start' | 'end', event: React.PointerEvent) => void
}) {
  const { start, end, centre, width } = openingEnds(wall, opening)
  const angle = (Math.atan2(wall.tangent.y, wall.tangent.x) * 180) / Math.PI
  const at = worldToScreen(centre, viewport)
  const normal = {
    x: wall.normal.x * viewport.scale,
    y: wall.normal.y * viewport.scale,
  }
  const length = Math.hypot(normal.x, normal.y) || 1

  const text = formatLength(width, units)
  // Either side of the wall will do, so the readout tries both in turn and
  // steps further out each time round, the way a wall's own dimension does.
  const readout = findSpot(
    [1, 2, 3, 4].flatMap((ring) =>
      [1, -1].map((side) => ({
        x: at.x + (normal.x / length) * STEP * ring * side,
        y: at.y + (normal.y / length) * STEP * ring * side,
      })),
    ),
    text,
    uprightAngle(wall.tangent),
    avoid,
  )

  const jambs = {
    start: worldToScreen(start, viewport),
    end: worldToScreen(end, viewport),
  }

  return (
    <g>
      <line
        x1={jambs.start.x}
        y1={jambs.start.y}
        x2={jambs.end.x}
        y2={jambs.end.y}
        className="stroke-foreground pointer-events-none"
        strokeWidth={1}
      />
      {onEndDown &&
        (['start', 'end'] as const).map((which) => (
          <Square
            key={which}
            at={jambs[which]}
            className={resizeCursor({ x: 1, y: 0 }, angle)}
            onPointerDown={(event) => onEndDown(which, event)}
          />
        ))}
      {readout && (
        <g className="pointer-events-none">
          <Plate box={readout.box} text={text} />
        </g>
      )}
    </g>
  )
}

/** The rectangle room being dragged out, sized live in the display units. */
export function RectPreview({
  rect,
  viewport,
  units,
}: {
  rect: RectDraft
  viewport: Viewport
  units: Units
}) {
  const a = worldToScreen(rect.start, viewport)
  const b = worldToScreen(rect.end, viewport)
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const width = Math.abs(a.x - b.x)
  const height = Math.abs(a.y - b.y)

  const w = Math.abs(rect.end.x - rect.start.x)
  const h = Math.abs(rect.end.y - rect.start.y)

  return (
    <g className="pointer-events-none">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className="fill-foreground/5 stroke-foreground"
        strokeWidth={2}
        strokeDasharray="4 4"
      />
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {formatArea(w * h, units)}
      </text>
      <text
        x={x + width / 2}
        y={y + height + 14}
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {formatLength(w, units)}
      </text>
      <text
        x={x + width + 8}
        y={y + height / 2}
        dominantBaseline="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {formatLength(h, units)}
      </text>
    </g>
  )
}

/** The next wall preview and the corners of the active run. */
export function DraftOverlay({
  draft,
  cursor,
  viewport,
  units,
  nearFirst,
}: {
  draft: Array<Point>
  cursor: Point | null
  viewport: Viewport
  units: Units
  nearFirst: boolean
}) {
  if (draft.length === 0) return null

  const points = draft.map((p) => worldToScreen(p, viewport))
  const first = points[0]
  const last = points[points.length - 1]
  const previous = draft[draft.length - 1]
  const tip = cursor ? worldToScreen(cursor, viewport) : null
  const length = cursor
    ? Math.hypot(cursor.x - previous.x, cursor.y - previous.y)
    : 0

  return (
    <g className="pointer-events-none">
      {tip && length > 0 && (
        <>
          <line
            x1={last.x}
            y1={last.y}
            x2={tip.x}
            y2={tip.y}
            className="stroke-foreground/60"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <text
            x={tip.x + 12}
            y={tip.y - 10}
            className="fill-muted-foreground text-[10px]"
          >
            {formatLength(length, units)}
          </text>
        </>
      )}
      <circle
        cx={first.x}
        cy={first.y}
        r={nearFirst ? 7 : 4}
        className="fill-background stroke-foreground"
        strokeWidth={1.5}
      />
      {points.slice(1).map((p, i) => (
        <Square key={i} at={p} size={6} />
      ))}
    </g>
  )
}
