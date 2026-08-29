import {
  handlePosition,
  normalizeAngle,
  polygonArea,
  polygonCentroid,
  worldToScreen,
} from '#/lib/planner/geometry.ts'
import { formatArea, formatLength, formatSize } from '#/lib/planner/units.ts'
import { STEP, findSpot, uprightAngle } from '#/lib/planner/dimensions.ts'
import { openingEnds } from '#/lib/planner/openings.ts'
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
import type { Box, WallLabel } from '#/lib/planner/dimensions.ts'
import type { Wall } from '#/lib/planner/openings.ts'

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

export function RoomLabels({
  rooms,
  viewport,
  units,
}: {
  rooms: Array<Room>
  viewport: Viewport
  units: Units
}) {
  return (
    <g className="pointer-events-none">
      {rooms.map((room) => {
        const at = worldToScreen(polygonCentroid(room.points), viewport)
        return (
          <g key={room.id} textAnchor="middle">
            <text
              x={at.x}
              y={at.y}
              className="fill-foreground text-[11px] font-medium"
            >
              {room.name}
            </text>
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

/** A number on its own opaque plate, so the grid never runs through digits. */
function Plate({ box, text }: { box: Box; text: string }) {
  return (
    <g
      transform={`translate(${box.centre.x} ${box.centre.y}) rotate(${box.angle})`}
    >
      <rect
        x={-box.w / 2}
        y={-box.h / 2}
        width={box.w}
        height={box.h}
        className="fill-background"
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-muted-foreground text-[10px]"
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
export function WallDimensions({ labels }: { labels: Array<WallLabel> }) {
  return (
    <g className="pointer-events-none">
      {labels.map(({ key, text, box, leader }) => (
        <g key={key}>
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
          <Plate box={box} text={text} />
        </g>
      ))}
    </g>
  )
}

/** Vertex handles, plus midpoint handles that insert a new vertex on click. */
export function RoomEditor({
  room,
  viewport,
  onVertexDown,
  onEdgeDown,
}: {
  room: Room
  viewport: Viewport
  onVertexDown: (index: number, event: React.PointerEvent) => void
  onEdgeDown: (index: number, event: React.PointerEvent) => void
}) {
  return (
    <g>
      {room.points.map((point, i) => {
        const next = room.points[(i + 1) % room.points.length]
        const mid = worldToScreen(
          { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
          viewport,
        )
        return (
          <circle
            key={`edge-${i}`}
            cx={mid.x}
            cy={mid.y}
            r={3}
            className="fill-background stroke-foreground/50 cursor-copy"
            strokeWidth={1.5}
            onPointerDown={(event) => onEdgeDown(i, event)}
          />
        )
      })}
      {room.points.map((point, i) => (
        <Square
          key={`vertex-${i}`}
          at={worldToScreen(point, viewport)}
          className="cursor-move"
          onPointerDown={(event) => onVertexDown(i, event)}
        />
      ))}
    </g>
  )
}

/** Rotated bounding box, eight resize handles, and a rotate handle on a stem. */
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
  /** Boxes the size readout backs away from: the wall dimensions on show. */
  avoid: Array<Box>
  onHandleDown: (handle: Handle, event: React.PointerEvent) => void
  onRotateDown: (event: React.PointerEvent) => void
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
      {HANDLES.map((handle) => (
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
 * A selected opening: a handle on each jamb, which widen it from that end, and
 * its clear width on a plate beside it.
 *
 * The opening itself is dragged by its own band on the canvas, so there is no
 * handle for that here — an opening can only ever run along its wall.
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
  /** Boxes the width readout backs away from: the wall dimensions on show. */
  avoid: Array<Box>
  onEndDown: (end: 'start' | 'end', event: React.PointerEvent) => void
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
      {(['start', 'end'] as const).map((which) => (
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

/** The polygon being traced, with a rubber-band edge to the cursor. */
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
      {points.length > 1 && (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          className="stroke-foreground"
          strokeWidth={2}
        />
      )}
      {tip && (
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
