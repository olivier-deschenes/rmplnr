import { Link } from '@tanstack/react-router'

import { TabConflictDialog } from '#/components/tab-conflict.tsx'
import { Button } from '#/components/ui/button.tsx'
import { TooltipProvider } from '#/components/ui/tooltip.tsx'
import { GitHubSync } from '#/features/github/GitHubSync.tsx'

import type { ReactNode } from 'react'

export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="bg-background fixed top-3 left-3 z-50 -translate-y-24 rounded-md border px-4 py-3 text-sm focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Skip to content
        </a>
        <header className="border-b">
          <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-10">
            <div className="flex items-center gap-6">
              <Link
                to="/"
                aria-label="rmplnr home"
                className="rounded-sm font-mono text-2xl font-medium tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                rmplnr<span className="text-muted-foreground">.</span>
              </Link>
              <span className="text-muted-foreground hidden text-sm sm:block">
                A little room to think.
              </span>
            </div>
            <nav
              aria-label="Main navigation"
              className="flex items-center gap-2"
            >
              <Button asChild variant="ghost" className="h-10 px-3 text-sm">
                <Link
                  to="/projects"
                  activeProps={{
                    'aria-current': 'page',
                    className: 'bg-muted',
                  }}
                >
                  Projects
                </Link>
              </Button>
              <GitHubSync
                placement="page"
                className="h-10 px-3 max-sm:[&>span:last-child]:sr-only"
              />
            </nav>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-5 outline-none sm:px-10"
        >
          {children}
        </main>
        <footer className="mx-auto w-full max-w-6xl px-5 text-xs text-muted-foreground sm:px-10">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t py-6">
            <p>Saved in this browser. Yours to export anytime.</p>
            <p>Your space, at your pace.</p>
          </div>
        </footer>
        <TabConflictDialog />
      </div>
    </TooltipProvider>
  )
}
