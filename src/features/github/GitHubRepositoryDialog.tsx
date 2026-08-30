import {
  IconAlertTriangle,
  IconBrandGithub,
  IconExternalLink,
  IconRefresh,
  IconUnlink,
} from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Checkbox } from '#/components/ui/checkbox.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'

import { NEW_REPOSITORY_URL, TextLink } from './dialogShared.tsx'

import type { GitHubSyncController } from './useGithubSync.ts'

interface GitHubRepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  controller: GitHubSyncController
}

function RepositoryPicker({
  controller,
}: Pick<GitHubRepositoryDialogProps, 'controller'>) {
  const installUrl = controller.connection?.installUrl

  if (controller.repositoriesLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2">
        <Spinner />
        Loading repositories…
      </div>
    )
  }

  if (controller.repositories.length === 0) {
    return (
      <div className="space-y-2 border p-3">
        <p className="font-medium">Choose repositories rmplnr may access</p>
        <p className="text-muted-foreground">
          A brand-new empty repository works — rmplnr sets it up on the first
          commit.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {installUrl ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={installUrl} target="_blank" rel="noreferrer">
                <IconBrandGithub />
                Choose on GitHub
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={controller.busy}
            onClick={() => void controller.refreshRepositories()}
          >
            <IconRefresh />
            Check again
          </Button>
          <span className="text-muted-foreground">
            <TextLink href={NEW_REPOSITORY_URL}>New repository</TextLink>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={controller.repository?.id ?? ''}
          disabled={controller.busy}
          onValueChange={(repositoryId) =>
            void controller.selectRepository(repositoryId)
          }
        >
          <SelectTrigger
            id="github-repository"
            aria-label="Repository"
            className="w-full"
          >
            <SelectValue placeholder="Choose a repository" />
          </SelectTrigger>
          <SelectContent>
            {controller.repositories.map((repository) => (
              <SelectItem key={repository.id} value={repository.id}>
                {repository.fullName}
                {repository.isPrivate ? ' · Private' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh repositories"
          title="Refresh repositories"
          disabled={controller.busy}
          onClick={() => void controller.refreshRepositories()}
        >
          <IconRefresh />
        </Button>
        {controller.repository ? (
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open repository on GitHub"
            title="Open repository on GitHub"
          >
            <a
              href={controller.repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternalLink />
            </a>
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        Missing one?{' '}
        <TextLink href={NEW_REPOSITORY_URL}>Create a repository</TextLink>
        {installUrl ? (
          <>
            {' · '}
            <TextLink href={installUrl}>Grant rmplnr access</TextLink>
          </>
        ) : null}
      </p>
    </div>
  )
}

function PlanSelection({
  controller,
}: Pick<GitHubRepositoryDialogProps, 'controller'>) {
  const { projects } = controller
  const selectedCount = projects.filter((project) =>
    controller.isProjectSelected(project.id),
  ).length

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-medium">Plans in this repository</h3>
        <p className="text-muted-foreground">
          {selectedCount} of {projects.length} selected
        </p>
      </div>
      {projects.length > 0 ? (
        <div className="max-h-56 divide-y overflow-y-auto border">
          {projects.map((project) => {
            const checked = controller.isProjectSelected(project.id)
            const baseline = controller.workspace?.baseProjects[project.id]
            return (
              <label
                key={project.id}
                className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2"
              >
                <Checkbox
                  checked={checked}
                  disabled={controller.busy}
                  onCheckedChange={(value) =>
                    controller.setProjectSelected(project.id, value === true)
                  }
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {project.name}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {checked
                    ? baseline
                      ? 'Synced'
                      : 'Will be added'
                    : baseline
                      ? 'Will be removed'
                      : 'Local only'}
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground border p-3">
          Draw a plan, then select it here.
        </p>
      )}
      <p className="text-muted-foreground">
        Changes here are staged — they reach GitHub on the next commit.
        Unselecting keeps the browser copy and removes the GitHub file.
      </p>
    </section>
  )
}

/**
 * Everything about *where* plans sync: the account, the repository, and which
 * plans it holds. Committing lives in `GitHubCommitDialog`.
 */
export function GitHubRepositoryDialog({
  open,
  onOpenChange,
  controller,
}: GitHubRepositoryDialogProps) {
  const connectedConnection =
    controller.connection?.status === 'connected' ? controller.connection : null
  const revoked = controller.connection?.status === 'access-revoked'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto text-xs sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <IconBrandGithub className="size-4" />
            <DialogTitle>GitHub sync</DialogTitle>
          </div>
          <DialogDescription>
            Choose the account and repository your plans sync with.
          </DialogDescription>
        </DialogHeader>

        {controller.connectionLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-8">
            <Spinner />
            Checking GitHub connection…
          </div>
        ) : revoked ? (
          <Alert variant="destructive">
            <IconUnlink />
            <AlertTitle>GitHub access was revoked</AlertTitle>
            <AlertDescription>
              <p>Your browser plans are unchanged. Reconnect to resume sync.</p>
              <Button
                type="button"
                size="sm"
                disabled={controller.busy}
                onClick={() => void controller.beginConnection()}
              >
                <IconBrandGithub />
                Reconnect GitHub
              </Button>
            </AlertDescription>
          </Alert>
        ) : !connectedConnection ? (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Credentials stay encrypted on the server. Plan content is read
              from and written to only the repository you select.
            </p>
            {controller.connectionError ? (
              <Alert variant="destructive">
                <IconAlertTriangle />
                <AlertTitle>GitHub is not available</AlertTitle>
                <AlertDescription>
                  {controller.connectionError.message}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="button"
              disabled={controller.busy}
              onClick={() => void controller.beginConnection()}
            >
              {controller.busy ? <Spinner /> : <IconBrandGithub />}
              Connect GitHub
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 border p-3">
              <img
                src={connectedConnection.user.avatarUrl}
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 border"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {connectedConnection.user.login}
                </p>
                <p className="text-muted-foreground truncate">
                  Connected · remote changes are always reviewed first
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={controller.busy}
                onClick={() => void controller.disconnect()}
              >
                <IconUnlink />
                Disconnect
              </Button>
            </div>

            <RepositoryPicker controller={controller} />

            {controller.repository && controller.workspace ? (
              <PlanSelection controller={controller} />
            ) : null}

            {controller.actionError ? (
              <Alert variant="destructive">
                <IconAlertTriangle />
                <AlertTitle>GitHub sync needs attention</AlertTitle>
                <AlertDescription>
                  {controller.actionError.message}
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
