import { serializeProject } from '#/lib/planner/planSerialization.ts'

import type { Project } from '#/lib/planner/types.ts'

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function hashProject(project: Project): Promise<string> {
  return sha256Hex(serializeProject(project))
}

export async function hashProjects(
  projects: Iterable<Project>,
): Promise<Partial<Record<string, string>>> {
  const entries = await Promise.all(
    [...projects].map(
      async (project) => [project.id, await hashProject(project)] as const,
    ),
  )

  return Object.fromEntries(entries)
}
