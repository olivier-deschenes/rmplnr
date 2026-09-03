import { Suspense, lazy, useState } from 'react'

import { GitHubSyncControls } from './GitHubSyncControls.tsx'
import { useGithubSync } from './useGithubSync.ts'

import type { GitHubSyncPlacement } from './GitHubSyncControls.tsx'

type GitHubDialog = 'repository' | 'commit'

// Setting sync up and reviewing a commit are both rare next to looking at the
// button, and between them they are the only reason this feature needs a form
// library, a select, and a checkbox. Fetching that when a dialog is first asked
// for keeps it off the plan list, which is the first thing every visit paints.
const GitHubRepositoryDialog = lazy(async () => ({
  default: (await import('./GitHubRepositoryDialog.tsx'))
    .GitHubRepositoryDialog,
}))
const GitHubCommitDialog = lazy(async () => ({
  default: (await import('./GitHubCommitDialog.tsx')).GitHubCommitDialog,
}))

/**
 * Committing plans to a GitHub repository, and everything it takes to set that
 * up.
 *
 * The whole feature is one button and two dialogs behind it, and they are kept
 * together here because the button is the only way into either one. Nothing
 * about the plans changes on GitHub's say-so without the reader seeing it
 * first: what arrives is shown as a review, and applied only when they
 * confirm it.
 *
 * Sync is a property of the library, not of whichever plan happens to be open,
 * so this sits in both places a reader might want it: the editor's toolbar and
 * the plan list. Either one can connect an account, pick a repository, commit,
 * and take in plans the repository has that this browser does not.
 *
 * The tooltip provider is the surrounding page's; both callers have one.
 */
export function GitHubSync({
  className,
  placement,
}: {
  className?: string
  placement?: GitHubSyncPlacement
}) {
  const [dialog, setDialog] = useState<GitHubDialog | null>(null)
  // A dialog asked for once stays mounted, so closing it still animates out
  // rather than vanishing, and reopening costs nothing.
  const [loaded, setLoaded] = useState<Array<GitHubDialog>>([])
  const controller = useGithubSync()

  const open = (next: GitHubDialog) => {
    setLoaded((current) =>
      current.includes(next) ? current : [...current, next],
    )
    setDialog(next)
  }

  return (
    <>
      <GitHubSyncControls
        controller={controller}
        className={className}
        placement={placement}
        onOpenRepository={() => open('repository')}
        onOpenCommit={() => open('commit')}
      />
      <Suspense fallback={null}>
        {loaded.includes('repository') ? (
          <GitHubRepositoryDialog
            open={dialog === 'repository'}
            onOpenChange={(next) => setDialog(next ? 'repository' : null)}
            controller={controller}
          />
        ) : null}
        {loaded.includes('commit') ? (
          <GitHubCommitDialog
            open={dialog === 'commit'}
            onOpenChange={(next) => setDialog(next ? 'commit' : null)}
            controller={controller}
            onManageRepository={() => open('repository')}
          />
        ) : null}
      </Suspense>
    </>
  )
}
