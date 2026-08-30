import { z } from 'zod'

import { parseProjectFile } from '#/lib/planner/planSerialization.ts'

import { hashProject } from './hash.ts'
import { GITHUB_PLAN_DIRECTORY } from './types.ts'

import type { GithubRepositorySnapshot } from './contracts.ts'
import type {
  GitHubInvalidRemoteFile,
  GitHubRemoteFileInput,
  GitHubRemoteProject,
  GitHubRemoteSnapshot,
} from './types.ts'

function projectIdFromPath(path: string): string | undefined {
  const prefix = `${GITHUB_PLAN_DIRECTORY}/`
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return undefined

  const filename = path.slice(prefix.length, -'.json'.length)
  const result = z.uuid().safeParse(filename)
  return result.success ? result.data : undefined
}

function invalidRemoteFile(
  file: GitHubRemoteFileInput,
  error: string,
  projectId?: string,
): GitHubInvalidRemoteFile {
  return {
    path: file.path,
    blobSha: file.blobSha,
    ...(projectId === undefined ? {} : { projectId }),
    error,
  }
}

/** Parses and hashes managed GitHub files without changing local plans. */
export async function createGitHubRemoteSnapshot(
  headSha: string | null,
  files: Iterable<GitHubRemoteFileInput>,
): Promise<GitHubRemoteSnapshot> {
  const projects: Record<string, GitHubRemoteProject> = {}
  const invalidFiles: GitHubInvalidRemoteFile[] = []
  const sortedFiles = [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )

  for (const file of sortedFiles) {
    const pathProjectId = projectIdFromPath(file.path)
    if (!pathProjectId) {
      invalidFiles.push(
        invalidRemoteFile(
          file,
          `Managed plan paths must use ${GITHUB_PLAN_DIRECTORY}/<uuid>.json.`,
        ),
      )
      continue
    }

    try {
      const project = parseProjectFile(file.contents)
      if (project.id !== pathProjectId) {
        invalidFiles.push(
          invalidRemoteFile(
            file,
            'The plan ID does not match its filename.',
            pathProjectId,
          ),
        )
        continue
      }

      projects[project.id] = {
        path: file.path,
        blobSha: file.blobSha,
        contentHash: await hashProject(project),
        project,
      }
    } catch (error) {
      invalidFiles.push(
        invalidRemoteFile(
          file,
          error instanceof Error ? error.message : 'Invalid plan JSON.',
          pathProjectId,
        ),
      )
    }
  }

  return { headSha, projects, invalidFiles }
}

/** Adapts the server snapshot contract to the record map used by sync logic. */
export function toGitHubRemoteSnapshot(
  snapshot: GithubRepositorySnapshot,
): GitHubRemoteSnapshot {
  const projects = Object.fromEntries(
    snapshot.projects.map((remote) => [
      remote.project.id,
      {
        path: remote.path,
        blobSha: remote.blobSha,
        contentHash: remote.contentHash,
        project: remote.project,
      },
    ]),
  )
  const invalidFiles = snapshot.invalidFiles.map((file) => {
    const projectId = projectIdFromPath(file.path)
    return {
      path: file.path,
      blobSha: file.blobSha,
      ...(projectId === undefined ? {} : { projectId }),
      error: file.reason,
    }
  })

  return { headSha: snapshot.headSha, projects, invalidFiles }
}
