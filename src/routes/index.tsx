import { useLayoutEffect } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { IconDownload, IconPlus, IconUpload } from '@tabler/icons-react'

import { ImportDialog } from '#/components/planner/import-dialog.tsx'
import { PageLoading } from '#/components/page-loading.tsx'
import { TabConflictDialog } from '#/components/tab-conflict.tsx'
import { Button } from '#/components/ui/button.tsx'
import { TooltipProvider } from '#/components/ui/tooltip.tsx'

import { GitHubSync } from '#/features/github/GitHubSync.tsx'

import { polygonArea } from '#/lib/planner/geometry.ts'
import { downloadLibraryBackup } from '#/lib/planner/projectExport.ts'
import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'
import { formatArea } from '#/lib/planner/units.ts'

import type { Project, Units } from '#/lib/planner/types.ts'

export const Route = createFileRoute('/')({ component: Home })

/**
 * How much of a plan there is, for the reader picking one out of a list by
 * eye. A plan nobody has drawn on yet says so in a word rather than in a row
 * of zeroes.
 */
function summary(project: Project, units: Units): string {
  const { rooms, furniture } = project
  if (rooms.length === 0 && furniture.length === 0) return 'Empty'
  const area = rooms.reduce((sum, r) => sum + polygonArea(r.points), 0)
  const count = `${rooms.length} room${rooms.length === 1 ? '' : 's'}`
  return `${count} · ${formatArea(area, units, 1)}`
}

/**
 * The way in: every plan saved, and the way to start another.
 *
 * No plan is drawn on here, so there is nothing in the list but names — what a
 * plan is called, and how much of it there is. Everything that changes what a
 * plan contains, its own name included, is a room away in the editor.
 *
 * What does belong here is everything that acts on the library as a whole:
 * starting a plan, importing one, backing them all up, and GitHub sync. Sync
 * used to live only in the editor's toolbar, which meant a browser with no
 * plans in it had to invent one before it could pull down the plans it already
 * had in a repository. It is a library-wide thing, so it is offered where the
 * library is.
 */
function Home() {
  // localStorage is client-only. Restore it before the browser paints so the
  // page never flashes an empty list on its way to the saved one.
  useLayoutEffect(() => {
    restoreLibrary()
  }, [])

  const projects = useSelector(plannerStore, (s) => s.projects)
  const restored = useSelector(plannerStore, (s) => s.restored)
  const units = useSelector(plannerStore, (s) => s.units)
  const navigate = useNavigate()

  if (!restored) return <PageLoading label="Loading plans…" />

  const start = () =>
    navigate({
      to: '/p/$projectId',
      params: { projectId: plannerStore.actions.newProject() },
    })

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="grid gap-1">
        <h1 className="text-sm">rmplnr</h1>
        <p className="text-muted-foreground text-[11px]">
          Draw a room, and what goes in it.
        </p>
      </header>

      <section className="grid gap-2">
        <h2 className="text-muted-foreground text-[10px] tracking-wider uppercase">
          Plans
        </h2>
        {projects.length > 0 ? (
          <ul className="grid border-t">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to="/p/$projectId"
                  params={{ projectId: project.id }}
                  className="hover:bg-muted flex items-baseline justify-between gap-4 border-b px-2 py-2.5 text-xs"
                >
                  <span className="truncate">{project.name}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                    {summary(project, units)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[11px]">
            Nothing yet — start one below
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={start}>
          <IconPlus data-icon="inline-start" />
          New plan
        </Button>
        <ImportDialog
          trigger={
            <Button variant="outline" size="sm">
              <IconUpload data-icon="inline-start" />
              Import JSON
            </Button>
          }
          onProjectImported={(id) =>
            navigate({ to: '/p/$projectId', params: { projectId: id } })
          }
        />
        {/* Long enough a delay that sweeping across the row does not set the
            tooltip off on the way past, matching the editor's. */}
        <TooltipProvider delayDuration={400}>
          <GitHubSync placement="page" />
        </TooltipProvider>
        {projects.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadLibraryBackup(projects)}
          >
            <IconDownload data-icon="inline-start" />
            Back up all
          </Button>
        )}
      </div>

      <TabConflictDialog />
    </main>
  )
}
