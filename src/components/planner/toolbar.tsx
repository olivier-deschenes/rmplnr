import { useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'

import { FURNITURE_KINDS, FURNITURE_PRESETS } from '#/lib/planner/presets.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { SNAP_STEP } from '#/lib/planner/types.ts'

import type { Tool } from '#/lib/planner/types.ts'

/** Fill the active tool solid black; the default muted grey reads as disabled. */
const SELECTED_TOOL =
  'data-[state=on]:bg-foreground data-[state=on]:text-background'

export function Toolbar() {
  const tool = useSelector(plannerStore, (s) => s.tool)
  const snap = useSelector(plannerStore, (s) => s.snap)
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
        <ToggleGroupItem value="select" className={SELECTED_TOOL}>
          Select
        </ToggleGroupItem>
        <ToggleGroupItem value="room" className={SELECTED_TOOL}>
          Room
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
        Snap {SNAP_STEP} cm
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
      </div>
    </div>
  )
}
