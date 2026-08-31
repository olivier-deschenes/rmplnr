import { useEffect } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { IconDownload, IconPlus, IconUpload } from '@tabler/icons-react'

import { ImportDialog } from '#/components/planner/import-dialog.tsx'
import { TabConflictDialog } from '#/components/tab-conflict.tsx'
import { Button } from '#/components/ui/button.tsx'

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
 * Nothing is edited here, so there is nothing here but names — what a plan is
 * called, and how much of it there is. Everything that changes a plan, its own
 * name included, is a room away in the editor.
 */
function Home() {
  // localStorage is client-only: the server renders this list empty, and the
  // browser fills it in on the far side of the first paint.
  useEffect(() => {
    restoreLibrary()
  }, [])

  const projects = useSelector(plannerStore, (s) => s.projects)
  const restored = useSelector(plannerStore, (s) => s.restored)
  const units = useSelector(plannerStore, (s) => s.units)
  const navigate = useNavigate()

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
          // Empty until the library has been read, which is not the same as
          // there being nothing in it; only one of the two is worth saying.
          restored && (
            <p className="text-muted-foreground text-[11px]">
              Nothing yet — start one below
            </p>
          )
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
