import { useForm } from '@tanstack/react-form'
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudDownload,
  IconCopy,
  IconDeviceLaptop,
  IconDownload,
  IconExternalLink,
  IconGitCommit,
  IconMinus,
  IconPencil,
  IconPlus,
  IconSettings,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { serializeProject } from '#/lib/planner/planSerialization.ts'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'

import {
  describeGitHubConflict,
  describeGitHubSync,
  isGitHubConflictResolvable,
} from './syncStatus.ts'
import {
  TextLink,
  ToneDot,
  downloadProjectFile,
  githubFileUrl,
  nameFor,
} from './dialogShared.tsx'

import type { GitHubSyncController } from './useGithubSync.ts'
import type { GitHubSyncConflict } from './types.ts'
import type { Project } from '#/lib/planner/types.ts'

interface GitHubCommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  controller: GitHubSyncController
  /** Hands the user to the repository dialog, which owns sync setup. */
  onManageRepository: () => void
}

const commitFormSchema = z.object({
  message: z.string().trim().min(1, 'Enter a commit message.').max(200),
})

function ReviewList({
  label,
  projectIds,
  controller,
}: {
  label: string
  projectIds: Array<string>
  controller: GitHubSyncController
}) {
  if (projectIds.length === 0) return null
  return (
    <li>
      <span className="font-medium">{label}:</span>{' '}
      {projectIds.map((projectId) => nameFor(projectId, controller)).join(', ')}
    </li>
  )
}

/**
 * One conflict, and the way out of it.
 *
 * The five conflict kinds are not one situation with five names: "we both drew
 * on this" and "you deleted it here while GitHub kept editing" call for
 * different words and different consequences. So the card says which one
 * happened, spells out what each button will do, and only then offers them.
 */
function ConflictCard({
  conflict,
  controller,
  repository,
  local,
}: {
  conflict: GitHubSyncConflict
  controller: GitHubSyncController
  repository: NonNullable<GitHubSyncController['repository']>
  local: Project | undefined
}) {
  const copy = describeGitHubConflict(conflict, local !== undefined)
  const resolvable = isGitHubConflictResolvable(conflict)
  // `nameFor` falls back to the ID, which beside the file path is the same
  // UUID twice. An unreadable file has no name to find, so it shows its path.
  const known = conflict.projectId
    ? nameFor(conflict.projectId, controller)
    : null
  const name = local?.name ?? (known === conflict.projectId ? null : known)

  return (
    <div className="border-t pt-3">
      <p className="text-foreground font-medium">{name ?? conflict.path}</p>
      {name ? (
        <p className="mt-0.5 font-mono text-[11px] break-all opacity-70">
          {conflict.path}
        </p>
      ) : null}

      <p className="mt-1.5">{copy.summary}</p>
      {conflict.error ? (
        <p className="mt-1 font-mono text-[11px] break-all">{conflict.error}</p>
      ) : null}
      {copy.manual ? <p className="mt-1.5">{copy.manual}</p> : null}

      {resolvable && copy.remote && copy.local ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={controller.busy}
            className="h-auto flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
            onClick={() => void controller.resolveConflict(conflict, 'remote')}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <IconCloudDownload className="size-3.5 shrink-0" />
              Take GitHub's version
            </span>
            <span className="font-normal opacity-80">{copy.remote}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={controller.busy}
            className="h-auto flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
            onClick={() => void controller.resolveConflict(conflict, 'local')}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <IconDeviceLaptop className="size-3.5 shrink-0" />
              Keep this browser's
            </span>
            <span className="font-normal opacity-80">{copy.local}</span>
          </Button>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild type="button" size="sm" variant="ghost">
          <a
            href={githubFileUrl(repository, conflict.path)}
            target="_blank"
            rel="noreferrer"
          >
            <IconExternalLink />
            Open on GitHub
          </a>
        </Button>
        {local ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard
                  .writeText(serializeProject(local))
                  .then(() => toast.success('Local JSON copied'))
                  .catch(() => toast.error('Local JSON could not be copied'))
              }}
            >
              <IconCopy />
              Copy local JSON
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => downloadProjectFile(local)}
            >
              <IconDownload />
              Export local JSON
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function IncomingReview({
  controller,
}: Pick<GitHubCommitDialogProps, 'controller'>) {
  const { projects } = controller
  const review = controller.review
  const repository = controller.repository
  if (!review || !repository) return null

  const { changes, conflicts } = review.plan
  const resolvableCount = conflicts.filter(isGitHubConflictResolvable).length
  // An unreadable file is not a plan and has no copy to choose between, so
  // neither "pick a side" nor the word "plan" fits a pile made only of those.
  const conflictTitle =
    resolvableCount === 0
      ? conflicts.length === 1
        ? '1 file on GitHub cannot be read'
        : `${conflicts.length} files on GitHub cannot be read`
      : resolvableCount < conflicts.length
        ? `${conflicts.length} conflicts block commits`
        : conflicts.length === 1
          ? '1 plan needs a decision'
          : `${conflicts.length} plans need a decision`
  const hasManagedChanges =
    changes.additions.length > 0 ||
    changes.updates.length > 0 ||
    changes.links.length > 0 ||
    changes.remoteDeletions.length > 0 ||
    changes.converged.length > 0

  return (
    <section className="space-y-3 border p-3">
      <h3 className="font-medium">Incoming from GitHub</h3>

      {hasManagedChanges ? (
        <ul className="text-muted-foreground list-disc space-y-1 pl-4">
          <ReviewList
            label="Add to this browser"
            projectIds={changes.additions}
            controller={controller}
          />
          <ReviewList
            label="Update in this browser"
            projectIds={changes.updates}
            controller={controller}
          />
          <ReviewList
            label="Link matching copies"
            projectIds={changes.links}
            controller={controller}
          />
          <ReviewList
            label="Keep local and stop syncing"
            projectIds={changes.remoteDeletions}
            controller={controller}
          />
          <ReviewList
            label="Already match"
            projectIds={changes.converged}
            controller={controller}
          />
        </ul>
      ) : conflicts.length > 0 ? null : (
        <p className="text-muted-foreground">
          The repository changed, but no managed plan content changed.
        </p>
      )}

      {conflicts.length > 0 ? (
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{conflictTitle}</AlertTitle>
          <AlertDescription>
            <p>
              {resolvableCount === 0
                ? 'Commits stay blocked while the plans folder holds a file this app cannot read.'
                : "Commits are blocked until each one below is settled. Nothing is sent to GitHub by choosing here — a choice that keeps this browser's copy is carried by your next commit."}
            </p>
            {resolvableCount > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-3"
                disabled={controller.busy}
                onClick={() => void controller.resolveAllConflicts('remote')}
              >
                <IconCloudDownload />
                Take GitHub's version for all {resolvableCount}
              </Button>
            ) : null}
            <div className="space-y-3">
              {conflicts.map((conflict) => (
                <ConflictCard
                  key={`${conflict.path}:${conflict.kind}`}
                  conflict={conflict}
                  controller={controller}
                  repository={repository}
                  local={
                    conflict.projectId
                      ? projects.find(
                          (project) => project.id === conflict.projectId,
                        )
                      : undefined
                  }
                />
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <Button
          type="button"
          disabled={controller.busy}
          onClick={() => void controller.confirmReview()}
        >
          <IconCheck />
          Confirm reviewed changes
        </Button>
      )}
    </section>
  )
}

const changeKinds = [
  { key: 'added', label: 'Added', icon: IconPlus },
  { key: 'updated', label: 'Updated', icon: IconPencil },
  { key: 'deleted', label: 'Removed', icon: IconMinus },
] as const

function PendingChanges({
  controller,
}: Pick<GitHubCommitDialogProps, 'controller'>) {
  const { changes } = controller

  if (!changes.hasChanges) {
    return <p className="text-muted-foreground border p-3">Nothing to commit</p>
  }

  return (
    <div className="divide-y border">
      {changeKinds.flatMap(({ key, label, icon: Icon }) =>
        changes[key].map((projectId) => (
          <div
            key={`${key}:${projectId}`}
            className="flex items-center gap-3 px-3 py-2"
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {nameFor(projectId, controller)}
            </span>
            <span className="text-muted-foreground shrink-0">{label}</span>
          </div>
        )),
      )}
    </div>
  )
}

function CommitForm({
  controller,
  onCommitted,
}: Pick<GitHubCommitDialogProps, 'controller'> & { onCommitted: () => void }) {
  const form = useForm({
    defaultValues: { message: 'Update plans' },
    validators: { onSubmit: commitFormSchema },
    onSubmit: async ({ value }) => {
      if (await controller.commit(value.message.trim())) {
        form.reset()
        onCommitted()
      }
    },
  })
  const disabled =
    controller.busy ||
    !controller.changes.canCommit ||
    controller.review !== null ||
    controller.displayState === 'offline'

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="message">
        {(field) => {
          const invalid =
            field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="github-commit-message" className="sr-only">
                  Commit message
                </Label>
                <Input
                  id="github-commit-message"
                  value={field.state.value}
                  placeholder="Commit message"
                  maxLength={200}
                  disabled={disabled}
                  aria-invalid={invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {invalid ? (
                  <p className="text-destructive">Enter a commit message.</p>
                ) : null}
              </div>
              <Button type="submit" disabled={disabled}>
                {controller.busy ? <Spinner /> : <IconGitCommit />}
                Commit
              </Button>
            </div>
          )
        }}
      </form.Field>
    </form>
  )
}

/**
 * Everything about *moving* plans: what is waiting to commit, what GitHub sent
 * back, and the commit itself. Setup lives in `GitHubRepositoryDialog`.
 */
export function GitHubCommitDialog({
  open,
  onOpenChange,
  controller,
  onManageRepository,
}: GitHubCommitDialogProps) {
  const status = describeGitHubSync(controller.displayState, controller.changes)
  const ready = controller.repository !== null && controller.workspace !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="right-4 left-4 mx-auto w-fit max-w-none translate-x-0 text-xs sm:min-w-md sm:max-w-none">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <ToneDot tone={status.tone} />
            <DialogTitle>{status.title}</DialogTitle>
          </div>
          {controller.repository ? (
            <DialogDescription>
              <TextLink href={controller.repository.htmlUrl}>
                {controller.repository.fullName}
              </TextLink>
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {status.detail}
            </DialogDescription>
          )}
        </DialogHeader>

        {!ready ? (
          <Button type="button" onClick={onManageRepository}>
            <IconSettings />
            Set up GitHub sync
          </Button>
        ) : (
          <div className="space-y-4">
            <IncomingReview controller={controller} />

            {controller.review === null ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="font-medium">Waiting to commit</h3>
                  {controller.lastCommitUrl ? (
                    <p className="text-muted-foreground">
                      <TextLink href={controller.lastCommitUrl}>
                        Last commit
                      </TextLink>
                    </p>
                  ) : null}
                </div>
                <PendingChanges controller={controller} />
                <CommitForm
                  controller={controller}
                  onCommitted={() => onOpenChange(false)}
                />
              </section>
            ) : null}

            {controller.actionError ? (
              <Alert variant="destructive">
                <IconAlertTriangle />
                <AlertTitle>The commit needs attention</AlertTitle>
                <AlertDescription>
                  {controller.actionError.message}
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter className="justify-between sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onManageRepository}
              >
                <IconSettings />
                Repository settings
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
