import { squareMetres } from './geometry.ts'

import type { Units } from './types.ts'

/**
 * Everything in the plan is stored in centimetres. Unit systems only change how
 * those numbers are shown and how coarsely the pointer snaps, so switching one
 * on never rewrites the plan.
 */
export const CM_PER_INCH = 2.54
export const CM_PER_FOOT = 30.48
const CM2_PER_SQ_FOOT = CM_PER_FOOT * CM_PER_FOOT
const INCHES_PER_FOOT = 12

export const UNITS: Array<Units> = ['metric', 'imperial']

/** Pointer snap step: a round unit in each system. */
export const SNAP_STEP: Record<Units, number> = {
  metric: 10,
  imperial: CM_PER_INCH,
}

/** Grid spacing in centimetres: 10 cm / 1 m, against 1 in / 1 ft. */
export const GRID: Record<Units, { minor: number; major: number }> = {
  metric: { minor: 10, major: 100 },
  imperial: { minor: CM_PER_INCH, major: CM_PER_FOOT },
}

export const UNIT_LABEL: Record<Units, string> = {
  metric: 'Metric',
  imperial: 'Imperial',
}

/** What each system measures in, for the menu's secondary text. */
export const UNIT_HINT: Record<Units, string> = {
  metric: 'cm · m²',
  imperial: 'in · ft²',
}

// --- inspector fields -------------------------------------------------------

/** Suffix for the raw numbers the inspector's fields take. */
export function lengthUnit(units: Units): string {
  return units === 'metric' ? 'cm' : 'in'
}

/** Centimetres in whatever unit the inspector's number fields work in. */
export function toLength(cm: number, units: Units): number {
  return units === 'metric' ? cm : cm / CM_PER_INCH
}

export function fromLength(value: number, units: Units): number {
  return units === 'metric' ? value : value * CM_PER_INCH
}

/** Decimals a field needs before rounding starts eating a snap step. */
export function lengthPrecision(units: Units): number {
  return units === 'metric' ? 0 : 2
}

// --- canvas labels ----------------------------------------------------------

/** A single span, sized for a canvas label: `140 cm`, or `4' 7"`. */
export function formatLength(cm: number, units: Units): string {
  if (units === 'metric') return `${Math.round(cm)} cm`
  const inches = Math.round(cm / CM_PER_INCH)
  const feet = Math.floor(inches / INCHES_PER_FOOT)
  const rest = inches - feet * INCHES_PER_FOOT
  if (feet === 0) return `${rest}"`
  return rest === 0 ? `${feet}'` : `${feet}' ${rest}"`
}

/** The `w × h` readout under a selected item, with one shared unit in metric. */
export function formatSize(w: number, h: number, units: Units): string {
  return units === 'metric'
    ? `${Math.round(w)} × ${Math.round(h)} cm`
    : `${formatLength(w, units)} × ${formatLength(h, units)}`
}

export function formatArea(areaCm2: number, units: Units, digits = 1): string {
  return units === 'metric'
    ? `${squareMetres(areaCm2).toFixed(digits)} m²`
    : `${(areaCm2 / CM2_PER_SQ_FOOT).toFixed(digits)} ft²`
}

/** Label for the snap switch, which names the step it lands on. */
export function formatSnapStep(units: Units): string {
  return units === 'metric' ? `${SNAP_STEP.metric} cm` : '1 in'
}
