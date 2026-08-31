import { IconBrandGithub } from '@tabler/icons-react'

import { Button } from '#/components/ui/button.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip.tsx'
import { cn } from '#/lib/utils.ts'

import { describeGitHubSync, syncToneBackground } from './syncStatus.ts'

import type { GitHubSyncController } from './useGithubSync.ts'

interface GitHubSyncControlsProps {
  controller: GitHubSyncController
  onOpenRepository: () => void
  onOpenCommit: () => void
  className?: string
}

/**
 * GitHub sync's single toolbar control: the logo, a status square, and — only
 * when something actually needs the user — a word saying what.
 *
 * One button covers both jobs the feature has in the bar. Before a repository
 * is chosen the button is the way into setup; after that it is the way to
 * commit, and setup moves behind the commit dialog's own repository button.
 * Splitting them into two buttons cost more room than the rare trip back to
 * settings was worth.
 *
 * The tooltip provider is the editor's, the same one the rest of the bar
 * borrows.
 */
export function GitHubSyncControls({
  controller,
  onOpenRepository,
  onOpenCommit,
  className,
}: GitHubSyncControlsProps) {
  const connected = controller.connection?.status === 'connected'
  const revoked = controller.connection?.status === 'access-revoked'
  const status = describeGitHubSync(controller.displayState, controller.changes)
  const canCommit =
    connected && controller.repository !== null && controller.workspace !== null

  const connectionLabel = revoked
    ? 'GitHub access revoked — reconnect'
    : connected
      ? `GitHub sync on${
          controller.repository ? ` · ${controller.repository.fullName}` : ''
        }`
      : 'GitHub sync off'

  // A resting sync has nothing to say, so it stays a bare icon; the label only
  // appears when there is work waiting or something is wrong.
  const showLabel = canCommit && status.tone !== 'ok' && status.tone !== 'idle'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={
            canCommit ? `Commit to GitHub — ${status.title}` : connectionLabel
          }
          className={cn(
            'gap-1.5 px-2',
            status.tone === 'bad' && 'text-sync-bad',
            !connected && !revoked && 'text-muted-foreground',
            className,
          )}
          onClick={canCommit ? onOpenCommit : onOpenRepository}
        >
          <span className="relative flex items-center">
            <IconBrandGithub
              className={cn(!connected && !revoked && 'opacity-60')}
            />
            {status.tone === 'busy' ? (
              <Spinner className="absolute -right-1 -bottom-1 size-2" />
            ) : connected || revoked ? (
              <span
                aria-hidden
                className={cn(
                  'ring-background absolute -right-0.5 -bottom-0.5 size-1.5 ring-1',
                  syncToneBackground[status.tone],
                )}
              />
            ) : null}
          </span>
          {showLabel ? (
            <span className="hidden lg:inline">{status.label}</span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {canCommit ? `${status.title}. ${status.detail}` : connectionLabel}
      </TooltipContent>
    </Tooltip>
  )
}
