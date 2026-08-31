import { describe, expect, it } from 'bun:test'

import {
  UNTOUCHED_PLAN_NAME,
  commitPlanName,
  refreshPlanName,
  typePlanName,
} from './planName.ts'

describe('typing a plan name', () => {
  it('stores a valid name as it is typed, trimmed', () => {
    expect(typePlanName('  Flat  ')).toEqual({
      edit: { draft: '  Flat  ', error: null },
      commit: 'Flat',
    })
  })

  it('complains about a blank name without storing it', () => {
    expect(typePlanName('   ')).toEqual({
      edit: { draft: '   ', error: 'Enter a plan name.' },
      commit: null,
    })
  })
})

describe('committing a plan name', () => {
  it('keeps a valid name and drops the draft', () => {
    expect(commitPlanName('House')).toEqual({
      edit: UNTOUCHED_PLAN_NAME,
      commit: 'House',
    })
  })

  it('rejects a blank name, falling back to the stored one with a reason', () => {
    expect(commitPlanName('')).toEqual({
      edit: { draft: null, error: 'Enter a plan name.' },
      commit: null,
    })
  })
})

describe('a name arriving from the store', () => {
  it('clears a complaint the field is no longer about', () => {
    const rejected = commitPlanName('').edit

    expect(refreshPlanName(rejected)).toEqual(UNTOUCHED_PLAN_NAME)
  })

  it('leaves an untouched field untouched', () => {
    expect(refreshPlanName(UNTOUCHED_PLAN_NAME)).toEqual(UNTOUCHED_PLAN_NAME)
  })

  it('does not take a half-typed name away from the user', () => {
    const typing = typePlanName('Fla').edit

    expect(refreshPlanName(typing)).toEqual(typing)
  })
})
