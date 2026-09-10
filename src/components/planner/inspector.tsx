import { useId, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconBrush,
  IconLock,
  IconLockOpen,
  IconTrash,
} from '@tabler/icons-react'
import { toast } from 'sonner'

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
import { Switch } from '#/components/ui/switch.tsx'

import { plannerStore } from '#/lib/planner/store.ts'
import { cn } from '#/lib/utils.ts'
import {
  HINGED_KINDS,
  FURNITURE_PRESETS,
  OPENING_KINDS,
  OPENING_PRESETS,
  SIDED_KINDS,
} from '#/lib/planner/presets.ts'
import { closetSize } from '#/lib/planner/closets.ts'
import {
  enclosureLocked,
  enclosureWalls,
  enclosuresOf,
  closetFloor,
  planFloors,
} from '#/lib/planner/enclosures.ts'
import { runWallAt, wallCount } from '#/lib/planner/openings.ts'
import {
  clearanceName,
  clearancesFor,
  orderedClearances,
} from '#/lib/planner/clearances.ts'
import {
  angleBetween,
  loopsBack,
  normalizeAngle,
} from '#/lib/planner/geometry.ts'
import {
  formatArea,
  formatLength,
  formatLengthInput,
  formatMeasurementMessage,
  isMixed,
  parseLengthInput,
  lengthUnit,
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
  Selection,
  WallRun,
  StyleBrush,
  Units,
} from '#/lib/planner/types.ts'
import type { PlanNameEdit } from '#/lib/planner/planName.ts'
import type { Enclosure } from '#/lib/planner/enclosures.ts'

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
  units,
  disabled = false,
}: {
  label: string
  value: number
  onCommit: (next: number) => string | null | void
  min?: number
  precision?: number
  units?: Units
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const commit = () => {
    if (draft === null) return
    const parsed = units
      ? parseLengthInput(draft, units)
      : Number.parseFloat(draft)
    if (parsed === null || !Number.isFinite(parsed)) {
      setError(
        units
          ? `Enter a length, e.g. ${formatLength(150, units)}.`
          : 'Enter a number.',
      )
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
    <Label className="grid gap-1.5" htmlFor={id}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <Input
        id={id}
        type={units && isMixed(units) ? 'text' : 'number'}
        step="any"
        disabled={disabled}
        value={
          draft ??
          (units
            ? formatLengthInput(value, units)
            : String(Number(value.toFixed(precision))))
        }
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
          className="text-destructive text-xs"
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
      value={cm}
      min={min}
      units={units}
      disabled={disabled}
      onCommit={onCommit}
    />
  )
}

/**
 * The room left around the selected thing, on every side that has any — and
 * every one of them a way to move it.
 *
 * A plan is laid out by its gaps far more than by its coordinates: nobody
 * decides that a bed belongs at x=214, they decide it wants sixty either side
 * to get past it. So the gaps the drawing already puts up while something is
 * dragged are written here too, as fields, and typing into one moves the
 * selection until that gap measures what was asked for. The number that comes
 * back afterwards is the one that is really there — a piece of furniture
 * brought up against a wall stops at the wall, and says so by reading zero.
 *
 * Each gap is named by the way it runs on the page, because a gap has no name
 * of its own and the drawing beside the panel is where the reader is looking.
 * A side already up against something has no gap and no field: there is
 * nothing there to measure, and nothing to be gained by moving further that
 * way.
 */
function ClearanceFields({
  selection,
  units,
  disabled = false,
}: {
  selection: Selection
  units: Units
  disabled?: boolean
}) {
  const walls = useSelector(plannerStore, (s) => s.walls)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)

  const clearances = clearancesFor(selection, walls, furniture, openings)
  if (clearances.length === 0) return null

  return (
    <div className="grid gap-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Gaps</SectionTitle>
        {/*
          The unit is said once over the group rather than after every field.
          Everything else in the panel is named by a noun, which carries one
          happily — "Width cm" reads. A gap is named by the way it runs, and a
          direction does not: "Left in", "Down ft + in".
        */}
        <span className="text-muted-foreground text-xs">
          {lengthUnit(units)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {orderedClearances(clearances).map((clearance) => (
          <NumberField
            key={clearance.key}
            label={clearanceName(clearance.dir)}
            value={clearance.distance}
            units={units}
            min={0}
            disabled={disabled}
            onCommit={(next) => {
              const result = plannerStore.actions.setClearance(
                clearance.key,
                next,
              )
              return result.ok ? null : result.error
            }}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        {disabled
          ? 'How much room there is on each side.'
          : 'How much room there is on each side. Type a distance to move this until the gap measures it.'}
      </p>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-medium">{children}</h2>
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
    <Label className="grid gap-1.5" htmlFor={id}>
      <span className="text-muted-foreground text-xs">Name</span>
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
          className="text-destructive text-xs"
        >
          {edit.error}
        </span>
      ) : null}
    </Label>
  )
}

/** Native color input, wrapped in the same shadcn controls as the inspector. */
function ColorField({
  value,
  onChange,
}: {
  value?: string
  onChange: (next: string | undefined) => void
}) {
  const id = useId()
  const displayed = value ?? '#e5e7eb'

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        Color
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="color"
          value={displayed}
          aria-label="Choose color"
          className="h-8 w-12 cursor-pointer p-1"
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => plannerStore.actions.sealHistory()}
        />
        <span className="text-muted-foreground flex-1 font-mono text-xs">
          {value ?? 'Default'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => {
            onChange(undefined)
            plannerStore.actions.sealHistory()
          }}
        >
          Reset
        </Button>
      </div>
    </div>
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

/**
 * The padlock on a space the walls close in.
 *
 * The space has no outline to hold, so the lock goes on to the runs that close
 * it in — every one of them, since a space is only as held as its least held
 * wall. It reads as locked once they all are, which is also what the reader
 * sees on each of those runs' own padlocks.
 */
function EnclosureLockButton({
  enclosure,
  walls,
}: {
  enclosure: Enclosure
  walls: Array<WallRun>
}) {
  const locked = enclosureLocked(walls, enclosure)
  const held = enclosureWalls(walls, enclosure).length
  return (
    <Button
      variant={locked ? 'secondary' : 'ghost'}
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs"
      aria-pressed={locked}
      disabled={held === 0}
      onClick={() =>
        plannerStore.actions.setEnclosureLocked(enclosure.key, !locked)
      }
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

/**
 * A space the walls close in that was never drawn as a room of its own.
 *
 * It is a room, and the panel treats it as one: a name, a colour, a padlock,
 * and its area read off the walls that close it. Moving the floor carries its
 * surrounding wall runs together; individual walls are edited by selecting one.
 */
function EnclosurePanel({
  enclosure,
  walls,
  units,
}: {
  enclosure: Enclosure
  walls: Array<WallRun>
  units: Units
}) {
  const actions = plannerStore.actions
  const named = enclosure.space !== null

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Room</SectionTitle>
        <EnclosureLockButton enclosure={enclosure} walls={walls} />
      </div>
      {!named && (
        <Alert>
          <AlertDescription>
            These walls close in a room. Give it a name and it joins the plan.
          </AlertDescription>
        </Alert>
      )}
      <NameField
        value={enclosure.space?.name ?? ''}
        onChange={(name) => actions.updateEnclosure(enclosure.key, { name })}
      />
      <ColorField
        value={enclosure.space?.color}
        onChange={(color) =>
          actions.updateEnclosure(enclosure.key, { color: color ?? undefined })
        }
      />
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-2 text-[13px]">
        <dt>Area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {formatArea(enclosure.floor, units, 2)}
        </dd>
        <dt>Walls</dt>
        <dd className="text-foreground text-right tabular-nums">
          {enclosure.points.length}
        </dd>
      </dl>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Drag inside this room to move its wall group, or use the arrow keys.
        Select a wall to change this room’s shape. Locking this room holds the
        surrounding walls in place.
      </p>
      {named && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.clearEnclosure(enclosure.key)}
        >
          Clear name and colour
        </Button>
      )}
    </>
  )
}

function ClosetPanel({
  run,
  host,
  units,
}: {
  run: WallRun
  host?: WallRun
  units: Units
}) {
  const actions = plannerStore.actions
  const size = closetSize(run)

  return (
    <>
      <SectionTitle>Closet</SectionTitle>
      <NameField
        value={run.name}
        onChange={(name) => actions.updateRun(run.id, { name })}
      />
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Width"
          cm={size.width}
          units={units}
          min={MIN_SIZE}
          onCommit={(width) => actions.updateCloset(run.id, { width })}
        />
        <LengthField
          label="Depth"
          cm={size.depth}
          units={units}
          min={MIN_SIZE}
          onCommit={(depth) => actions.updateCloset(run.id, { depth })}
        />
      </div>
      <ClearanceFields
        selection={{ type: 'run', id: run.id }}
        units={units}
        disabled={run.locked === true}
      />
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-2 text-[13px]">
        <dt>Attached to</dt>
        <dd className="text-foreground truncate text-right">
          {host?.name ?? 'Missing room'}
        </dd>
        <dt>Area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {formatArea(closetFloor(run), units, 2)}
        </dd>
      </dl>
      <SelectionActions duplicate={false} />
    </>
  )
}

function RunLockButton({ run }: { run: WallRun }) {
  const locked = run.locked === true
  return (
    <Button
      variant={locked ? 'secondary' : 'ghost'}
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs"
      aria-pressed={locked}
      onClick={() => plannerStore.actions.setRunLocked(run.id, !locked)}
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

function ContinueWalls({ run }: { run: WallRun }) {
  if (loopsBack(run.points)) return null
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Continue drawing from either end.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={run.locked}
          onClick={() => plannerStore.actions.continueWalls(run.id, 'start')}
        >
          Continue from start
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={run.locked}
          onClick={() => plannerStore.actions.continueWalls(run.id, 'end')}
        >
          Continue from end
        </Button>
      </div>
    </div>
  )
}

function RunPanel({ run }: { run: WallRun }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Walls</SectionTitle>
        <RunLockButton run={run} />
      </div>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Select a wall or its measurement to change its length and angle. Drag a
        corner to reshape it.
      </p>
      <ContinueWalls run={run} />
      <SelectionActions deletable={!run.locked} />
    </>
  )
}

function WallPanel({
  run,
  index,
  units,
}: {
  run: WallRun
  index: number
  units: Units
}) {
  // Why a wall could not be taken out is about the wall rather than about
  // anything typed, so it is held here rather than under a field.
  const [removal, setRemoval] = useState<string | null>(null)
  const wall = runWallAt(run, index)
  if (!wall) return null
  const locked = run.locked === true
  const change = (patch: { length?: number; angle?: number }) => {
    const result = plannerStore.actions.setWallDimensions(run.id, index, patch)
    return result.ok ? null : formatMeasurementMessage(result.error, units)
  }
  // Only a run of walls has a wall to give up; a room has to become its walls
  // first, and the button that does that is on the room.
  const removable = run.kind !== 'closet'
  const remove = () => {
    const result = plannerStore.actions.removeWall(run.id, index)
    // A wall that goes takes this panel with it: the run is what is left to
    // hold, so there is nothing here to clear the message off.
    setRemoval(result.ok ? null : formatMeasurementMessage(result.error, units))
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>
          Wall {index + 1} of {wallCount(run)}
        </SectionTitle>
        <RunLockButton run={run} />
      </div>
      <ContinueWalls run={run} />
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
            Unlock {run.name} to edit this wall.
          </AlertDescription>
        </Alert>
      ) : null}
      <ClearanceFields
        selection={{ type: 'wall', id: run.id, index }}
        units={units}
        disabled={locked}
      />
      {removable ? (
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          aria-label={`Remove wall ${index + 1} of ${run.name}`}
          onClick={remove}
        >
          <IconTrash />
          Remove wall
        </Button>
      ) : null}
      {removal ? (
        <Alert variant="destructive">
          <AlertDescription role="alert">{removal}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-2 text-[13px]">
        <dt>In</dt>
        <dd className="text-foreground truncate text-right">{run.name}</dd>
        <dt>Anchor</dt>
        <dd className="text-foreground text-right">Start corner</dd>
      </dl>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        The start corner stays fixed. 0° points right; angles increase
        clockwise. You can resize a wall and keep drawing from its updated
        endpoint.
      </p>
    </>
  )
}

/**
 * The colour of this item, picked up to be put down on others — the format
 * painter of a word processor, for a floor plan.
 *
 * One click takes the colour and spends it on the next item clicked; a
 * double-click keeps the brush in hand for as many as it is walked over, the
 * way that button has always worked. Clicking it again, or Escape on the
 * canvas, puts it down unspent.
 */
function StyleBrushButton({
  item,
  brush,
}: {
  item: Furniture
  brush: StyleBrush | null
}) {
  const actions = plannerStore.actions

  return (
    <div className="grid gap-1.5">
      <Button
        variant={brush ? 'default' : 'outline'}
        size="sm"
        aria-pressed={brush !== null}
        title="Double-click to keep the brush for several items"
        onClick={() =>
          brush ? actions.dropStyle() : actions.pickUpStyle(item.id)
        }
        onDoubleClick={() => actions.pickUpStyle(item.id, true)}
      >
        <IconBrush />
        {brush ? 'Painting — click furniture' : 'Copy color to furniture'}
      </Button>
      {brush ? (
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          {brush.sticky
            ? 'Paint as many items as you like. Escape puts the brush down.'
            : 'Click an item to paint it. Double-click the brush to paint several.'}
        </p>
      ) : null}
    </div>
  )
}

function FurniturePanel({ item, units }: { item: Furniture; units: Units }) {
  const actions = plannerStore.actions
  const brush = useSelector(plannerStore, (s) => s.brush)
  const collisionId = useId()
  const update = (patch: Partial<Furniture>) =>
    actions.updateFurniture(item.id, patch)
  const savePreset = () => {
    if (!actions.saveFurniturePreset(item.id)) return
    toast.success(`${item.name.trim()} saved to custom presets.`)
  }

  return (
    <>
      <SectionTitle>{FURNITURE_PRESETS[item.kind].label}</SectionTitle>
      <NameField value={item.name} onChange={(name) => update({ name })} />
      <ColorField value={item.color} onChange={(color) => update({ color })} />
      <StyleBrushButton item={item} brush={brush} />
      <div className="grid grid-cols-2 gap-2">
        <LengthField
          label="Width"
          cm={item.w}
          units={units}
          min={MIN_SIZE}
          onCommit={(w) => update({ w })}
        />
        <LengthField
          label="Depth"
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
      <ClearanceFields
        selection={{ type: 'furniture', id: item.id }}
        units={units}
      />
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="grid gap-0.5">
          <Label htmlFor={collisionId} className="text-xs">
            Solid footprint
          </Label>
          <p
            id={`${collisionId}-description`}
            className="text-muted-foreground text-[13px] leading-relaxed"
          >
            Keep this item out of walls and other solid items.
          </p>
        </div>
        <Switch
          id={collisionId}
          checked={item.collides !== false}
          aria-describedby={`${collisionId}-description`}
          onCheckedChange={(collides) => update({ collides })}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={item.name.trim().length === 0 || item.name.trim().length > 80}
        onClick={savePreset}
      >
        Save as custom preset
      </Button>
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
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
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
  run,
  units,
}: {
  opening: Opening
  run: WallRun
  units: Units
}) {
  const actions = plannerStore.actions
  const update = (patch: Partial<Opening>) =>
    actions.updateOpening(opening.id, patch)
  const wall = runWallAt(run, opening.wall)
  if (!wall) return null

  // Kept as a fraction, shown as the distance from the wall's first corner:
  // the number someone standing in the room with a tape measure would want.
  const offset = opening.t * wall.length

  return (
    <>
      <SectionTitle>{OPENING_PRESETS[opening.kind].label}</SectionTitle>
      <Label className="grid gap-1.5">
        <span className="text-muted-foreground text-xs">Type</span>
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
      <ClearanceFields
        selection={{ type: 'opening', id: opening.id }}
        units={units}
      />
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-2 text-[13px]">
        <dt>In</dt>
        <dd className="text-foreground truncate text-right">{run.name}</dd>
        <dt>Wall</dt>
        <dd className="text-foreground text-right tabular-nums">
          {opening.wall + 1} of {wallCount(run)}
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
  const walls = useSelector(plannerStore, (s) => s.walls)
  const spaces = useSelector(plannerStore, (s) => s.spaces)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)
  const name = useSelector(
    plannerStore,
    (s) => s.projects.find((p) => p.id === s.projectId)?.name ?? '',
  )
  const floors = planFloors(walls, spaces)

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
      <dl className="text-muted-foreground grid grid-cols-2 gap-y-2 text-[13px]">
        <dt>Floor area</dt>
        <dd className="text-foreground text-right tabular-nums">
          {formatArea(floors.floor, units, 2)}
        </dd>
        <dt>Rooms</dt>
        <dd className="text-foreground text-right tabular-nums">
          {floors.count}
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
      <p className="text-muted-foreground border-t pt-4 text-[13px] leading-relaxed">
        Select a room, wall, or piece of furniture to edit its details.
      </p>
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
  const walls = useSelector(plannerStore, (s) => s.walls)
  const spaces = useSelector(plannerStore, (s) => s.spaces)
  const furniture = useSelector(plannerStore, (s) => s.furniture)
  const openings = useSelector(plannerStore, (s) => s.openings)
  const units = useSelector(plannerStore, (s) => s.units)

  const enclosure =
    selection?.type === 'enclosure'
      ? enclosuresOf(walls, spaces).find((found) => found.key === selection.id)
      : undefined

  const run =
    selection?.type === 'run'
      ? walls.find((r) => r.id === selection.id)
      : undefined
  const item =
    selection?.type === 'furniture'
      ? furniture.find((f) => f.id === selection.id)
      : undefined
  const opening =
    selection?.type === 'opening'
      ? openings.find((o) => o.id === selection.id)
      : undefined
  const wallRun =
    selection?.type === 'wall'
      ? walls.find((candidate) => candidate.id === selection.id)
      : undefined
  const openingRun = opening && walls.find((r) => r.id === opening.runId)
  const closetHost =
    run?.kind === 'closet' && run.attachment
      ? walls.find((candidate) => candidate.id === run.attachment?.runId)
      : undefined

  return (
    <aside
      aria-label="Inspector"
      className={cn(
        'flex w-72 shrink-0 flex-col border-l bg-background',
        className,
      )}
    >
      {/*
        The panel above scrolls on its own so that the history below it keeps
        its place at the foot of the sidebar, whatever is selected.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/*
          Remounting on selection change clears any half-typed field drafts, and
          keying on the unit too re-reads the fields when the system switches.
        */}
        {wallRun && selection?.type === 'wall' ? (
          <WallPanel
            key={`${wallRun.id}-${selection.index}-${units}`}
            run={wallRun}
            index={selection.index}
            units={units}
          />
        ) : run?.kind === 'closet' ? (
          <ClosetPanel
            key={`${run.id}-${units}`}
            run={run}
            host={closetHost}
            units={units}
          />
        ) : run ? (
          <RunPanel key={`${run.id}-${units}`} run={run} />
        ) : enclosure ? (
          <EnclosurePanel
            key={`${enclosure.key}-${units}`}
            enclosure={enclosure}
            walls={walls}
            units={units}
          />
        ) : item ? (
          <FurniturePanel
            key={`${item.id}-${units}`}
            item={item}
            units={units}
          />
        ) : opening && openingRun ? (
          <OpeningPanel
            key={`${opening.id}-${units}`}
            opening={opening}
            run={openingRun}
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
