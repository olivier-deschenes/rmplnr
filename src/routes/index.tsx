import { useLayoutEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import {
  IconArrowUpRight,
  IconDownload,
  IconPlus,
  IconSearch,
  IconUpload,
  IconX,
} from '@tabler/icons-react'

import { ImportDialog } from '#/components/planner/import-dialog.tsx'
import { PlanPreview } from '#/components/planner/plan-preview.tsx'
import { PageLoading } from '#/components/page-loading.tsx'
import { TabConflictDialog } from '#/components/tab-conflict.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { TooltipProvider } from '#/components/ui/tooltip.tsx'
import { GitHubSync } from '#/features/github/GitHubSync.tsx'
import { polygonArea } from '#/lib/planner/geometry.ts'
import { downloadLibraryBackup } from '#/lib/planner/projectExport.ts'
import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'
import { createStarterPlan } from '#/lib/planner/starterPlan.ts'
import { formatArea } from '#/lib/planner/units.ts'

import type { Project, Units } from '#/lib/planner/types.ts'

export const Route = createFileRoute('/')({ component: Home })

function summary(project: Project, units: Units): string {
  const { rooms, furniture } = project
  if (rooms.length === 0)
    return furniture.length === 0
      ? 'Empty plan'
      : `${furniture.length} furniture item${furniture.length === 1 ? '' : 's'}`
  const area = rooms.reduce((sum, room) => sum + polygonArea(room.points), 0)
  return `${rooms.length} room${rooms.length === 1 ? '' : 's'} · ${formatArea(area, units, 1)}`
}

function Home() {
  useLayoutEffect(() => {
    restoreLibrary()
  }, [])
  const projects = useSelector(plannerStore, (state) => state.projects)
  const restored = useSelector(plannerStore, (state) => state.restored)
  const units = useSelector(plannerStore, (state) => state.units)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [example] = useState(createStarterPlan)
  if (!restored) return <PageLoading label="Loading plans…" />

  const open = (id: string) =>
    navigate({ to: '/p/$projectId', params: { projectId: id } })
  const start = () => open(plannerStore.actions.newProject())
  const tryExample = () =>
    open(plannerStore.actions.importProject(createStarterPlan(), 'copy'))
  const needle = query.trim().toLocaleLowerCase()
  const shown = projects
    .filter((project) =>
      [project.name, ...project.rooms.map((room) => room.name)].some((name) =>
        name.toLocaleLowerCase().includes(needle),
      ),
    )
    .reverse()

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex min-h-dvh flex-col">
        <header className="border-b">
          <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-6 sm:px-10">
            <Link
              to="/"
              aria-label="rmplnr home"
              className="rounded-sm font-mono text-xl font-medium tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              rmplnr<span className="text-muted-foreground">.</span>
            </Link>
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground hidden text-xs sm:block">
                Your space, at your pace.
              </span>
              <GitHubSync placement="page" />
            </div>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-10 sm:py-16"
        >
          <div className="mb-9 flex flex-wrap items-end justify-between gap-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                Your plans
              </h1>
              <p className="text-muted-foreground text-sm">
                A place for every room you have in mind.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ImportDialog
                trigger={
                  <Button variant="outline" className="h-10 px-4">
                    <IconUpload data-icon="inline-start" />
                    Import JSON
                  </Button>
                }
                onProjectImported={open}
              />
              <Button onClick={start} className="h-10 px-4">
                <IconPlus data-icon="inline-start" />
                New plan
              </Button>
            </div>
          </div>
          {projects.length > 0 ? (
            <section aria-label="Saved plans" className="space-y-6">
              <div className="flex items-center justify-between gap-4 border-b pb-5">
                <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {needle
                    ? `${shown.length} of ${projects.length}`
                    : projects.length}{' '}
                  plan{projects.length === 1 ? '' : 's'}
                </p>
                <div className="relative w-full max-w-64">
                  <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    type="search"
                    aria-label="Search plans"
                    placeholder="Search plans or rooms…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-9 pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
                  />
                  {query && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Clear search"
                      className="absolute top-1 right-1"
                      onClick={() => setQuery('')}
                    >
                      <IconX />
                    </Button>
                  )}
                </div>
              </div>
              {shown.length > 0 ? (
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((project) => (
                    <li key={project.id}>
                      <Link
                        to="/p/$projectId"
                        params={{ projectId: project.id }}
                        className="group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
                      >
                        <Card className="h-full gap-0 rounded-lg py-0 shadow-none ring-border transition-colors group-hover:ring-foreground/30">
                          <CardContent className="h-48 border-b bg-muted/40 px-3 sm:h-52">
                            <PlanPreview project={project} />
                          </CardContent>
                          <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 p-5">
                            <CardTitle className="truncate text-sm">
                              {project.name}
                            </CardTitle>
                            <IconArrowUpRight
                              aria-hidden="true"
                              className="text-muted-foreground row-span-2 size-4 group-hover:text-foreground"
                            />
                            <CardDescription className="text-xs tabular-nums">
                              {summary(project, units)}
                            </CardDescription>
                          </CardHeader>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-20 text-center">
                  <h2 className="text-base font-medium">No plans found</h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Try a different plan or room name.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-5"
                    onClick={() => setQuery('')}
                  >
                    Clear search
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                <Button
                  variant="ghost"
                  onClick={tryExample}
                  className="text-muted-foreground px-0"
                >
                  Try an example
                  <IconArrowUpRight data-icon="inline-end" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => downloadLibraryBackup(projects)}
                  className="text-muted-foreground"
                >
                  <IconDownload data-icon="inline-start" />
                  Back up all
                </Button>
              </div>
            </section>
          ) : (
            <section
              className="grid items-center gap-8 rounded-lg border p-7 sm:grid-cols-2 sm:gap-12 sm:p-10"
              aria-labelledby="first-plan-title"
            >
              <div className="space-y-5">
                <div className="space-y-3">
                  <h2
                    id="first-plan-title"
                    className="text-2xl font-medium tracking-tight"
                  >
                    Good spaces start with a plan.
                  </h2>
                  <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
                    Draw your room, add furniture, and see what fits. Start from
                    scratch or make this apartment your own.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={tryExample}
                  className="h-10 px-4"
                >
                  Try an example
                  <IconArrowUpRight data-icon="inline-end" />
                </Button>
              </div>
              <div className="min-w-0">
                <div className="h-56">
                  <PlanPreview project={example} />
                </div>
                <p className="text-muted-foreground text-center text-xs">
                  Studio apartment · {summary(example, units)}
                </p>
              </div>
            </section>
          )}
        </main>
        <footer className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-6 py-7 text-xs text-muted-foreground sm:px-10">
          <p>Saved in this browser. Yours to export anytime.</p>
          <p>Room to think.</p>
        </footer>
        <TabConflictDialog />
      </div>
    </TooltipProvider>
  )
}
