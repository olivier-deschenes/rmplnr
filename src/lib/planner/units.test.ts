import { describe, expect, it } from 'bun:test'

import { PrefsSchema } from './types.ts'
import {
  CM_PER_INCH,
  GRID,
  SNAP_STEP,
  UNITS,
  formatArea,
  formatLength,
  formatLengthInput,
  formatMeasurementMessage,
  formatSize,
  parseLengthInput,
} from './units.ts'

describe('measurement formats', () => {
  it('always uses the selected length format, including zero and whole major units', () => {
    expect(formatLength(304.8, 'imperial-inches')).toBe('120 in')
    expect(formatLength(304.8, 'imperial')).toBe('10 ft 0 in')
    expect(formatLength(300, 'metric')).toBe('300 cm')
    expect(formatLength(300, 'metric-mixed')).toBe('3 m 0 cm')
    expect(formatLength(0, 'imperial')).toBe('0 ft 0 in')
    expect(formatLength(5, 'metric-mixed')).toBe('0 m 5 cm')
    expect(formatSize(150, 200, 'metric-mixed')).toBe('1 m 50 cm × 2 m 0 cm')
    expect(formatSize(152.4, 304.8, 'imperial-inches')).toBe('60 × 120 in')
  })

  it('normalizes rounded remainders and negative positions', () => {
    expect(formatLength(11.999 * CM_PER_INCH, 'imperial')).toBe('1 ft 0 in')
    expect(formatLength(199.999, 'metric-mixed')).toBe('2 m 0 cm')
    expect(formatLength(-13.5 * CM_PER_INCH, 'imperial')).toBe('-1 ft 1.5 in')
    expect(formatLength(-50, 'metric-mixed')).toBe('-0 m 50 cm')
    expect(formatLength(-0.001, 'metric')).toBe('0 cm')
  })

  for (const units of UNITS) {
    it(`round trips displayed inputs in ${units} without losing more than display precision`, () => {
      for (const cm of [
        -1000, -30.48, -1.27, 0, 1.27, 30.48, 150, 304.8, 1234.567,
      ]) {
        const parsed = parseLengthInput(formatLengthInput(cm, units), units)
        expect(parsed).not.toBeNull()
        expect(Math.abs(parsed! - cm)).toBeLessThanOrEqual(0.013)
      }
      expect(PrefsSchema.parse({ version: 1, units }).units).toBe(units)
      for (const invalid of [
        '',
        ' ',
        'NaN',
        'Infinity',
        '10garbage',
        '1/0',
        '1 ft -2 in',
        '2 m -10 cm',
      ]) {
        expect(parseLengthInput(invalid, units)).toBeNull()
      }
    })
  }

  it('accepts signed, decimal and abbreviated mixed input', () => {
    for (const input of [
      '5 ft 6 in',
      `5' 6"`,
      '5′6″',
      '5ft6',
      '66',
      '66 in',
      '5.5 ft',
    ]) {
      expect(parseLengthInput(input, 'imperial')).toBeCloseTo(167.64, 8)
    }
    expect(parseLengthInput('-0 ft 6 in', 'imperial')).toBeCloseTo(-15.24, 8)
    expect(parseLengthInput('2 m 35.5 cm', 'metric-mixed')).toBe(235.5)
    expect(parseLengthInput('-2m35cm', 'metric-mixed')).toBe(-235)
    expect(parseLengthInput('2.5m', 'metric-mixed')).toBe(250)
    expect(parseLengthInput('35cm', 'metric-mixed')).toBe(35)
    expect(parseLengthInput('1 m 100 cm', 'metric-mixed')).toBe(200)
    expect(parseLengthInput('5 ft 12 in', 'imperial')).toBeCloseTo(182.88, 8)
    expect(parseLengthInput('5 ft', 'imperial-inches')).toBeNull()
    expect(parseLengthInput('2m', 'metric')).toBeNull()
  })

  it('uses the selected format in dimension validation messages', () => {
    expect(
      formatMeasurementMessage(
        'Walls must be at least 10 cm long.',
        'imperial-inches',
      ),
    ).toBe('Walls must be at least 3.94 in long.')
    expect(
      formatMeasurementMessage('Keep within 100,000 cm.', 'metric-mixed'),
    ).toBe('Keep within 1000 m 0 cm.')
  })

  it('keeps area units, snapping and grid consistent within each system', () => {
    expect(formatArea(10000, 'metric-mixed')).toBe(formatArea(10000, 'metric'))
    expect(formatArea(10000, 'imperial-inches')).toBe(
      formatArea(10000, 'imperial'),
    )
    expect(SNAP_STEP['metric-mixed']).toBe(SNAP_STEP.metric)
    expect(SNAP_STEP['imperial-inches']).toBe(SNAP_STEP.imperial)
    expect(GRID['metric-mixed']).toEqual(GRID.metric)
    expect(GRID['imperial-inches']).toEqual(GRID.imperial)
  })
})
