import { cn } from '#/lib/utils.ts'
import { downloadProjectJson } from '#/lib/planner/projectExport.ts'

import { syncToneBackground } from './syncStatus.ts'

import type { GitHubSyncTone } from './syncStatus.ts'
import type { GitHubSyncController } from './useGithubSync.ts'
import type { Project } from '#/lib/planner/types.ts'

export const NEW_REPOSITORY_URL = (() => {
  // GitHub honours these query params on /new to prefill the form. They are a
  // convenience, not a documented API: the page still works without them.
  const url = new URL('https://github.com/new')
  url.searchParams.set('name', 'rmplnr-plans')
  url.searchParams.set('description', 'Floor plans synced from rmplnr')
  url.searchParams.set('visibility', 'private')
  return url.toString()
})()

export function githubFileUrl(
  repository: NonNullable<GitHubSyncController['repository']>,
  path: string,
): string {
  const branch = repository.defaultBranch
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${repository.htmlUrl}/blob/${branch}/${encodedPath}`
}

/**
 * A plan's name, falling back to the copy carried by a pending review so that
 * plans only present on GitHub still read as names.
 */
export function nameFor(
  projectId: string,
  controller: GitHubSyncController,
): string {
  return (
    controller.projects.find((project) => project.id === projectId)?.name ??
    controller.review?.snapshot.projects.find(
      (remote) => remote.project.id === projectId,
    )?.project.name ??
    projectId
  )
}

/**
 * Save one plan's canonical JSON to a file — the same bytes GitHub holds.
 *
 * This is here for the one place it is needed: a conflict, where the way out
 * is to get the browser's copy somewhere it can be looked at beside the
 * repository's.
 */
export function downloadProjectFile(project: Project): void {
  downloadProjectJson(project, `${project.id}.json`)
}

export function TextLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      className="hover:text-foreground underline underline-offset-3"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  )
}

/** The square status light. Square rather than round to match the sharp UI. */
export function ToneDot({
  tone,
  className,
}: {
  tone: GitHubSyncTone
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0', syncToneBackground[tone], className)}
    />
  )
}
