import { describe, expect, it } from 'bun:test'

import {
  PT_PER_CM,
  PT_PER_INCH,
  drawingScales,
  exactFitRatio,
  fittedScale,
  fitsOnSheet,
  formatScale,
  pointsPerCm,
  scaleBar,
  sheet,
  sheetViewport,
  unionRect,
} from './planSheet.ts'
import { CM_PER_FOOT, CM_PER_INCH } from './units.ts'

import type { Rect } from './types.ts'

const A4_LANDSCAPE_WIDTH = 841.89
const ROOM: Rect = { x: 0, y: 0, w: 400, h: 300 }

describe('paper geometry', () => {
  it('measures A4 in points, both ways round', () => {
    const portrait = sheet('a4', 'portrait')
    expect(portrait.width).toBeCloseTo(595.28, 1)
    expect(portrait.height).toBeCloseTo(841.89, 1)

    const landscape = sheet('a4', 'landscape')
    expect(landscape.width).toBeCloseTo(A4_LANDSCAPE_WIDTH, 1)
    expect(landscape.height).toBeCloseTo(595.28, 1)
  })

  it('measures Letter as 8.5 by 11 inches', () => {
    const letter = sheet('letter', 'portrait')
    expect(letter.width).toBe(8.5 * PT_PER_INCH)
    expect(letter.height).toBe(11 * PT_PER_INCH)
  })

  it('keeps the drawing frame inside the page and above the title block', () => {
    const page = sheet('a4', 'landscape')
    expect(page.frame.x).toBeGreaterThan(0)
    expect(page.frame.x + page.frame.w).toBeLessThan(page.width)
    expect(page.frame.y + page.frame.h).toBeLessThan(page.height)
  })
})

describe('drawing scale', () => {
  it('puts one metre into two centimetres of paper at 1:50', () => {
    // 100 cm of room at 1:50 is 2 cm of paper, which is 2 * 28.3465 points.
    expect(100 * pointsPerCm(50)).toBeCloseTo(2 * PT_PER_CM, 6)
  })

  it('matches the imperial scales to their spoken names', () => {
    // 1/4" = 1'-0": one printed inch stands for four feet.
    const quarter = drawingScales('imperial').find(
      (scale) => scale.label === '1/4" = 1\'',
    )
    expect(quarter).toBeDefined()
    expect(CM_PER_INCH * (quarter?.ratio ?? 0)).toBeCloseTo(4 * CM_PER_FOOT, 6)
  })

  it('reports a plan span as the paper span the ratio promises', () => {
    // A 5 m wall at 1:100 must measure exactly 5 cm on paper.
    const paperCm = (500 * pointsPerCm(100)) / PT_PER_CM
    expect(paperCm).toBeCloseTo(5, 9)
  })

  it('names known ratios and falls back to a plain one', () => {
    expect(formatScale(50, 'metric')).toBe('1:50')
    expect(formatScale(48, 'imperial')).toBe('1/4" = 1\'')
    expect(formatScale(137.4, 'metric')).toBe('1:137')
  })
})

describe('fitting a plan to a sheet', () => {
  const frame = sheet('a4', 'landscape').frame

  it('snaps outward to a standard scale rather than filling the page', () => {
    const fitted = fittedScale(ROOM, frame, 'metric')
    expect(drawingScales('metric').map((s) => s.ratio)).toContain(fitted.ratio)
    expect(fitted.ratio).toBeGreaterThanOrEqual(exactFitRatio(ROOM, frame))
  })

  it('leaves the plan inside the frame at the fitted scale', () => {
    const fitted = fittedScale(ROOM, frame, 'metric')
    expect(fitsOnSheet(ROOM, frame, fitted.ratio)).toBe(true)
  })

  it('falls back to an exact ratio for a plan larger than every scale', () => {
    const huge: Rect = { x: 0, y: 0, w: 80_000, h: 60_000 }
    const fitted = fittedScale(huge, frame, 'metric')
    expect(fitted.ratio).toBeGreaterThan(200)
    expect(fitsOnSheet(huge, frame, fitted.ratio)).toBe(true)
  })

  it('sees a plan that overflows a chosen scale', () => {
    // A 12 m apartment needs 60 cm of paper at 1:20 and 12 cm at 1:100.
    const flat: Rect = { x: 0, y: 0, w: 1200, h: 900 }
    expect(fitsOnSheet(flat, frame, 20)).toBe(false)
    expect(fitsOnSheet(flat, frame, 100)).toBe(true)
  })
})

describe('sheetViewport', () => {
  const frame = sheet('a4', 'landscape').frame

  it('centres the plan in the drawing frame', () => {
    const viewport = sheetViewport(ROOM, frame, 50)
    const centreX = (ROOM.x + ROOM.w / 2) * viewport.scale + viewport.tx
    const centreY = (ROOM.y + ROOM.h / 2) * viewport.scale + viewport.ty
    expect(centreX).toBeCloseTo(frame.x + frame.w / 2, 6)
    expect(centreY).toBeCloseTo(frame.y + frame.h / 2, 6)
  })

  it('scales by the ratio, not by whatever happens to fit', () => {
    expect(sheetViewport(ROOM, frame, 50).scale).toBe(pointsPerCm(50))
    expect(sheetViewport(ROOM, frame, 100).scale).toBe(pointsPerCm(100))
  })
})

describe('scaleBar', () => {
  it('spans a round distance that fits on the sheet', () => {
    const bar = scaleBar(50, 'metric')
    expect(bar.centimetres % 10).toBe(0)
    expect(bar.length).toBeLessThanOrEqual(140)
    expect(bar.length).toBeCloseTo(bar.centimetres * pointsPerCm(50), 6)
  })

  it('shortens the real distance as the scale zooms in', () => {
    expect(scaleBar(20, 'metric').centimetres).toBeLessThan(
      scaleBar(200, 'metric').centimetres,
    )
  })

  it('counts in feet for imperial plans', () => {
    expect(scaleBar(48, 'imperial').label).toBe('5 ft 0 in')
    expect(scaleBar(48, 'imperial-inches').label).toBe('60 in')
    expect(formatScale(48, 'imperial-inches')).toBe('1 in = 48 in')
  })

  it('keeps the selected metric format even for long scale bars', () => {
    expect(scaleBar(100, 'metric').label).toBe('200 cm')
    expect(scaleBar(100, 'metric-mixed').label).toBe('2 m 0 cm')
    expect(drawingScales('metric-mixed')).toEqual(drawingScales('metric'))
  })
})

describe('unionRect', () => {
  it('ignores a missing side', () => {
    expect(unionRect(ROOM, null)).toEqual(ROOM)
    expect(unionRect(null, ROOM)).toEqual(ROOM)
    expect(unionRect(null, null)).toBeNull()
  })

  it('covers both rectangles', () => {
    const other: Rect = { x: -100, y: 50, w: 100, h: 500 }
    expect(unionRect(ROOM, other)).toEqual({
      x: -100,
      y: 0,
      w: 500,
      h: 550,
    })
  })
})
