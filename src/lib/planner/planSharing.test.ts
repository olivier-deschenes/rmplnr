import { closeWallPoints } from '#/lib/planner/geometry.ts'
import { describe, expect, it } from 'bun:test'

import {
  SharedPlanError,
  decodeSharedProject,
  encodeSharedProject,
  projectShareUrl,
} from './planSharing.ts'

import type { Project } from './types.ts'

const project: Project = {
  spaces: [
    { id: 'label-1', name: 'Living', color: '#f59e0b', seed: { x: 50, y: 50 } },
  ],
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Shared flat',
  walls: [
    {
      id: 'room-1',
      name: 'Living room',
      points: closeWallPoints([
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
      ]),
      locked: true,
    },
  ],
  furniture: [
    {
      id: 'sofa-1',
      kind: 'sofa',
      name: 'Sofa',
      x: 100,
      y: 100,
      w: 200,
      h: 90,
      rotation: 15,
    },
  ],
  openings: [
    {
      id: 'door-1',
      kind: 'door',
      runId: 'room-1',
      wall: 0,
      t: 0.5,
      width: 80,
      hinge: 'start',
      swing: 'in',
    },
  ],
}

describe('plan sharing', () => {
  it('round-trips every saved part of a plan', async () => {
    expect(
      await decodeSharedProject(await encodeSharedProject(project)),
    ).toEqual(project)
  })

  it('puts the complete plan in a URL fragment', async () => {
    const url = new URL(
      await projectShareUrl(project, 'https://rmplnr.example/p/local-id'),
    )

    expect(url.origin + url.pathname).toBe('https://rmplnr.example/share')
    expect(url.search).toBe('')
    expect(url.hash).toMatch(/^#[jz]1\./u)
    expect(await decodeSharedProject(url.hash.slice(1))).toEqual(project)
  })

  it('rejects damaged and unknown share formats', async () => {
    await expect(decodeSharedProject('v2.abc')).rejects.toBeInstanceOf(
      SharedPlanError,
    )
    await expect(decodeSharedProject('v1.not-gzip')).rejects.toBeInstanceOf(
      SharedPlanError,
    )
  })
})
