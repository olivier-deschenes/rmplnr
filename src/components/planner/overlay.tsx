import {
  handlePosition,
  normalizeAngle,
  polygonArea,
  polygonCentroid,
  squareMetres,
  worldToScreen,
} from '#/lib/planner/geometry.ts'
import { HANDLES, HANDLE_DIR } from '#/lib/planner/types.ts'

import type {
  Furniture,
  Handle,
  Point,
  RectDraft,
  Room,
  Viewport,
} from '#/lib/planner/types.ts'

const HANDLE_SIZE = 8
const ROTATE_OFFSET = 26

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
}: {
  rooms: Array<Room>
  viewport: Viewport
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
              {squareMetres(polygonArea(room.points)).toFixed(1)} m²
            </text>
          </g>
        )
      })}
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
  onHandleDown,
  onRotateDown,
}: {
  item: Furniture
  viewport: Viewport
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
  const bottom = screenAt('s')

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
      <text
        x={bottom.x}
        y={bottom.y + 20}
        textAnchor="middle"
        className="fill-muted-foreground pointer-events-none text-[10px]"
      >
        {Math.round(item.w)} × {Math.round(item.h)} cm
      </text>
    </g>
  )
}

/** The rectangle room being dragged out, sized live in cm and m². */
export function RectPreview({
  rect,
  viewport,
}: {
  rect: RectDraft
  viewport: Viewport
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
        {squareMetres(w * h).toFixed(1)} m²
      </text>
      <text
        x={x + width / 2}
        y={y + height + 14}
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {Math.round(w)} cm
      </text>
      <text
        x={x + width + 8}
        y={y + height / 2}
        dominantBaseline="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {Math.round(h)} cm
      </text>
    </g>
  )
}

/** The polygon being traced, with a rubber-band edge to the cursor. */
export function DraftOverlay({
  draft,
  cursor,
  viewport,
  nearFirst,
}: {
  draft: Array<Point>
  cursor: Point | null
  viewport: Viewport
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
            {Math.round(length)} cm
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
