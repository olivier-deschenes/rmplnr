import { describe, expect, it } from 'bun:test'

import {
  projectFileName,
  projectJsonFile,
  projectJsonFileName,
} from './projectExport.ts'
import { serializeProject } from './planSerialization.ts'

import type { Project } from './types.ts'

const project: Project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Main / Floor',
  rooms: [],
  furniture: [],
  openings: [],
}

describe('projectJsonFileName', () => {
  it('uses a safe, friendly JSON filename', () => {
    expect(projectJsonFileName(project)).toBe('Main - Floor.json')
    expect(projectFileName(project, 'png')).toBe('Main - Floor.png')
  })

  it('falls back when the plan has no usable name', () => {
    expect(projectJsonFileName({ ...project, name: '...' })).toBe('Plan.json')
  })
})

describe('projectJsonFile', () => {
  it('contains the canonical plan JSON', async () => {
    const file = projectJsonFile(project)
    expect(file.name).toBe('Main - Floor.json')
    expect(file.type).toContain('application/json')
    expect(await file.text()).toBe(serializeProject(project))
  })
})
