import { useSelector } from '@tanstack/react-store'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBarrierBlock,
  IconBrackets,
  IconChevronDown,
  IconCooker,
  IconDoor,
  IconFocusCentered,
  IconMagnet,
  IconMinus,
  IconPlus,
  IconPointer,
  IconRectangle,
  IconSettings,
  IconSofa,
  IconSquareDashed,
  IconTable,
  IconVectorTriangle,
  IconWindow,
} from '@tabler/icons-react'

import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { Kbd } from '#/components/ui/kbd.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { Toggle } from '#/components/ui/toggle.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip.tsx'

import {
  FURNITURE_KINDS,
  FURNITURE_PRESETS,
  OPENING_PRESETS,
  OPENING_TOOLS,
} from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { EDIT_KEYS, OPENING_KEYS, TOOL_KEYS } from '#/lib/planner/shortcuts.ts'
import {
  UNITS,
  UNIT_HINT,
  UNIT_LABEL,
  formatSnapStep,
} from '#/lib/planner/units.ts'

import type { ReactElement } from 'react'
import type { TablerIcon } from '@tabler/icons-react'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { DrawTool } from '#/lib/planner/shortcuts.ts'
import type {
  FurnitureKind,
  OpeningKind,
  Tool,
  Units,
} from '#/lib/planner/types.ts'

/**
 * Fill the active tool solid black; the default muted grey reads as disabled.
 *
 * Which one is active has to be read off ARIA rather than `data-state`: every
 * control in the bar is a tooltip trigger too, and the tooltip writes its own
 * open/closed state into that attribute, over the toggle's. A single-choice
 * group marks its items checked, a toggle standing alone marks itself pressed,
 * and neither is anything the tooltip touches.
 */
const SELECTED_TOOL =
  'aria-checked:bg-foreground aria-checked:text-background aria-pressed:bg-foreground aria-pressed:text-background'

/**
 * What a toggle standing on its own needs to keep step with the segmented
 * groups: their items lose their side padding to the join, so a lone one has
 * to give up the same or it stands a few pixels wider than everything else.
 */
const LONE_TOGGLE = `px-2 ${SELECTED_TOOL}`

/**
 * The bar draws itself in icons, so a control's name lives in its tooltip and
 * nowhere else. Every icon-only control gets one, with the key that would have
 * done the same thing from the canvas.
 */
function Hint({
  label,
  keys,
  children,
}: {
  label: string
  keys?: Hotkey
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {keys && <Kbd>{formatForDisplay(keys)}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** The ways to put a room down, in the order the bar offers them. */
const DRAW_TOOLS: Array<{
  tool: DrawTool
  icon: TablerIcon
  label: string
}> = [
  { tool: 'select', icon: IconPointer, label: 'Select and move' },
  {
    tool: 'room',
    icon: IconVectorTriangle,
    label: 'Draw a room corner by corner',
  },
  {
    tool: 'rect',
    icon: IconRectangle,
    label: 'Drag out a rectangular room',
  },
]

/**
 * The face and shortcut key of each kind of opening the toolbar draws with.
 * A plain gap has no symbol of its own, so it wears its two jambs.
 *
 * Keyed off the list itself, so a kind cannot be added to the bar without
 * being given a face to wear there.
 */
const OPENING_TOOL_UI: Record<
  (typeof OPENING_TOOLS)[number],
  { icon: TablerIcon }
> = {
  door: { icon: IconDoor },
  window: { icon: IconWindow },
  opening: { icon: IconBrackets },
}

/** One per kind, so nothing can reach the Add menu faceless. */
const FURNITURE_ICONS: Record<FurnitureKind, TablerIcon> = {
  table: IconTable,
  sofa: IconSofa,
  kitchen: IconCooker,
  box: IconSquareDashed,
}

/**
 * Furniture is dropped in rather than drawn, so it sits behind one Add menu
 * instead of a button per kind — the bar stays the same width as the catalogue
 * grows.
 */
function AddMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <IconPlus data-icon="inline-start" />
          Add
          <IconChevronDown
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        {FURNITURE_KINDS.map((kind) => {
          const Icon = FURNITURE_ICONS[kind]
          return (
            <DropdownMenuItem
              key={kind}
              onSelect={() => plannerStore.actions.addFurniture(kind)}
            >
              <Icon />
              {FURNITURE_PRESETS[kind].label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Home for editor-wide settings, so the toolbar proper stays about drawing. */
function OptionsMenu() {
  const units = useSelector(plannerStore, (s) => s.units)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Options">
          <IconSettings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Units</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={units}
          onValueChange={(value) =>
            plannerStore.actions.setUnits(value as Units)
          }
        >
          {UNITS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {UNIT_LABEL[value]}
              <span className="text-muted-foreground text-[10px]">
                {UNIT_HINT[value]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Toolbar() {
  const tool = useSelector(plannerStore, (s) => s.tool)
  const openingKind = useSelector(plannerStore, (s) => s.openingKind)
  const snap = useSelector(plannerStore, (s) => s.snap)
  const collide = useSelector(plannerStore, (s) => s.collide)
  const units = useSelector(plannerStore, (s) => s.units)
  const scale = useSelector(plannerStore, (s) => s.viewport.scale)
  const canUndo = useSelector(plannerStore, (s) => s.history.past.length > 0)
  const canRedo = useSelector(plannerStore, (s) => s.history.future.length > 0)
  const actions = plannerStore.actions

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={tool}
        onValueChange={(value) => value && actions.setTool(value as Tool)}
      >
        {DRAW_TOOLS.map(({ tool: value, icon: Icon, label }) => (
          <Hint key={value} label={label} keys={TOOL_KEYS[value]}>
            <ToggleGroupItem
              value={value}
              className={SELECTED_TOOL}
              aria-label={label}
            >
              <Icon />
            </ToggleGroupItem>
          </Hint>
        ))}
      </ToggleGroup>

      {/*
        Openings are placed on a wall rather than dropped on the floor, so they
        are tools of their own: pick one, then click the wall to cut it in.
      */}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={tool === 'opening' ? openingKind : ''}
        onValueChange={(value) =>
          value && actions.setOpeningTool(value as OpeningKind)
        }
      >
        {OPENING_TOOLS.map((kind) => {
          const { icon: Icon } = OPENING_TOOL_UI[kind]
          const label = `Place ${OPENING_PRESETS[kind].label.toLowerCase()} on a wall`
          return (
            <Hint key={kind} label={label} keys={OPENING_KEYS[kind]}>
              <ToggleGroupItem
                value={kind}
                className={SELECTED_TOOL}
                aria-label={label}
              >
                <Icon />
              </ToggleGroupItem>
            </Hint>
          )
        })}
      </ToggleGroup>

      <AddMenu />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Hint label={`Snap to ${formatSnapStep(units)}`}>
        <Toggle
          variant="outline"
          size="sm"
          className={LONE_TOGGLE}
          aria-label="Snap to grid"
          pressed={snap}
          onPressedChange={() => actions.toggleSnap()}
        >
          <IconMagnet />
        </Toggle>
      </Hint>

      {/*
        Furniture holds itself out of the walls and out of everything else,
        which is what the plan is for. Turned off for the times a plan has to
        say something a real room could not — a rug under a table, or two
        layouts drawn over each other to be compared.
      */}
      <Hint label="Keep furniture out of walls and other furniture">
        <Toggle
          variant="outline"
          size="sm"
          className={LONE_TOGGLE}
          aria-label="Collision"
          pressed={collide}
          onPressedChange={() => actions.toggleCollide()}
        >
          <IconBarrierBlock />
        </Toggle>
      </Hint>

      <div className="ml-auto flex items-center gap-0.5">
        <Hint label="Undo" keys={EDIT_KEYS.undo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => actions.undo()}
          >
            <IconArrowBackUp />
          </Button>
        </Hint>
        <Hint label="Redo" keys={EDIT_KEYS.redo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => actions.redo()}
          >
            <IconArrowForwardUp />
          </Button>
        </Hint>

        <Separator orientation="vertical" className="mx-1.5 h-5" />

        <Hint label="Zoom out">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => actions.zoomBy(1 / 1.25)}
          >
            <IconMinus />
          </Button>
        </Hint>
        {/*
          The readout doubles as the way back to life size, so its name has to
          say so — with the percentage it shows still in there.
        */}
        <Hint label="Reset zoom to 100%">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-11 px-0 tabular-nums"
            aria-label={`${Math.round(scale * 100)}% — reset zoom to 100%`}
            onClick={() => actions.zoomTo(1)}
          >
            {Math.round(scale * 100)}%
          </Button>
        </Hint>
        <Hint label="Zoom in">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => actions.zoomBy(1.25)}
          >
            <IconPlus />
          </Button>
        </Hint>
        <Hint label="Fit plan to view">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit plan to view"
            onClick={() => actions.fit()}
          >
            <IconFocusCentered />
          </Button>
        </Hint>

        <Separator orientation="vertical" className="mx-1.5 h-5" />

        <OptionsMenu />
      </div>
    </div>
  )
}
