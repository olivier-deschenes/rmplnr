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
} from '#/lib/planner/geometry.ts'
import {
  formatArea,
  fromLength,
  lengthPrecision,
  lengthUnit,
  toLength,
} from '#/lib/planner/units.ts'
import { MIN_SIZE } from '#/lib/planner/types.ts'

import type { Furniture, Room, Units } from '#/lib/planner/types.ts'

/**
 * Numeric field that holds a local draft while typing, so clearing "150" down
 * to "1" on the way to "120" does not fight the store mid-keystroke.
 */
function NumberField({
  label,
  value,
  onCommit,
  min,
  precision = 0,
}: {
  label: string
  value: number
  onCommit: (next: number) => void
  min?: number
  precision?: number
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
        value={draft ?? String(Number(value.toFixed(precision)))}
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

/**
 * A length in the plan's own centimetres, edited in whatever unit is on show.
 * The conversion lives here so every caller keeps passing and receiving cm.
 */
function LengthField({
  label,
  cm,
  units,
  onCommit,
  min,
}: {
  label: string
  cm: number
  units: Units
  onCommit: (nextCm: number) => void
  min?: number
}) {
  return (
    <NumberField
      label={`${label} ${lengthUnit(units)}`}
      value={toLength(cm, units)}
      min={min === undefined ? undefined : toLength(min, units)}
      precision={lengthPrecision(units)}
      onCommit={(next) => onCommit(fromLength(next, units))}
    />
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

function RoomPanel({ room, units }: { room: Room; units: Units }) {
  const actions = plannerStore.actions
  const bounds = polygonBounds(room.points)

  return (
    <>
      <SectionTitle>Room</SectionTitle>
      <NameField
        value={room.name}
        onChange={(name) => actions.updateRoom(room.id, { name })}
      />
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Width"
          cm={bounds.w}
          units={units}
          min={MIN_SIZE}
          onCommit={(w) =>
            actions.updateRoom(room.id, {
              points: scalePolygon(room.points, w, bounds.h),
            })
          }
        />
        <LengthField
          label="Height"
          cm={bounds.h}
          units={units}
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
          {formatArea(polygonArea(room.points), units, 2)}
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

function FurniturePanel({ item, units }: { item: Furniture; units: Units }) {
  const actions = plannerStore.actions
  const update = (patch: Partial<Furniture>) =>
    actions.updateFurniture(item.id, patch)

  return (
    <>
      <SectionTitle>{item.kind}</SectionTitle>
      <NameField value={item.name} onChange={(name) => update({ name })} />
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Width"
          cm={item.w}
          units={units}
          min={MIN_SIZE}
          onCommit={(w) => update({ w })}
        />
        <LengthField
          label="Height"
          cm={item.h}
          units={units}
          min={MIN_SIZE}
          onCommit={(h) => update({ h })}
        />
        <LengthField
          label="X"
          cm={item.x}
          units={units}
          onCommit={(x) => update({ x })}
        />
        <LengthField
          label="Y"
          cm={item.y}
          units={units}
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

function EmptyPanel({ units }: { units: Units }) {
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const total = rooms.reduce((sum, r) => sum + polygonArea(r.points), 0)

  return (
    <>
      <SectionTitle>Plan</SectionTitle>
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-[11px]">
        <dt>Floor area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {formatArea(total, units, 2)}
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
  const units = useSelector(plannerStore, (s) => s.units)

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
      {/*
        Remounting on selection change clears any half-typed field drafts, and
        keying on the unit too re-reads the fields when the system switches.
      */}
      {room ? (
        <RoomPanel key={`${room.id}-${units}`} room={room} units={units} />
      ) : item ? (
        <FurniturePanel key={`${item.id}-${units}`} item={item} units={units} />
      ) : (
        <EmptyPanel units={units} />
      )}
    </aside>
  )
}
