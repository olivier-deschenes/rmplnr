import { useSelector } from '@tanstack/react-store'
import { IconSettings } from '@tabler/icons-react'

import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'

import { FURNITURE_KINDS, FURNITURE_PRESETS } from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import {
  UNITS,
  UNIT_HINT,
  UNIT_LABEL,
  formatSnapStep,
} from '#/lib/planner/units.ts'

import type { Tool, Units } from '#/lib/planner/types.ts'

/** Fill the active tool solid black; the default muted grey reads as disabled. */
const SELECTED_TOOL =
  'data-[state=on]:bg-foreground data-[state=on]:text-background'

/** Home for editor-wide settings, so the toolbar proper stays about drawing. */
function OptionsMenu() {
  const units = useSelector(plannerStore, (s) => s.units)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Options">
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
  const snap = useSelector(plannerStore, (s) => s.snap)
  const units = useSelector(plannerStore, (s) => s.units)
  const scale = useSelector(plannerStore, (s) => s.viewport.scale)
  const actions = plannerStore.actions

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={tool}
        onValueChange={(value) => value && actions.setTool(value as Tool)}
      >
        <ToggleGroupItem
          value="select"
          className={SELECTED_TOOL}
          title="Select and move (V)"
        >
          Select
        </ToggleGroupItem>
        <ToggleGroupItem
          value="room"
          className={SELECTED_TOOL}
          title="Draw a room corner by corner (R)"
        >
          Room
        </ToggleGroupItem>
        <ToggleGroupItem
          value="rect"
          className={SELECTED_TOOL}
          title="Drag out a rectangular room, or click for a default one (E)"
        >
          Rectangle
        </ToggleGroupItem>
      </ToggleGroup>

      <Separator orientation="vertical" className="h-5" />

      {FURNITURE_KINDS.map((kind) => (
        <Button
          key={kind}
          variant="outline"
          size="sm"
          onClick={() => actions.addFurniture(kind)}
        >
          + {FURNITURE_PRESETS[kind].label}
        </Button>
      ))}

      <Separator orientation="vertical" className="h-5" />

      <Label htmlFor="snap" className="gap-2">
        <Switch
          id="snap"
          checked={snap}
          onCheckedChange={() => actions.toggleSnap()}
        />
        Snap {formatSnapStep(units)}
      </Label>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => actions.zoomBy(1 / 1.25)}
        >
          −
        </Button>
        <span className="text-muted-foreground w-10 text-center text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => actions.zoomBy(1.25)}
        >
          +
        </Button>
        <Button variant="outline" size="sm" onClick={() => actions.fit()}>
          Fit
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <OptionsMenu />
      </div>
    </div>
  )
}
