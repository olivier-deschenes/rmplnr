import { useEffect, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import { formatForDisplay } from '@tanstack/react-hotkeys'

import { HistoryPanel } from './history.tsx'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'

import { plannerStore } from '#/lib/planner/store.ts'
import { EDIT_KEYS, OPENING_KEYS, TOOL_KEYS } from '#/lib/planner/shortcuts.ts'
import {
  HINGED_KINDS,
  OPENING_KINDS,
  OPENING_PRESETS,
  SIDED_KINDS,
} from '#/lib/planner/presets.ts'
import { wallAt } from '#/lib/planner/openings.ts'
import { neighbours } from '#/lib/planner/walls.ts'
import {
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

import type { Hotkey } from '@tanstack/react-hotkeys'

import type {
  Furniture,
  Opening,
  OpeningKind,
  Room,
  Units,
} from '#/lib/planner/types.ts'

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
      // A value typed in is one step to undo, not one per keystroke that
      // reached it, and the next thing typed here is a step of its own.
      plannerStore.actions.sealHistory()
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
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => plannerStore.actions.sealHistory()}
      />
    </Label>
  )
}

/**
 * What can be done to the selection whatever it is, at the foot of every
 * panel. Both have a key to themselves on the canvas; the buttons are here for
 * the times the pointer is already in the panel, and to say that they exist.
 */
function SelectionActions() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => plannerStore.actions.duplicateSelection()}
      >
        Duplicate
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => plannerStore.actions.deleteSelected()}
      >
        Delete
      </Button>
    </div>
  )
}

function RoomPanel({ room, units }: { room: Room; units: Units }) {
  const actions = plannerStore.actions
  const bounds = polygonBounds(room.points)
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  // Which rooms this one is actually built onto, rather than merely near.
  const joined = neighbours(rooms, room.id)

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
      {/*
        A room pushed up against another shares the wall between them, and that
        is not something the drawing can say on its own: one wall between two
        rooms looks exactly like one wall with a room behind it. So the panel
        names them, and selecting the room lights those walls up on the plan.
      */}
      {/*
        Both ways of reshaping a room are gestures on the canvas with nothing
        in the panel to stand for them, so the panel is where they are named.
      */}
      <p className="text-muted-foreground text-[11px]">
        Drag a wall to push the room out, or a corner to reshape it.
        Double-click a wall to break it in two, or the room itself to rename it.
      </p>
      <dl className="text-muted-foreground grid gap-y-1 text-[11px]">
        <dt>Shares walls with</dt>
        <dd className="text-foreground">
          {joined.length === 0
            ? 'Nothing — drag it against another room'
            : joined.map((other) => other.name).join(', ')}
        </dd>
      </dl>
      <SelectionActions />
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

/**
 * Writes a binding the way the reader's own machine writes it: ⌘ Z on a Mac
 * and Ctrl+Z everywhere else, off the one table the canvas registers.
 *
 * Which of the two is only knowable in the browser, and the panel is rendered
 * on the server first, so the opening pass puts down the Mac form the legend
 * has always shown and the machine corrects it once mounted. On a Mac — where
 * the guess is right — there is nothing to correct.
 */
function useKeys() {
  const [platform, setPlatform] = useState<'mac' | undefined>('mac')
  useEffect(() => setPlatform(undefined), [])
  return (...bindings: Array<Hotkey>) =>
    bindings
      .map((binding) => formatForDisplay(binding, { platform }))
      .join(' / ')
}

function EmptyPanel({ units }: { units: Units }) {
  const keys = useKeys()
  const rooms = useSelector(plannerStore, (s) => s.rooms)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)
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
        <dt>Openings</dt>
        <dd className="text-foreground text-right tabular-nums">
          {openings.length}
        </dd>
      </dl>
      <Separator />
      <SectionTitle>Keys</SectionTitle>
      <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-foreground">
          {keys(TOOL_KEYS.select, TOOL_KEYS.room, TOOL_KEYS.rect)}
        </dt>
        <dd>Select, draw a room, or a rectangle</dd>
        <dt className="text-foreground">
          {keys(OPENING_KEYS.door, OPENING_KEYS.window, OPENING_KEYS.opening)}
        </dt>
        <dd>Cut a door, window, or gap into a wall</dd>
        <dt className="text-foreground">Click</dt>
        <dd>Add a corner; click the first to close</dd>
        <dt className="text-foreground">Drag</dt>
        <dd>Sizes a rectangle; empty space pans</dd>
        <dt className="text-foreground">Double-click</dt>
        <dd>Rename a room or an item; break a selected wall in two</dd>
        <dt className="text-foreground">Pinch</dt>
        <dd>Or ⌘ + scroll to zoom</dd>
        <dt className="text-foreground">{keys(EDIT_KEYS.removeAlt)}</dt>
        <dd>Delete the selection</dd>
        <dt className="text-foreground">{keys(EDIT_KEYS.duplicate)}</dt>
        <dd>Duplicate the selection</dd>
        <dt className="text-foreground">
          {keys(EDIT_KEYS.copy, EDIT_KEYS.paste)}
        </dt>
        <dd>Copy it, and put down another</dd>
        <dt className="text-foreground">
          {keys(EDIT_KEYS.undo, EDIT_KEYS.redo)}
        </dt>
        <dd>Undo, redo</dd>
      </dl>
    </>
  )
}

export function Inspector() {
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
  const openingRoom = opening && rooms.find((r) => r.id === opening.roomId)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l">
      {/*
        The panel above scrolls on its own so that the history below it keeps
        its place at the foot of the sidebar, whatever is selected.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/*
          Remounting on selection change clears any half-typed field drafts, and
          keying on the unit too re-reads the fields when the system switches.
        */}
        {room ? (
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
          <EmptyPanel units={units} />
        )}
      </div>
      <HistoryPanel />
    </aside>
  )
}
