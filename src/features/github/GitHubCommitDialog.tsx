import { useForm } from '@tanstack/react-form'
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
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

import { describeGitHubSync } from './syncStatus.ts'
import {
  TextLink,
  ToneDot,
  downloadProjectFile,
  githubFileUrl,
  nameFor,
} from './dialogShared.tsx'

import type { GitHubSyncController } from './useGithubSync.ts'

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

function IncomingReview({
  controller,
}: Pick<GitHubCommitDialogProps, 'controller'>) {
  const { projects } = controller
  const review = controller.review
  const repository = controller.repository
  if (!review || !repository) return null

  const { changes, conflicts } = review.plan
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
      ) : (
        <p className="text-muted-foreground">
          The repository changed, but no managed plan content changed.
        </p>
      )}

      {conflicts.length > 0 ? (
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>Resolve on GitHub before syncing</AlertTitle>
          <AlertDescription>
            <p>
              A plan changed in both places, or a managed file is invalid. All
              commits are blocked until the GitHub JSON is resolved.
            </p>
            <div className="space-y-3">
              {conflicts.map((conflict) => {
                const local = conflict.projectId
                  ? projects.find(
                      (project) => project.id === conflict.projectId,
                    )
                  : undefined
                return (
                  <div
                    key={`${conflict.path}:${conflict.kind}`}
                    className="border-t pt-3"
                  >
                    <p className="text-foreground font-medium">
                      {local?.name ?? conflict.path}
                    </p>
                    <p className="mt-1 font-mono text-[11px] break-all">
                      {conflict.path}
                    </p>
                    {conflict.error ? (
                      <p className="mt-1">{conflict.error}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button asChild type="button" size="sm" variant="outline">
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
                            variant="outline"
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(serializeProject(local))
                                .then(() => toast.success('Local JSON copied'))
                                .catch(() =>
                                  toast.error('Local JSON could not be copied'),
                                )
                            }}
                          >
                            <IconCopy />
                            Copy local JSON
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
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
              })}
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
    return (
      <p className="text-muted-foreground border p-3">
        Nothing to commit — the repository already matches this browser.
      </p>
    )
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
}: Pick<GitHubCommitDialogProps, 'controller'>) {
  const form = useForm({
    defaultValues: { message: 'Update plans' },
    validators: { onSubmit: commitFormSchema },
    onSubmit: async ({ value }) => {
      if (await controller.commit(value.message.trim())) {
        form.reset()
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
      <DialogContent className="right-4 left-4 mx-auto w-fit max-w-none translate-x-0 text-xs sm:max-w-none">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <ToneDot tone={status.tone} />
            <DialogTitle>{status.title}</DialogTitle>
          </div>
          <DialogDescription>
            {status.detail}
            {controller.repository ? (
              <>
                {' · '}
                <TextLink href={controller.repository.htmlUrl}>
                  {controller.repository.fullName}
                </TextLink>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Connect GitHub and pick a repository before committing.
            </p>
            <Button type="button" onClick={onManageRepository}>
              <IconSettings />
              Set up GitHub sync
            </Button>
          </div>
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
                <CommitForm controller={controller} />
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
