import { useState } from 'react'
import { useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Separator } from '#/components/ui/separator.tsx'

import { plannerStore } from '#/lib/planner/store.ts'
import {
  normalizeAngle,
  polygonArea,
  polygonBounds,
  scalePolygon,
  squareMetres,
} from '#/lib/planner/geometry.ts'
import { MIN_SIZE } from '#/lib/planner/types.ts'

import type { Furniture, Room } from '#/lib/planner/types.ts'

/**
 * Numeric field that holds a local draft while typing, so clearing "150" down
 * to "1" on the way to "120" does not fight the store mid-keystroke.
 */
function NumberField({
  label,
  value,
  onCommit,
  min,
}: {
  label: string
  value: number
  onCommit: (next: number) => void
  min?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed)) {
      onCommit(min === undefined ? parsed : Math.max(min, parsed))
    }
    setDraft(null)
  }

  return (
    <Label className="grid gap-1">
      <span className="text-muted-foreground text-[10px]">{label}</span>
      <Input
        type="number"
        value={draft ?? String(Math.round(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
    </Label>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground text-[10px] tracking-wider uppercase">
      {children}
    </h2>
  )
}

function NameField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <Label className="grid gap-1">
      <span className="text-muted-foreground text-[10px]">Name</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </Label>
  )
}

function DeleteButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={() => plannerStore.actions.deleteSelected()}
    >
      Delete
    </Button>
  )
}

function RoomPanel({ room }: { room: Room }) {
  const actions = plannerStore.actions
  const bounds = polygonBounds(room.points)
  const area = squareMetres(polygonArea(room.points))

  return (
    <>
      <SectionTitle>Room</SectionTitle>
      <NameField
        value={room.name}
        onChange={(name) => actions.updateRoom(room.id, { name })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width cm"
          value={bounds.w}
          min={MIN_SIZE}
          onCommit={(w) =>
            actions.updateRoom(room.id, {
              points: scalePolygon(room.points, w, bounds.h),
            })
          }
        />
        <NumberField
          label="Height cm"
          value={bounds.h}
          min={MIN_SIZE}
          onCommit={(h) =>
            actions.updateRoom(room.id, {
              points: scalePolygon(room.points, bounds.w, h),
            })
          }
        />
      </div>
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-[11px]">
        <dt>Area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {area.toFixed(2)} m²
        </dd>
        <dt>Corners</dt>
        <dd className="text-foreground text-right tabular-nums">
          {room.points.length}
        </dd>
      </dl>
      <DeleteButton />
    </>
  )
}

function FurniturePanel({ item }: { item: Furniture }) {
  const actions = plannerStore.actions
  const update = (patch: Partial<Furniture>) =>
    actions.updateFurniture(item.id, patch)

  return (
    <>
      <SectionTitle>{item.kind}</SectionTitle>
      <NameField value={item.name} onChange={(name) => update({ name })} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width cm"
          value={item.w}
          min={MIN_SIZE}
          onCommit={(w) => update({ w })}
        />
        <NumberField
          label="Height cm"
          value={item.h}
          min={MIN_SIZE}
          onCommit={(h) => update({ h })}
        />
        <NumberField
          label="X cm"
          value={item.x}
          onCommit={(x) => update({ x })}
        />
        <NumberField
          label="Y cm"
          value={item.y}
          onCommit={(y) => update({ y })}
        />
      </div>
      <NumberField
        label="Rotation °"
        value={item.rotation}
        onCommit={(rotation) => update({ rotation: normalizeAngle(rotation) })}
      />
      <DeleteButton />
    </>
  )
}

function EmptyPanel() {
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const total = rooms.reduce((sum, r) => sum + polygonArea(r.points), 0)

  return (
    <>
      <SectionTitle>Plan</SectionTitle>
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-[11px]">
        <dt>Floor area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {squareMetres(total).toFixed(2)} m²
        </dd>
        <dt>Rooms</dt>
        <dd className="text-foreground text-right tabular-nums">
          {rooms.length}
        </dd>
        <dt>Furniture</dt>
        <dd className="text-foreground text-right tabular-nums">
          {furniture.length}
        </dd>
      </dl>
      <Separator />
      <SectionTitle>Keys</SectionTitle>
      <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-foreground">V / R / E</dt>
        <dd>Select, draw a room, or a rectangle</dd>
        <dt className="text-foreground">Click</dt>
        <dd>Add a corner; click the first to close</dd>
        <dt className="text-foreground">Drag</dt>
        <dd>Sizes a rectangle; empty space pans</dd>
        <dt className="text-foreground">Pinch</dt>
        <dd>Or ⌘ + scroll to zoom</dd>
        <dt className="text-foreground">⌫</dt>
        <dd>Delete the selection</dd>
      </dl>
    </>
  )
}

export function Inspector() {
  const selection = useSelector(plannerStore, (s) => s.selection)
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  const furniture = useSelector(plannerStore, (s) => s.furniture)

  const room =
    selection?.type === 'room'
      ? rooms.find((r) => r.id === selection.id)
      : undefined
  const item =
    selection?.type === 'furniture'
      ? furniture.find((f) => f.id === selection.id)
      : undefined

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l p-3">
      {/* Remounting on selection change clears any half-typed field drafts. */}
      {room ? (
        <RoomPanel key={room.id} room={room} />
      ) : item ? (
        <FurniturePanel key={item.id} item={item} />
      ) : (
        <EmptyPanel />
      )}
    </aside>
  )
}
