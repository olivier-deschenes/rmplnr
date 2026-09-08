import { describe, expect, it } from 'bun:test'

import { mergeLibraries, sameLibrary, samePlan } from './libraryMerge.ts'

import type { Furniture, Project } from './types.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function sofa(id: string, x = 0): Furniture {
  return { id, kind: 'sofa', name: 'Sofa', x, y: 0, w: 200, h: 90, rotation: 0 }
}

function plan(
  id: string,
  name: string,
  furniture: Array<Furniture> = [],
): Project {
  return { id, name, walls: [], furniture, openings: [], spaces: [] }
}

/** The plans a merge came to, or the names it could not decide between. */
function merged(result: ReturnType<typeof mergeLibraries>) {
  return result.kind === 'merged'
    ? result.projects.map((p) => p.id)
    : result.plans.map((p) => p.name)
}

describe('samePlan', () => {
  it('ignores a key set to nothing, which storage would not have kept', () => {
    const drawn = { walls: [], furniture: [sofa('s1')], openings: [] }
    const spread = {
      walls: [],
      furniture: [{ ...sofa('s1'), name: 'Sofa' }],
      openings: [],
    }

    expect(samePlan(drawn, spread)).toBe(true)
    expect(samePlan(drawn, { ...drawn, furniture: [sofa('s1', 10)] })).toBe(
      false,
    )
  })

  it('does not read a name as part of the drawing', () => {
    expect(sameLibrary([plan(A, 'Flat')], [plan(A, 'House')])).toBe(false)
    expect(samePlan(plan(A, 'Flat'), plan(A, 'House'))).toBe(true)
  })
})

describe('mergeLibraries', () => {
  it('keeps both tabs’ work when they drew on different plans', () => {
    const base = [plan(A, 'Flat'), plan(B, 'House')]
    const mine = [plan(A, 'Flat', [sofa('mine')]), plan(B, 'House')]
    const theirs = [plan(A, 'Flat'), plan(B, 'House', [sofa('theirs')])]

    const result = mergeLibraries(base, mine, theirs)

    expect(result.kind).toBe('merged')
    expect(merged(result)).toEqual([A, B])
    if (result.kind !== 'merged') throw new Error('unreachable')
    expect(result.projects[0].furniture[0].id).toBe('mine')
    expect(result.projects[1].furniture[0].id).toBe('theirs')
  })

  it('reports a plan both tabs drew on rather than picking one', () => {
    const base = [plan(A, 'Flat')]
    const mine = [plan(A, 'Flat', [sofa('mine')])]
    const theirs = [plan(A, 'Flat', [sofa('theirs')])]

    const result = mergeLibraries(base, mine, theirs)

    expect(result.kind).toBe('conflict')
    expect(merged(result)).toEqual(['Flat'])
  })

  it('reads a rename in both tabs as a clash like any other', () => {
    const result = mergeLibraries(
      [plan(A, 'Flat')],
      [plan(A, 'Attic')],
      [plan(A, 'Studio')],
    )

    expect(result.kind).toBe('conflict')
  })

  it('takes a change only one tab made, whichever tab made it', () => {
    const base = [plan(A, 'Flat')]
    const theirs = [plan(A, 'Flat', [sofa('theirs')])]

    expect(merged(mergeLibraries(base, base, theirs))).toEqual([A])
    expect(mergeLibraries(base, base, theirs)).toEqual({
      kind: 'merged',
      projects: theirs,
    })
    expect(mergeLibraries(base, theirs, base)).toEqual({
      kind: 'merged',
      projects: theirs,
    })
  })

  it('takes a plan either tab has just started', () => {
    expect(merged(mergeLibraries([], [plan(A, 'Flat')], []))).toEqual([A])
    expect(merged(mergeLibraries([], [], [plan(B, 'House')]))).toEqual([B])
    expect(
      merged(mergeLibraries([], [plan(A, 'Flat')], [plan(B, 'House')])),
    ).toEqual([B, A])
  })

  it('leaves a plan deleted in one tab deleted, deletion having no undo', () => {
    const base = [plan(A, 'Flat'), plan(B, 'House')]

    expect(merged(mergeLibraries(base, [plan(A, 'Flat')], base))).toEqual([A])
    expect(merged(mergeLibraries(base, base, [plan(A, 'Flat')]))).toEqual([A])
  })

  it('asks about a plan one tab deleted and the other drew on', () => {
    const base = [plan(A, 'Flat'), plan(B, 'House')]
    const drawn = [plan(A, 'Flat'), plan(B, 'House', [sofa('s1')])]

    expect(mergeLibraries(base, drawn, [plan(A, 'Flat')]).kind).toBe('conflict')
    expect(mergeLibraries(base, [plan(A, 'Flat')], drawn).kind).toBe('conflict')
  })

  it('has nothing to settle when both tabs made the same change', () => {
    const base = [plan(A, 'Flat')]
    const both = [plan(A, 'Flat', [sofa('s1')])]

    expect(mergeLibraries(base, both, both)).toEqual({
      kind: 'merged',
      projects: both,
    })
  })
})
