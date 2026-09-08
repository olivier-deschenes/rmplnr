import { describe, expect, it } from 'bun:test'

import {
  LIBRARY_BACKUP_FILE_NAME,
  libraryBackupFile,
  projectFileName,
  projectJsonFile,
  projectJsonFileName,
} from './projectExport.ts'
import {
  parseLibraryBackupFile,
  serializeLibraryBackup,
  serializeProject,
} from './planSerialization.ts'

import type { Project } from './types.ts'

const project: Project = {
  spaces: [],
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Main / Floor',
  walls: [],
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

  it('trims the plan name in exported JSON', async () => {
    const file = projectJsonFile({ ...project, name: '  Main Floor  ' })

    expect(JSON.parse(await file.text()).name).toBe('Main Floor')
  })

  it('does not create a file whose blank name would fail to parse', () => {
    expect(() => projectJsonFile({ ...project, name: '   ' })).toThrow(
      'Enter a plan name.',
    )
  })
})

describe('libraryBackupFile', () => {
  it('contains every plan in restorable JSON', async () => {
    const other = {
      ...project,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Upstairs',
    }
    const file = libraryBackupFile([project, other])

    expect(file.name).toBe(LIBRARY_BACKUP_FILE_NAME)
    expect(file.type).toContain('application/json')
    expect(await file.text()).toBe(serializeLibraryBackup([project, other]))
    expect(parseLibraryBackupFile(await file.text()).projects).toEqual([
      project,
      other,
    ])
  })
})
