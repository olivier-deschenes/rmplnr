import { useForm } from '@tanstack/react-form'
import {
  IconAlertTriangle,
  IconArrowBackUp,
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
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { serializeProject } from '#/lib/planner/planSerialization.ts'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog.tsx'
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
  describeGitHubPlanDiscard,
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
import type { GitHubPendingChangeKind } from './syncStatus.ts'
import type { GitHubConflictResolution, GitHubSyncConflict } from './types.ts'
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

  const choices: Array<{
    resolution: GitHubConflictResolution
    label: string
    description: string
    icon: typeof IconCloudDownload
  }> =
    resolvable &&
    copy.remoteLabel &&
    copy.remote &&
    copy.localLabel &&
    copy.local
      ? [
          {
            resolution: 'remote',
            label: copy.remoteLabel,
            description: copy.remote,
            icon: IconCloudDownload,
          },
          {
            resolution: 'local',
            label: copy.localLabel,
            description: copy.local,
            icon: copy.destructive === 'local' ? IconTrash : IconDeviceLaptop,
          },
        ]
      : []

  return (
    <div className="border-t p-3">
      <p className="text-foreground font-medium">{name ?? conflict.path}</p>
      {name ? (
        <p className="text-muted-foreground mt-0.5 font-mono text-[11px] break-all">
          {conflict.path}
        </p>
      ) : null}

      <p className="mt-1.5">{copy.summary}</p>
      {conflict.error ? (
        <p className="mt-1 font-mono text-[11px] break-all">{conflict.error}</p>
      ) : null}
      {copy.manual ? <p className="mt-1.5">{copy.manual}</p> : null}

      {choices.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {choices.map((choice) => {
            const Icon = choice.icon
            const recommended = copy.recommended === choice.resolution
            const destructive = copy.destructive === choice.resolution

            return (
              <Button
                key={choice.resolution}
                type="button"
                variant={
                  destructive
                    ? 'destructive'
                    : recommended
                      ? 'default'
                      : 'outline'
                }
                disabled={controller.busy}
                className="h-auto min-w-0 justify-start gap-2 px-3 py-3 text-left whitespace-normal"
                onClick={() =>
                  void controller.resolveConflict(conflict, choice.resolution)
                }
              >
                <Icon className="size-4 shrink-0 self-start" />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {choice.label}
                    {recommended ? (
                      <span className="ml-1.5 font-normal opacity-70">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block font-normal opacity-80">
                    {choice.description}
                  </span>
                </span>
              </Button>
            )
          })}
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
            Review on GitHub
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
    <section className="space-y-3">
      {hasManagedChanges ? (
        <div className="space-y-2 border p-3">
          <h3 className="font-medium">Incoming changes</h3>
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
        </div>
      ) : conflicts.length > 0 ? null : (
        <p className="text-muted-foreground border p-3">
          The repository changed, but no managed plan content changed.
        </p>
      )}

      {conflicts.length > 0 ? (
        <div className="border" role="alert">
          <div className="flex gap-2 p-3">
            <IconAlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">{conflictTitle}</p>
              <p className="text-muted-foreground mt-0.5">
                {resolvableCount === 0
                  ? 'Your next commit is paused while the plans folder holds a file this app cannot read.'
                  : 'Your next commit is paused. Choosing here updates this browser; nothing changes on GitHub until you commit.'}
              </p>
            </div>
          </div>
          {resolvableCount > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mx-3 mb-3"
              disabled={controller.busy}
              onClick={() => void controller.resolveAllConflicts('remote')}
            >
              <IconCloudDownload />
              Use GitHub versions for all {resolvableCount}
            </Button>
          ) : null}
          <div>
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
        </div>
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
            className="flex items-center gap-3 py-1.5 pr-2 pl-3"
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {nameFor(projectId, controller)}
            </span>
            <span className="text-muted-foreground shrink-0">{label}</span>
            {changes.blockedByConflicts ? null : (
              <DiscardPlanChange
                controller={controller}
                projectId={projectId}
                kind={key}
              />
            )}
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
 * The shell every discard is asked through.
 *
 * Discarding is the one thing in this dialog that destroys work, and it comes
 * in two sizes — one row, or the lot. Both are asked the same way so that the
 * small one is not the cheap one: the question, then what it does, then a
 * button that names the act rather than agreeing to it.
 */
function DiscardConfirm({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
  children,
}: {
  trigger: React.ReactNode
  title: string
  description: string
  confirm: string
  onConfirm: () => void
  children?: React.ReactNode
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Keep my changes</AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            variant="destructive"
            onClick={onConfirm}
          >
            <IconArrowBackUp />
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One row's way out: put this plan back the way the repository has it, and
 * leave everything else waiting to commit.
 *
 * The three kinds want three different sentences — an edit is thrown away, a
 * removal is undone, and an addition GitHub has never seen can only stop being
 * synced — so the copy comes from the plan's kind rather than from the button.
 */
function DiscardPlanChange({
  controller,
  projectId,
  kind,
}: Pick<GitHubCommitDialogProps, 'controller'> & {
  projectId: string
  kind: GitHubPendingChangeKind
}) {
  const name = nameFor(projectId, controller)
  const copy = describeGitHubPlanDiscard(kind, name)

  return (
    <DiscardConfirm
      title={copy.title}
      description={copy.description}
      confirm={copy.confirm}
      onConfirm={() => void controller.discardLocalChanges([projectId])}
      trigger={
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Discard the change to ${name}`}
          className="text-muted-foreground hover:text-destructive shrink-0"
          disabled={controller.busy || controller.displayState === 'offline'}
        >
          <IconX />
        </Button>
      }
    />
  )
}

/**
 * The same way out for everything at once: throw away all of it and take the
 * repository's copy.
 *
 * It stands under the commit button, quietly — one is the ordinary end of a
 * session's work and the other undoes it. What it would do is spelled out plan
 * by plan first, in the same three groups the list above shows, because
 * "discard" alone does not say that a plan deleted here comes back, or that a
 * plan GitHub has never seen cannot be restored from it and is only unlinked.
 */
function DiscardAllChanges({
  controller,
}: Pick<GitHubCommitDialogProps, 'controller'>) {
  const { changes } = controller
  // The debounced hash can leave every group empty for a frame; an empty list
  // would only be a gap between the warning and the buttons.
  const listed =
    changes.updated.length + changes.deleted.length + changes.added.length > 0

  return (
    <DiscardConfirm
      title="Restore every plan from GitHub?"
      description="Everything waiting to commit is thrown away and this browser goes back to the repository’s copy. Nothing changes on GitHub, and this cannot be undone."
      confirm="Discard all"
      onConfirm={() => void controller.discardLocalChanges()}
      trigger={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={controller.busy || controller.displayState === 'offline'}
        >
          <IconArrowBackUp />
          Discard all changes
        </Button>
      }
    >
      {listed ? (
        <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs/relaxed">
          <ReviewList
            label="Replaced by GitHub's copy"
            projectIds={changes.updated}
            controller={controller}
          />
          <ReviewList
            label="Brought back from GitHub"
            projectIds={changes.deleted}
            controller={controller}
          />
          <ReviewList
            label="Not on GitHub — kept here, no longer synced"
            projectIds={changes.added}
            controller={controller}
          />
        </ul>
      ) : null}
    </DiscardConfirm>
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
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto text-xs sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            {controller.displayState === 'conflict' ? null : (
              <ToneDot tone={status.tone} />
            )}
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
                {controller.changes.hasChanges &&
                !controller.changes.blockedByConflicts ? (
                  <DiscardAllChanges controller={controller} />
                ) : null}
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

            <DialogFooter
              className={
                controller.review === null
                  ? 'justify-between sm:justify-between'
                  : undefined
              }
            >
              {controller.review === null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onManageRepository}
                >
                  <IconSettings />
                  Repository settings
                </Button>
              ) : null}
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
