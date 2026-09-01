import { useId, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import { IconLock, IconLockOpen } from '@tabler/icons-react'

import { HistoryPanel } from './history.tsx'

import { Button } from '#/components/ui/button.tsx'
import { Alert, AlertDescription } from '#/components/ui/alert.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'

import { plannerStore } from '#/lib/planner/store.ts'
import { cn } from '#/lib/utils.ts'
import {
  HINGED_KINDS,
  OPENING_KINDS,
  OPENING_PRESETS,
  SIDED_KINDS,
} from '#/lib/planner/presets.ts'
import { closetSize } from '#/lib/planner/closets.ts'
import { wallAt } from '#/lib/planner/openings.ts'
import {
  angleBetween,
  normalizeAngle,
  polygonArea,
  polygonBounds,
  scalePolygon,
} from '#/lib/planner/geometry.ts'
import {
  formatArea,
  formatLength,
  fromLength,
  lengthPrecision,
  lengthUnit,
  toLength,
} from '#/lib/planner/units.ts'
import { MIN_SIZE } from '#/lib/planner/types.ts'
import {
  UNTOUCHED_PLAN_NAME,
  commitPlanName,
  refreshPlanName,
  typePlanName,
} from '#/lib/planner/planName.ts'

import type {
  Furniture,
  Opening,
  OpeningKind,
  Room,
  Units,
} from '#/lib/planner/types.ts'
import type { PlanNameEdit } from '#/lib/planner/planName.ts'

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
  disabled = false,
}: {
  label: string
  value: number
  onCommit: (next: number) => string | null | void
  min?: number
  precision?: number
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    if (!Number.isFinite(parsed)) {
      setError('Enter a number.')
      return
    }

    const result = onCommit(min === undefined ? parsed : Math.max(min, parsed))
    if (typeof result === 'string') {
      setError(result)
      return
    }

    // A value typed in is one step to undo, not one per keystroke that reached
    // it, and the next thing typed here is a step of its own.
    plannerStore.actions.sealHistory()
    setDraft(null)
    setError(null)
  }

  return (
    <Label className="grid gap-1" htmlFor={id}>
      <span className="text-muted-foreground text-[10px]">{label}</span>
      <Input
        id={id}
        type="number"
        disabled={disabled}
        value={draft ?? String(Number(value.toFixed(precision)))}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(null)
            setError(null)
          }
        }}
      />
      {error ? (
        <span
          id={`${id}-error`}
          role="alert"
          className="text-destructive text-[10px]"
        >
          {error}
        </span>
      ) : null}
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
  disabled = false,
}: {
  label: string
  cm: number
  units: Units
  onCommit: (nextCm: number) => string | null | void
  min?: number
  disabled?: boolean
}) {
  return (
    <NumberField
      label={`${label} ${lengthUnit(units)}`}
      value={toLength(cm, units)}
      min={min === undefined ? undefined : toLength(min, units)}
      precision={lengthPrecision(units)}
      disabled={disabled}
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
  required = false,
  id,
}: {
  value: string
  onChange: (next: string) => void
  required?: boolean
  id?: string
}) {
  const [edit, setEdit] = useState<PlanNameEdit>(UNTOUCHED_PLAN_NAME)
  /*
    The stored name arrives after the first render: the library is restored
    from the browser, and the plan opened, only once the editor is mounted, so
    the field starts out being handed an empty name it must not complain
    about. Following the value as it changes keeps what is on show, and any
    complaint about what used to be there, honest.
  */
  const [known, setKnown] = useState(value)
  if (value !== known) {
    setKnown(value)
    setEdit(refreshPlanName(edit))
  }
  const displayed = required ? (edit.draft ?? value) : value

  const update = (next: string) => {
    if (!required) {
      onChange(next)
      return
    }

    const typed = typePlanName(next)
    setEdit(typed.edit)
    if (typed.commit !== null) onChange(typed.commit)
  }

  const commit = () => {
    if (required) {
      const committed = commitPlanName(displayed)
      setEdit(committed.edit)
      if (committed.commit !== null) onChange(committed.commit)
    }
    plannerStore.actions.sealHistory()
  }

  return (
    <Label className="grid gap-1" htmlFor={id}>
      <span className="text-muted-foreground text-[10px]">Name</span>
      <Input
        id={id}
        value={displayed}
        aria-invalid={required && edit.error !== null}
        aria-describedby={edit.error && id ? `${id}-error` : undefined}
        onChange={(event) => update(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (required && event.key === 'Escape') setEdit(UNTOUCHED_PLAN_NAME)
        }}
      />
      {edit.error ? (
        <span
          id={id ? `${id}-error` : undefined}
          role="alert"
          className="text-destructive text-[10px]"
        >
          {edit.error}
        </span>
      ) : null}
    </Label>
  )
}

/**
 * What can be done to the selection whatever it is, at the foot of every
 * panel. Both have a key to themselves on the canvas; the buttons are here for
 * the times the pointer is already in the panel, and to say that they exist.
 */
function SelectionActions({
  duplicate = true,
  deletable = true,
}: {
  duplicate?: boolean
  deletable?: boolean
}) {
  return (
    <div className={`grid gap-2 ${duplicate ? 'grid-cols-2' : ''}`}>
      {duplicate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => plannerStore.actions.duplicateSelection()}
        >
          Duplicate
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={!deletable}
        onClick={() => plannerStore.actions.deleteSelected()}
      >
        Delete
      </Button>
    </div>
  )
}

function ClosetPanel({
  room,
  host,
  units,
}: {
  room: Room
  host?: Room
  units: Units
}) {
  const actions = plannerStore.actions
  const size = closetSize(room)

  return (
    <>
      <SectionTitle>Closet</SectionTitle>
      <NameField
        value={room.name}
        onChange={(name) => actions.updateRoom(room.id, { name })}
      />
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Width"
          cm={size.width}
          units={units}
          min={MIN_SIZE}
          onCommit={(width) => actions.updateCloset(room.id, { width })}
        />
        <LengthField
          label="Depth"
          cm={size.depth}
          units={units}
          min={MIN_SIZE}
          onCommit={(depth) => actions.updateCloset(room.id, { depth })}
        />
      </div>
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-[11px]">
        <dt>Attached to</dt>
        <dd className="text-foreground truncate text-right">
          {host?.name ?? 'Missing room'}
        </dd>
        <dt>Area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {formatArea(polygonArea(room.points), units, 2)}
        </dd>
      </dl>
      <SelectionActions duplicate={false} />
    </>
  )
}

function RoomLockButton({ room }: { room: Room }) {
  const locked = room.locked === true
  return (
    <Button
      variant={locked ? 'secondary' : 'ghost'}
      size="sm"
      className="h-6 gap-1 px-2 text-[10px]"
      aria-pressed={locked}
      onClick={() => plannerStore.actions.setRoomLocked(room.id, !locked)}
    >
      {locked ? (
        <IconLock className="size-3" />
      ) : (
        <IconLockOpen className="size-3" />
      )}
      {locked ? 'Locked' : 'Unlocked'}
    </Button>
  )
}

function RoomPanel({ room, units }: { room: Room; units: Units }) {
  const actions = plannerStore.actions
  const bounds = polygonBounds(room.points)
  // A room is drawn locked, so the padlock is the first thing this panel has
  // to say about it: everything below it that changes the outline is held
  // until it is off.
  const locked = room.locked === true

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Room</SectionTitle>
        <RoomLockButton room={room} />
      </div>
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
          disabled={locked}
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
          disabled={locked}
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
      </dl>
      <SelectionActions deletable={!locked} />
    </>
  )
}

function WallPanel({
  room,
  index,
  units,
}: {
  room: Room
  index: number
  units: Units
}) {
  const wall = wallAt(room.points, index)
  if (!wall) return null
  const locked = room.locked === true
  const change = (patch: { length?: number; angle?: number }) => {
    const result = plannerStore.actions.setWallDimensions(room.id, index, patch)
    return result.ok ? null : result.error
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>
          Wall {index + 1} of {room.points.length}
        </SectionTitle>
        <RoomLockButton room={room} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Length"
          cm={wall.length}
          units={units}
          disabled={locked}
          onCommit={(length) => change({ length })}
        />
        <NumberField
          label="Angle °"
          value={angleBetween(wall.a, wall.b)}
          precision={2}
          disabled={locked}
          onCommit={(angle) => change({ angle })}
        />
      </div>
      {locked ? (
        <Alert>
          <AlertDescription>
            Unlock {room.name} to edit this wall.
          </AlertDescription>
        </Alert>
      ) : null}
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-[11px]">
        <dt>In</dt>
        <dd className="text-foreground truncate text-right">{room.name}</dd>
        <dt>Anchor</dt>
        <dd className="text-foreground text-right">Start corner</dd>
      </dl>
      <p className="text-muted-foreground text-[10px] leading-relaxed">
        The start corner stays fixed. 0° points right; angles increase
        clockwise.
      </p>
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
      <SelectionActions />
    </>
  )
}

/** Two mutually exclusive settings on one line, the way a door is described. */
function ChoiceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
}) {
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-[10px]">{label}</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="w-full"
        value={value}
        onValueChange={(next) => {
          if (!next) return
          onChange(next)
          plannerStore.actions.sealHistory()
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="flex-1 data-[state=on]:bg-foreground data-[state=on]:text-background"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/**
 * A door or window, described by the wall it is in: how wide the gap is, how
 * far along the wall it starts, and — for anything on a hinge — which corner it
 * is hung from and which way it opens.
 */
function OpeningPanel({
  opening,
  room,
  units,
}: {
  opening: Opening
  room: Room
  units: Units
}) {
  const actions = plannerStore.actions
  const update = (patch: Partial<Opening>) =>
    actions.updateOpening(opening.id, patch)
  const wall = wallAt(room.points, opening.wall)
  if (!wall) return null

  // Kept as a fraction, shown as the distance from the wall's first corner:
  // the number someone standing in the room with a tape measure would want.
  const offset = opening.t * wall.length

  return (
    <>
      <SectionTitle>{OPENING_PRESETS[opening.kind].label}</SectionTitle>
      <Label className="grid gap-1">
        <span className="text-muted-foreground text-[10px]">Type</span>
        <Select
          value={opening.kind}
          onValueChange={(kind) => {
            update({ kind: kind as OpeningKind })
            plannerStore.actions.sealHistory()
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPENING_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {OPENING_PRESETS[kind].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Width"
          cm={opening.width}
          units={units}
          min={MIN_SIZE}
          onCommit={(width) => update({ width })}
        />
        <LengthField
          label="From corner"
          cm={offset}
          units={units}
          onCommit={(next) => update({ t: next / wall.length })}
        />
      </div>
      {HINGED_KINDS.includes(opening.kind) && (
        <ChoiceField
          label="Hinge"
          value={opening.hinge}
          options={[
            { value: 'start', label: 'Start' },
            { value: 'end', label: 'End' },
          ]}
          onChange={(hinge) => update({ hinge: hinge as Opening['hinge'] })}
        />
      )}
      {SIDED_KINDS.includes(opening.kind) && (
        <ChoiceField
          label={HINGED_KINDS.includes(opening.kind) ? 'Swing' : 'Runs'}
          value={opening.swing}
          options={[
            { value: 'in', label: 'Inward' },
            { value: 'out', label: 'Outward' },
          ]}
          onChange={(swing) => update({ swing: swing as Opening['swing'] })}
        />
      )}
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 text-[11px]">
        <dt>In</dt>
        <dd className="text-foreground truncate text-right">{room.name}</dd>
        <dt>Wall</dt>
        <dd className="text-foreground text-right tabular-nums">
          {opening.wall + 1} of {room.points.length}
        </dd>
        <dt>Wall length</dt>
        <dd className="text-foreground text-right tabular-nums">
          {formatLength(wall.length, units)}
        </dd>
      </dl>
      <SelectionActions />
    </>
  )
}

function EmptyPanel({ units, nameId }: { units: Units; nameId: string }) {
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)
  const name = useSelector(
    plannerStore,
    (s) => s.projects.find((p) => p.id === s.projectId)?.name ?? '',
  )
  const total = rooms.reduce((sum, r) => sum + polygonArea(r.points), 0)

  return (
    <>
      <SectionTitle>Plan</SectionTitle>
      {/*
        The plan's own name, in the same place a room's or an item's would be:
        with nothing selected, what the panel is about is the plan itself.
      */}
      <NameField
        value={name}
        required
        id={nameId}
        onChange={(next) => plannerStore.actions.renameProject(next)}
      />
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
        <dt>Openings</dt>
        <dd className="text-foreground text-right tabular-nums">
          {openings.length}
        </dd>
      </dl>
    </>
  )
}

export function Inspector({
  className,
  nameId = 'plan-name',
}: {
  className?: string
  nameId?: string
}) {
  const selection = useSelector(plannerStore, (s) => s.selection)
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)
  const units = useSelector(plannerStore, (s) => s.units)

  const room =
    selection?.type === 'room'
      ? rooms.find((r) => r.id === selection.id)
      : undefined
  const item =
    selection?.type === 'furniture'
      ? furniture.find((f) => f.id === selection.id)
      : undefined
  const opening =
    selection?.type === 'opening'
      ? openings.find((o) => o.id === selection.id)
      : undefined
  const wallRoom =
    selection?.type === 'wall'
      ? rooms.find((candidate) => candidate.id === selection.id)
      : undefined
  const openingRoom = opening && rooms.find((r) => r.id === opening.roomId)
  const closetHost =
    room?.kind === 'closet' && room.attachment
      ? rooms.find((candidate) => candidate.id === room.attachment?.roomId)
      : undefined

  return (
    <aside
      aria-label="Inspector"
      className={cn('flex w-64 shrink-0 flex-col border-l', className)}
    >
      {/*
        The panel above scrolls on its own so that the history below it keeps
        its place at the foot of the sidebar, whatever is selected.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/*
          Remounting on selection change clears any half-typed field drafts, and
          keying on the unit too re-reads the fields when the system switches.
        */}
        {wallRoom && selection?.type === 'wall' ? (
          <WallPanel
            key={`${wallRoom.id}-${selection.index}-${units}`}
            room={wallRoom}
            index={selection.index}
            units={units}
          />
        ) : room?.kind === 'closet' ? (
          <ClosetPanel
            key={`${room.id}-${units}`}
            room={room}
            host={closetHost}
            units={units}
          />
        ) : room ? (
          <RoomPanel key={`${room.id}-${units}`} room={room} units={units} />
        ) : item ? (
          <FurniturePanel
            key={`${item.id}-${units}`}
            item={item}
            units={units}
          />
        ) : opening && openingRoom ? (
          <OpeningPanel
            key={`${opening.id}-${units}`}
            opening={opening}
            room={openingRoom}
            units={units}
          />
        ) : (
          <EmptyPanel units={units} nameId={nameId} />
        )}
      </div>
      <HistoryPanel />
    </aside>
  )
}
