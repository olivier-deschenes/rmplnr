import { squareMetres } from './geometry.ts'

import type { Units } from './types.ts'

/** All plan geometry stays in centimetres, regardless of the selected format. */
export const CM_PER_INCH = 2.54
export const CM_PER_FOOT = 30.48
const CM2_PER_SQ_FOOT = CM_PER_FOOT * CM_PER_FOOT

export const UNITS: Array<Units> = [
  'metric',
  'metric-mixed',
  'imperial-inches',
  'imperial',
]

export function isMetric(units: Units): boolean {
  return units === 'metric' || units === 'metric-mixed'
}

export function isMixed(units: Units): boolean {
  return units === 'metric-mixed' || units === 'imperial'
}

/** The format never changes pointer snapping or grid spacing within a system. */
export const SNAP_STEP: Record<Units, number> = {
  metric: 10,
  'metric-mixed': 10,
  'imperial-inches': CM_PER_INCH,
  imperial: CM_PER_INCH,
}

export const GRID: Record<Units, { minor: number; major: number }> = {
  metric: { minor: 10, major: 100 },
  'metric-mixed': { minor: 10, major: 100 },
  'imperial-inches': { minor: CM_PER_INCH, major: CM_PER_FOOT },
  imperial: { minor: CM_PER_INCH, major: CM_PER_FOOT },
}

export const UNIT_LABEL: Record<Units, string> = {
  metric: 'Centimetres only',
  'metric-mixed': 'Metres + centimetres',
  'imperial-inches': 'Inches only',
  imperial: 'Feet + inches',
}

export const UNIT_HINT: Record<Units, string> = {
  metric: 'cm',
  'metric-mixed': 'm + cm',
  'imperial-inches': 'in',
  imperial: 'ft + in',
}

export function lengthUnit(units: Units): string {
  return UNIT_HINT[units]
}

/** Convert the smaller unit (cm or inches), including in mixed formats. */
export function toLength(cm: number, units: Units): number {
  return isMetric(units) ? cm : cm / CM_PER_INCH
}

export function fromLength(value: number, units: Units): number {
  return isMetric(units) ? value : value * CM_PER_INCH
}

/** Round once before splitting, so a remainder never reads 12 in or 100 cm. */
export function formatLengthInput(cm: number, units: Units): string {
  const value = Number(toLength(cm, units).toFixed(2))
  if (!isMixed(units)) return String(value)
  const base = isMetric(units) ? 100 : 12
  const total = Math.abs(value)
  const major = Math.floor(total / base)
  const minor = Number((total - major * base).toFixed(2))
  const sign = value < 0 ? '-' : ''
  return isMetric(units)
    ? `${sign}${major} m ${minor} cm`
    : `${sign}${major} ft ${minor} in`
}

/** Accept a plain number in the smaller unit, or explicit mixed units. */
export function parseLengthInput(input: string, units: Units): number | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[′’]/g, "'")
    .replace(/[″“”]/g, '"')
  if (!text) return null
  const decimal = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const plain = new RegExp(`^[+-]?${decimal}$`)
  let value: number
  if (plain.test(text)) {
    value = Number(text)
  } else {
    const major = isMetric(units) ? 'm' : "(?:ft|')"
    const minor = isMetric(units) ? 'cm' : '(?:in|")'
    const pattern = isMixed(units)
      ? new RegExp(
          `^([+-]?)\\s*(?:(${decimal})\\s*${major}\\s*(?:(${decimal})\\s*(?:${minor})?)?|(${decimal})\\s*${minor})$`,
        )
      : new RegExp(`^([+-]?)\\s*(${decimal})\\s*${minor}$`)
    const match = text.match(pattern)
    if (!match) return null
    value = isMixed(units)
      ? Number(match.at(2) ?? 0) * (isMetric(units) ? 100 : 12) +
        Number(match.at(3) ?? match.at(4) ?? 0)
      : Number(match[2])
    if (match[1] === '-') value = -value
  }
  const cm = fromLength(value, units)
  return Number.isFinite(cm) ? cm : null
}

export function formatLength(cm: number, units: Units): string {
  const value = formatLengthInput(cm, units)
  return isMixed(units) ? value : `${value} ${lengthUnit(units)}`
}

export function formatSize(w: number, h: number, units: Units): string {
  return isMixed(units)
    ? `${formatLength(w, units)} × ${formatLength(h, units)}`
    : `${formatLengthInput(w, units)} × ${formatLength(h, units)}`
}

export function formatArea(areaCm2: number, units: Units, digits = 1): string {
  return isMetric(units)
    ? `${squareMetres(areaCm2).toFixed(digits)} m²`
    : `${(areaCm2 / CM2_PER_SQ_FOOT).toFixed(digits)} ft²`
}

export function formatSnapStep(units: Units): string {
  return formatLength(SNAP_STEP[units], units)
}

/** Geometry validation uses canonical cm; user-facing messages use the preference. */
export function formatMeasurementMessage(
  message: string,
  units: Units,
): string {
  return message.replace(/(-?\d[\d,]*(?:\.\d+)?) cm\b/g, (_, value: string) =>
    formatLength(Number(value.replaceAll(',', '')), units),
  )
}
