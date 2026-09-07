import { CM_PER_FOOT, CM_PER_INCH, formatLength, isMetric } from './units.ts'

import type { Rect, Units, Viewport } from './types.ts'

/**
 * Paper geometry for the printable plan.
 *
 * A printed plan is only useful if a ruler laid on it agrees with the drawing
 * scale, so everything here works in PostScript points — the unit a PDF page is
 * measured in — and the plan's centimetres are mapped onto them by an explicit
 * ratio rather than by whatever happened to fit. `1:50` means one centimetre of
 * paper carries fifty centimetres of room, on every printer, at 100%.
 */
export const PT_PER_INCH = 72
export const PT_PER_MM = PT_PER_INCH / 25.4
export const PT_PER_CM = PT_PER_INCH / 2.54

export type PaperSize = 'a4' | 'a3' | 'letter' | 'legal' | 'tabloid'
export type Orientation = 'portrait' | 'landscape'

/** Portrait dimensions in points, the way a PDF page box is written. */
const PAPER_POINTS: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 210 * PT_PER_MM, height: 297 * PT_PER_MM },
  a3: { width: 297 * PT_PER_MM, height: 420 * PT_PER_MM },
  letter: { width: 8.5 * PT_PER_INCH, height: 11 * PT_PER_INCH },
  legal: { width: 8.5 * PT_PER_INCH, height: 14 * PT_PER_INCH },
  tabloid: { width: 11 * PT_PER_INCH, height: 17 * PT_PER_INCH },
}

export const PAPER_LABEL: Record<PaperSize, string> = {
  a4: 'A4',
  a3: 'A3',
  letter: 'Letter',
  legal: 'Legal',
  tabloid: 'Tabloid',
}

/** What each paper measures, for the menu's secondary text. */
export const PAPER_HINT: Record<PaperSize, string> = {
  a4: '210 × 297 mm',
  a3: '297 × 420 mm',
  letter: '8.5 × 11 in',
  legal: '8.5 × 14 in',
  tabloid: '11 × 17 in',
}

export const PAPER_SIZES: Array<PaperSize> = [
  'a4',
  'a3',
  'letter',
  'legal',
  'tabloid',
]

/** Printer-safe border, and the strip the title block keeps for itself. */
export const SHEET_MARGIN = 12 * PT_PER_MM
export const TITLE_BLOCK_HEIGHT = 16 * PT_PER_MM

export type Sheet = {
  paper: PaperSize
  orientation: Orientation
  /** The whole page, in points. */
  width: number
  height: number
  /** The area the drawing itself may use, inside the margin and title block. */
  frame: Rect
}

/** The smallest rectangle covering both, ignoring whichever one is absent. */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: right - x, h: bottom - y }
}

export function sheet(paper: PaperSize, orientation: Orientation): Sheet {
  const { width, height } = PAPER_POINTS[paper]
  const landscape = orientation === 'landscape'
  const pageWidth = landscape ? height : width
  const pageHeight = landscape ? width : height

  return {
    paper,
    orientation,
    width: pageWidth,
    height: pageHeight,
    frame: {
      x: SHEET_MARGIN,
      y: SHEET_MARGIN,
      w: pageWidth - SHEET_MARGIN * 2,
      h: pageHeight - SHEET_MARGIN * 2 - TITLE_BLOCK_HEIGHT,
    },
  }
}

/**
 * The drawing scales a builder would recognise. Each is stored as the number of
 * real centimetres carried by one centimetre of paper, so metric and imperial
 * choices stay comparable and the viewport maths never has to branch.
 */
export type DrawingScale = { ratio: number; label: string }

const METRIC_SCALES: Array<DrawingScale> = [
  { ratio: 20, label: '1:20' },
  { ratio: 25, label: '1:25' },
  { ratio: 50, label: '1:50' },
  { ratio: 75, label: '1:75' },
  { ratio: 100, label: '1:100' },
  { ratio: 200, label: '1:200' },
]

// 1/4" = 1'-0" puts twelve inches into a quarter inch, so the ratio is 48.
const IMPERIAL_SCALES: Array<DrawingScale> = [
  { ratio: 12, label: '1" = 1\'' },
  { ratio: 24, label: '1/2" = 1\'' },
  { ratio: 48, label: '1/4" = 1\'' },
  { ratio: 64, label: '3/16" = 1\'' },
  { ratio: 96, label: '1/8" = 1\'' },
  { ratio: 192, label: '1/16" = 1\'' },
]

export function drawingScales(units: Units): Array<DrawingScale> {
  if (isMetric(units)) return METRIC_SCALES
  return units === 'imperial-inches'
    ? IMPERIAL_SCALES.map(({ ratio }) => ({
        ratio,
        label: `1 in = ${ratio} in`,
      }))
    : IMPERIAL_SCALES
}

/** How a ratio reads once it is on the sheet, including odd fitted ones. */
export function formatScale(ratio: number, units: Units): string {
  const known = drawingScales(units).find(
    (scale) => Math.abs(scale.ratio - ratio) < 0.001,
  )
  if (known) return known.label
  return `1:${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`
}

/** Points of paper per centimetre of plan, at one drawing scale. */
export function pointsPerCm(ratio: number): number {
  return PT_PER_CM / ratio
}

/** The exact ratio at which `bounds` just fills `frame`. */
export function exactFitRatio(bounds: Rect, frame: Rect): number {
  const perCm = Math.min(
    frame.w / Math.max(bounds.w, 1),
    frame.h / Math.max(bounds.h, 1),
  )
  return PT_PER_CM / Math.max(perCm, Number.EPSILON)
}

/**
 * The tightest standard scale the plan still fits at. Printing to a ratio a
 * ruler can check is worth more than filling the last few millimetres, so a
 * fitted sheet snaps outward to a real scale and only falls back to the exact
 * ratio when the plan is larger than every scale on the list.
 */
export function fittedScale(
  bounds: Rect,
  frame: Rect,
  units: Units,
): DrawingScale {
  const needed = exactFitRatio(bounds, frame)
  const standard = drawingScales(units).find((scale) => scale.ratio >= needed)
  if (standard) return standard

  const ratio = needed
  return { ratio, label: formatScale(ratio, units) }
}

export function fitsOnSheet(bounds: Rect, frame: Rect, ratio: number): boolean {
  const perCm = pointsPerCm(ratio)
  return bounds.w * perCm <= frame.w && bounds.h * perCm <= frame.h
}

/** Centre the plan in the drawing frame at an exact, unrounded scale. */
export function sheetViewport(
  bounds: Rect,
  frame: Rect,
  ratio: number,
): Viewport {
  const scale = pointsPerCm(ratio)
  return {
    scale,
    tx: frame.x + frame.w / 2 - (bounds.x + bounds.w / 2) * scale,
    ty: frame.y + frame.h / 2 - (bounds.y + bounds.h / 2) * scale,
  }
}

const METRIC_BAR_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
const IMPERIAL_BAR_STEPS = [1, 2, 5, 10, 20, 50, 100].map(
  (feet) => feet * CM_PER_FOOT,
)

export type ScaleBar = {
  /** Real centimetres the bar spans. */
  centimetres: number
  /** How long that is on paper, in points. */
  length: number
  label: string
}

const BAR_MAX = 140

/**
 * A bar the reader can measure. It names a round real distance and is drawn the
 * length that distance actually occupies, so a photocopy scaled to 94% still
 * tells the truth about itself even though the printed ratio no longer does.
 */
export function scaleBar(ratio: number, units: Units): ScaleBar {
  const steps = isMetric(units) ? METRIC_BAR_STEPS : IMPERIAL_BAR_STEPS
  const perCm = pointsPerCm(ratio)

  const fitting = steps.filter((step) => step * perCm <= BAR_MAX)
  const centimetres =
    fitting.length > 0
      ? (fitting[fitting.length - 1] ?? steps[0])
      : (steps[0] ?? 100)

  const length = centimetres * perCm
  return { centimetres, length, label: formatLength(centimetres, units) }
}

/** The plan distance one printed inch stands for, for the title block. */
export function inchesLabel(ratio: number, units: Units): string {
  const cm = ratio * CM_PER_INCH
  return `1 in ≈ ${formatLength(cm, units)}`
}
