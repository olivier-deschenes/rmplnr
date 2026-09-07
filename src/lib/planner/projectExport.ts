import {
  serializeLibraryBackup,
  serializeProject,
} from './planSerialization.ts'

import type { Project } from './types.ts'

const JSON_TYPE = 'application/json'

/** A plan name made safe to use as a friendly filename on every platform. */
export function projectFileName(
  project: Project,
  extension: 'json' | 'png' | 'svg' | 'pdf',
): string {
  const stem = project.name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80)
    .trim()

  return `${stem || 'Plan'}.${extension}`
}

export function projectJsonFileName(project: Project): string {
  return projectFileName(project, 'json')
}

export const LIBRARY_BACKUP_FILE_NAME = 'rmplnr-library-backup.json'

/** The canonical JSON plan as a browser file, ready to download or share. */
export function projectJsonFile(
  project: Project,
  name = projectJsonFileName(project),
): File {
  return new File([serializeProject(project)], name, { type: JSON_TYPE })
}

/** Hand one plan to the browser as a regular JSON download. */
export function downloadProjectJson(
  project: Project,
  name = projectJsonFileName(project),
): void {
  downloadFile(projectJsonFile(project, name), name)
}

/** Every local plan, without browser-only autosave metadata. */
export function libraryBackupFile(
  projects: Array<Project>,
  name = LIBRARY_BACKUP_FILE_NAME,
): File {
  return new File([serializeLibraryBackup(projects)], name, { type: JSON_TYPE })
}

/** Hand the full local library to the browser as one restorable JSON file. */
export function downloadLibraryBackup(
  projects: Array<Project>,
  name = LIBRARY_BACKUP_FILE_NAME,
): void {
  downloadFile(libraryBackupFile(projects, name), name)
}

/** Ask the browser to save a blob under an explicit filename. */
export function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
