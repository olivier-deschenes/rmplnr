import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconAlertTriangle,
  IconArrowsMove,
  IconChevronLeft,
  IconChevronRight,
  IconFileTypePdf,
  IconFocusCentered,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'

import { useBlobUrl } from './underlay.tsx'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog.tsx'
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
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Slider } from '#/components/ui/slider.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'
import { Switch } from '#/components/ui/switch.tsx'

import { fitViewport, screenToWorld } from '#/lib/planner/geometry.ts'
import { plannerStore } from '#/lib/planner/store.ts'
import {
  calibratedDimensions,
  underlayBounds,
  underlayStore,
} from '#/lib/planner/underlay.ts'
import {
  loadUnderlayPdf,
  prepareImageFile,
} from '#/lib/planner/underlayImport.ts'
import {
  formatLengthInput,
  isMixed,
  parseLengthInput,
  lengthUnit,
} from '#/lib/planner/units.ts'

import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Point } from '#/lib/planner/types.ts'
import type { Underlay } from '#/lib/planner/underlay.ts'
import type {
  LoadedUnderlayPdf,
  PreparedUnderlayAsset,
} from '#/lib/planner/underlayImport.ts'

type DialogMode = 'settings' | 'choose' | 'calibrate'

const STORAGE_FAILURE = {
  quota: 'This browser has no room left for the underlay image.',
  blocked: 'This browser is blocking the underlay image store.',
  unknown: 'The browser could not save the underlay image.',
} as const

function fitUnderlay(underlay: Underlay): void {
  const { size } = plannerStore.state
  if (size.width <= 0 || size.height <= 0) return
  plannerStore.actions.setViewport(
    fitViewport(underlayBounds(underlay), size.width, size.height),
  )
}

function sourceLabel(underlay: Underlay): string {
  return underlay.source === 'pdf' && underlay.page
    ? `PDF page ${underlay.page}`
    : 'Image'
}

function PositionField({ axis, value }: { axis: 'x' | 'y'; value: number }) {
  const units = useSelector(plannerStore, (state) => state.units)
  const label = axis === 'x' ? 'Left edge' : 'Top edge'
  const id = `underlay-position-${axis}`

  const commit = (input: HTMLInputElement) => {
    if (input.value === formatLengthInput(value, units)) return
    const next = parseLengthInput(input.value, units)
    if (next === null) {
      input.value = formatLengthInput(value, units)
      return
    }
    input.value = formatLengthInput(next, units)
    underlayStore.actions.update({ [axis]: next })
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          key={`${units}:${value}`}
          id={id}
          type={isMixed(units) ? 'text' : 'number'}
          step="any"
          defaultValue={formatLengthInput(value, units)}
          className={isMixed(units) ? 'tabular-nums' : 'pr-9 tabular-nums'}
          onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {!isMixed(units) && (
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 grid place-items-center">
            {lengthUnit(units)}
          </span>
        )}
      </div>
    </div>
  )
}

function CalibrationPreview({
  asset,
  url,
  points,
  onPoint,
}: {
  asset: PreparedUnderlayAsset
  url: string
  points: Array<Point>
  onPoint: (point: Point) => void
}) {
  const marker = Math.max(asset.pixelWidth, asset.pixelHeight) * 0.012

  const choose = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onPoint({
      x: ((event.clientX - bounds.left) / bounds.width) * asset.pixelWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * asset.pixelHeight,
    })
  }

  return (
    <div className="flex justify-center overflow-hidden bg-muted/40">
      <div className="relative inline-block max-w-full">
        <img
          src={url}
          alt="Underlay calibration preview"
          className="block h-auto max-h-[48dvh] w-auto max-w-full"
        />
        <svg
          viewBox={`0 0 ${asset.pixelWidth} ${asset.pixelHeight}`}
          className="absolute inset-0 size-full cursor-crosshair touch-none"
          role="button"
          aria-label="Choose two endpoints of a known distance"
          onPointerDown={choose}
        >
          {points.length === 2 && (
            <line
              x1={points[0].x}
              y1={points[0].y}
              x2={points[1].x}
              y2={points[1].y}
              stroke="currentColor"
              strokeWidth={marker / 4}
              className="text-primary"
            />
          )}
          {points.map((point, index) => (
            <g key={index}>
              <circle
                cx={point.x}
                cy={point.y}
                r={marker}
                className="fill-background stroke-primary"
                strokeWidth={marker / 4}
              />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={marker * 1.1}
                className="fill-foreground font-medium"
              >
                {index + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

export function UnderlayDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { underlay, failure, projectId } = useSelector(underlayStore)
  const units = useSelector(plannerStore, (state) => state.units)
  const [mode, setMode] = useState<DialogMode>('choose')
  const [asset, setAsset] = useState<PreparedUnderlayAsset | null>(null)
  const [points, setPoints] = useState<Array<Point>>([])
  const [knownDistance, setKnownDistance] = useState('')
  const [distanceUnits, setDistanceUnits] = useState(units)
  if (distanceUnits !== units) {
    const cm = parseLengthInput(knownDistance, distanceUnits)
    setKnownDistance(cm === null ? '' : formatLengthInput(cm, units))
    setDistanceUnits(units)
  }
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opacity, setOpacity] = useState(underlay?.opacity ?? 0.5)
  const pdf = useRef<LoadedUnderlayPdf | null>(null)
  const request = useRef(0)
  const assetUrl = useBlobUrl(asset?.blob ?? null)

  const discardPdf = () => {
    const current = pdf.current
    pdf.current = null
    if (current) void current.destroy()
  }

  const resetImport = () => {
    request.current += 1
    discardPdf()
    setAsset(null)
    setPoints([])
    setKnownDistance('')
    setPage(1)
    setPageCount(0)
    setReading(false)
    setError(null)
  }

  useEffect(() => {
    if (!open) return
    setMode(underlay ? 'settings' : 'choose')
    setOpacity(underlay?.opacity ?? 0.5)
  }, [open, underlay?.id, underlay?.opacity])

  useEffect(
    () => () => {
      const current = pdf.current
      pdf.current = null
      if (current) void current.destroy()
    },
    [],
  )

  const changeOpen = (next: boolean) => {
    if (!next) resetImport()
    onOpenChange(next)
  }

  const renderPage = async (nextPage: number) => {
    const current = pdf.current
    if (!current || nextPage < 1 || nextPage > current.pageCount) return
    const token = ++request.current
    setReading(true)
    setError(null)
    try {
      const prepared = await current.renderPage(nextPage)
      if (token !== request.current) return
      setAsset(prepared)
      setPage(nextPage)
      setPoints([])
      setMode('calibrate')
    } catch (problem) {
      if (token !== request.current) return
      setError(
        problem instanceof Error
          ? problem.message
          : 'This PDF page could not be rendered.',
      )
    } finally {
      if (token === request.current) setReading(false)
    }
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const token = ++request.current
    discardPdf()
    setAsset(null)
    setPoints([])
    setError(null)
    setReading(true)

    try {
      if (
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
      ) {
        const loaded = await loadUnderlayPdf(file)
        if (token !== request.current) {
          await loaded.destroy()
          return
        }
        pdf.current = loaded
        setPageCount(loaded.pageCount)
        const prepared = await loaded.renderPage(1)
        if (token !== request.current) return
        setAsset(prepared)
        setPage(1)
      } else {
        const prepared = await prepareImageFile(file)
        if (token !== request.current) return
        setPageCount(0)
        setAsset(prepared)
      }
      setMode('calibrate')
    } catch (problem) {
      if (token !== request.current) return
      setError(
        problem instanceof Error
          ? problem.message
          : 'This file could not be read.',
      )
    } finally {
      if (token === request.current) setReading(false)
    }
  }

  const beginRecalibration = () => {
    if (!underlay) return
    resetImport()
    setAsset({
      name: underlay.name,
      source: underlay.source,
      page: underlay.page,
      mimeType: underlay.mimeType,
      blob: underlay.blob,
      pixelWidth: underlay.pixelWidth,
      pixelHeight: underlay.pixelHeight,
    })
    setMode('calibrate')
  }

  const applyCalibration = () => {
    if (!asset || !projectId || points.length !== 2) {
      setError('Choose both endpoints of a known distance.')
      return
    }
    const result = calibratedDimensions(
      asset.pixelWidth,
      asset.pixelHeight,
      points[0],
      points[1],
      parseLengthInput(knownDistance, units) ?? NaN,
    )
    if (!result.ok) {
      setError(result.error)
      return
    }

    const centre = underlay
      ? {
          x: underlay.x + underlay.width / 2,
          y: underlay.y + underlay.height / 2,
        }
      : screenToWorld(
          {
            x: plannerStore.state.size.width / 2,
            y: plannerStore.state.size.height / 2,
          },
          plannerStore.state.viewport,
        )
    const calibrated: Underlay = {
      id: underlay?.id ?? crypto.randomUUID(),
      projectId,
      name: asset.name,
      source: asset.source,
      page: asset.page,
      mimeType: asset.mimeType,
      blob: asset.blob,
      pixelWidth: asset.pixelWidth,
      pixelHeight: asset.pixelHeight,
      x: centre.x - result.width / 2,
      y: centre.y - result.height / 2,
      width: result.width,
      height: result.height,
      opacity: underlay?.opacity ?? 0.5,
      visible: underlay?.visible ?? true,
    }

    void underlayStore.actions.replace(calibrated)
    fitUnderlay(calibrated)
    plannerStore.actions.setTool('room')
    changeOpen(false)
  }

  const positionOnCanvas = () => {
    plannerStore.actions.setTool('select')
    plannerStore.actions.select(null)
    underlayStore.actions.setPositioning(true)
    changeOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'settings'
              ? 'Underlay'
              : mode === 'choose'
                ? 'Import an underlay'
                : 'Calibrate the underlay'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'settings'
              ? 'The background stays locked while you edit normal plan objects.'
              : mode === 'choose'
                ? 'Choose a floor-plan image or one page from a PDF. It stays private in this browser.'
                : 'Click the two ends of a known distance, then enter its real length.'}
          </DialogDescription>
        </DialogHeader>

        {failure && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>Underlay not safely saved</AlertTitle>
            <AlertDescription>{STORAGE_FAILURE[failure]}</AlertDescription>
          </Alert>
        )}

        {mode === 'choose' && (
          <div className="grid gap-4">
            <Input
              type="file"
              accept="image/*,.pdf,application/pdf"
              aria-label="Image or PDF underlay"
              disabled={reading}
              onChange={(event) => void chooseFile(event)}
            />
            <div className="text-muted-foreground flex items-start gap-2">
              <IconUpload className="mt-0.5 size-4 shrink-0" />
              <p>
                Images keep their original resolution. A PDF page is rendered
                locally into a sharp tracing image before it is saved.
              </p>
            </div>
          </div>
        )}

        {reading && (
          <div className="text-muted-foreground flex items-center gap-2 py-4">
            <Spinner /> Preparing the underlay…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>Cannot use this underlay</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {mode === 'calibrate' && asset && assetUrl && (
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {asset.source === 'pdf' ? (
                  <IconFileTypePdf className="size-4 shrink-0" />
                ) : (
                  <IconPhoto className="size-4 shrink-0" />
                )}
                <span className="truncate">{asset.name}</span>
              </div>
              {pageCount > 1 && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Previous PDF page"
                    disabled={page <= 1 || reading}
                    onClick={() => void renderPage(page - 1)}
                  >
                    <IconChevronLeft />
                  </Button>
                  <span className="text-muted-foreground min-w-20 text-center tabular-nums">
                    Page {page} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Next PDF page"
                    disabled={page >= pageCount || reading}
                    onClick={() => void renderPage(page + 1)}
                  >
                    <IconChevronRight />
                  </Button>
                </div>
              )}
            </div>

            <CalibrationPreview
              asset={asset}
              url={assetUrl}
              points={points}
              onPoint={(point) => {
                setPoints((current) =>
                  current.length >= 2 ? [point] : [...current, point],
                )
                setError(null)
              }}
            />

            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor="underlay-known-distance">
                  Known distance ({lengthUnit(units)})
                </Label>
                <Input
                  id="underlay-known-distance"
                  type={isMixed(units) ? 'text' : 'number'}
                  min="0"
                  step="any"
                  value={knownDistance}
                  placeholder={`e.g. ${formatLengthInput(304.8, units)}`}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => {
                    setKnownDistance(event.target.value)
                    setError(null)
                  }}
                />
              </div>
              <p className="text-muted-foreground pb-1">
                {points.length === 0
                  ? 'Choose point 1'
                  : points.length === 1
                    ? 'Choose point 2'
                    : 'Two points selected'}
              </p>
            </div>
          </div>
        )}

        {mode === 'settings' && underlay && (
          <div className="grid gap-5">
            <div className="flex min-w-0 items-start gap-3">
              {underlay.source === 'pdf' ? (
                <IconFileTypePdf className="mt-0.5 size-5 shrink-0" />
              ) : (
                <IconPhoto className="mt-0.5 size-5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium">{underlay.name}</p>
                <p className="text-muted-foreground">
                  {sourceLabel(underlay)} · {underlay.pixelWidth} ×{' '}
                  {underlay.pixelHeight} px
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-y py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="underlay-visible">Visible</Label>
                  <p className="text-muted-foreground">
                    Hide the trace without deleting it.
                  </p>
                </div>
                <Switch
                  id="underlay-visible"
                  checked={underlay.visible}
                  onCheckedChange={(visible) =>
                    underlayStore.actions.update({ visible })
                  }
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <Label htmlFor="underlay-opacity">Opacity</Label>
                  <span className="text-muted-foreground tabular-nums">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <Slider
                  id="underlay-opacity"
                  min={10}
                  max={100}
                  step={5}
                  value={[Math.round(opacity * 100)]}
                  disabled={!underlay.visible}
                  onValueChange={([value]) => setOpacity(value / 100)}
                  onValueCommit={([value]) =>
                    underlayStore.actions.update({ opacity: value / 100 })
                  }
                />
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center gap-2 font-medium">
                <IconArrowsMove className="size-4" /> Position
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PositionField axis="x" value={underlay.x} />
                <PositionField axis="y" value={underlay.y} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={positionOnCanvas}>
                  <IconArrowsMove /> Position on canvas
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fitUnderlay(underlay)}
                >
                  <IconFocusCentered /> Fit underlay to view
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button variant="outline" size="sm" onClick={beginRecalibration}>
                <IconRefresh /> Recalibrate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetImport()
                  setMode('choose')
                }}
              >
                <IconUpload /> Replace file
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                  >
                    <IconTrash /> Delete underlay
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this underlay?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The background image and its calibration will be removed
                      from this browser. The plan itself is unchanged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        void underlayStore.actions.remove()
                        changeOpen(false)
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        <DialogFooter>
          {mode === 'calibrate' && (
            <Button
              size="sm"
              disabled={!asset || points.length !== 2 || !knownDistance}
              onClick={applyCalibration}
            >
              {underlay ? 'Save calibration' : 'Add underlay'}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {mode === 'settings' ? 'Done' : 'Cancel'}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
