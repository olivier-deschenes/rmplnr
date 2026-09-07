import { useEffect, useMemo, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconAlertTriangle,
  IconFileTypeSvg,
  IconPrinter,
  IconRuler,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import {
  DEFAULT_SHEET_OPTIONS,
  downloadPlanSheetSvg,
  printPlanSheet,
  resolvedScale,
  sheetExtent,
} from './plan-sheet.tsx'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'

import {
  PAPER_HINT,
  PAPER_LABEL,
  PAPER_SIZES,
  drawingScales,
  fitsOnSheet,
  scaleBar,
  sheet,
} from '#/lib/planner/planSheet.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import { underlayStore } from '#/lib/planner/underlay.ts'

import type { SheetOptions } from './plan-sheet.tsx'
import type { PaperSize } from '#/lib/planner/planSheet.ts'
import type { Project } from '#/lib/planner/types.ts'

const FIT = 'fit'

/**
 * The sheet setup, kept in front of the print dialog rather than behind it.
 *
 * Paper and scale are decisions about the drawing, not about the printer, so
 * they are made here and then handed to the browser as a fixed page box. What
 * the reader sees on screen is what comes out at 100%.
 */
export function PrintDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const units = useSelector(plannerStore, (state) => state.units)
  const underlay = useSelector(underlayStore, (state) => state.underlay)
  const [options, setOptions] = useState<SheetOptions>(DEFAULT_SHEET_OPTIONS)
  const [working, setWorking] = useState<'pdf' | 'svg' | null>(null)

  // An underlay that has since been deleted must not stay switched on.
  useEffect(() => {
    if (!underlay) setOptions((current) => ({ ...current, underlay: false }))
  }, [underlay])

  const background = options.underlay ? (underlay ?? undefined) : undefined
  const page = sheet(options.paper, options.orientation)
  const scales = drawingScales(units)

  const scale = useMemo(
    () =>
      project
        ? resolvedScale(project, units, options, background)
        : { ratio: 50, label: '1:50' },
    [project, units, options, background],
  )

  const overflows = useMemo(() => {
    if (!project || options.ratio === null) return false
    return !fitsOnSheet(
      sheetExtent(project, background),
      page.frame,
      options.ratio,
    )
  }, [project, options.ratio, page.frame, background])

  const set = <TKey extends keyof SheetOptions>(
    key: TKey,
    value: SheetOptions[TKey],
  ) => setOptions((current) => ({ ...current, [key]: value }))

  const run = async (kind: 'pdf' | 'svg') => {
    if (!project) return
    setWorking(kind)
    try {
      if (kind === 'pdf') {
        await printPlanSheet(project, units, options, background)
      } else {
        await downloadPlanSheetSvg(project, units, options, background)
        toast.success('Saved the plan as SVG.')
      }
    } catch {
      toast.error(
        kind === 'pdf'
          ? 'Could not prepare the plan for printing.'
          : 'Could not export the SVG drawing.',
      )
    } finally {
      setWorking(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print or export to scale</DialogTitle>
          <DialogDescription>
            The sheet is drawn at a stated scale and carries a scale bar. Choose
            “Save as PDF” in the print dialog, and print at 100%.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sheet-paper">Paper</Label>
              <Select
                value={options.paper}
                onValueChange={(value) => set('paper', value as PaperSize)}
              >
                <SelectTrigger id="sheet-paper" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_SIZES.map((paper) => (
                    <SelectItem key={paper} value={paper}>
                      {PAPER_LABEL[paper]}
                      <span className="text-muted-foreground ml-2">
                        {PAPER_HINT[paper]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Orientation</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={options.orientation}
                onValueChange={(value) => {
                  if (value === 'portrait' || value === 'landscape') {
                    set('orientation', value)
                  }
                }}
                className="w-full"
              >
                <ToggleGroupItem value="portrait" className="flex-1">
                  Portrait
                </ToggleGroupItem>
                <ToggleGroupItem value="landscape" className="flex-1">
                  Landscape
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sheet-scale">Drawing scale</Label>
            <Select
              value={options.ratio === null ? FIT : String(options.ratio)}
              onValueChange={(value) =>
                set('ratio', value === FIT ? null : Number(value))
              }
            >
              <SelectTrigger id="sheet-scale" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FIT}>
                  Fit to page
                  <span className="text-muted-foreground ml-2">
                    tightest standard scale
                  </span>
                </SelectItem>
                {scales.map((option) => (
                  <SelectItem key={option.ratio} value={String(option.ratio)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="sheet-dimensions">Wall dimensions</Label>
              <p className="text-muted-foreground">
                Turn off for a clean drawing to mark up by hand.
              </p>
            </div>
            <Switch
              id="sheet-dimensions"
              checked={options.dimensions}
              onCheckedChange={(value) => set('dimensions', value)}
            />
          </div>

          {underlay && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="sheet-underlay">Include underlay</Label>
                <p className="text-muted-foreground">
                  Print the tracing background behind the plan.
                </p>
              </div>
              <Switch
                id="sheet-underlay"
                checked={options.underlay}
                onCheckedChange={(value) => set('underlay', value)}
              />
            </div>
          )}

          <div className="text-muted-foreground flex items-start gap-2 border-t pt-3">
            <IconRuler className="mt-0.5 size-4 shrink-0" />
            <p>
              {PAPER_LABEL[options.paper]} {options.orientation} at{' '}
              <span className="text-foreground font-medium">{scale.label}</span>
              . The scale bar spans {scaleBar(scale.ratio, units).label}.
            </p>
          </div>

          {overflows && (
            <Alert variant="destructive">
              <IconAlertTriangle />
              <AlertTitle>The plan runs off this sheet</AlertTitle>
              <AlertDescription>
                At {scale.label} the drawing is wider or taller than the
                printable area. Choose a smaller scale, a larger paper, or fit
                it to the page.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="outline"
            size="sm"
            disabled={!project || working !== null}
            onClick={() => void run('svg')}
          >
            <IconFileTypeSvg />
            SVG drawing
          </Button>
          <Button
            size="sm"
            disabled={!project || working !== null}
            onClick={() => void run('pdf')}
          >
            <IconPrinter />
            {working === 'pdf' ? 'Preparing…' : 'PDF / print'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
