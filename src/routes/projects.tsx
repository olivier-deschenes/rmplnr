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
import { PageLayout } from '#/components/page-layout.tsx'
import { PageLoading } from '#/components/page-loading.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { planFloors } from '#/lib/planner/enclosures.ts'
import { downloadLibraryBackup } from '#/lib/planner/projectExport.ts'
import { plannerStore, restoreLibrary } from '#/lib/planner/store.ts'
import { createStarterPlan } from '#/lib/planner/starterPlan.ts'
import { formatArea } from '#/lib/planner/units.ts'
import { seo } from '#/lib/seo.ts'

import type { Project, Units } from '#/lib/planner/types.ts'

export const Route = createFileRoute('/projects')({
  component: Projects,
  // A shelf of plans that live in one browser. There is nothing here for a
  // crawler to find, so it is kept out of the index while its links still count.
  head: () =>
    seo({
      title: 'Your plans · rmplnr',
      description:
        'Every room plan saved in this browser, ready to open, export, or share.',
      noindex: true,
    }),
})

function summary(project: Project, units: Units): string {
  const { walls, furniture } = project
  if (walls.length === 0)
    return furniture.length === 0
      ? 'Empty plan'
      : `${furniture.length} furniture item${furniture.length === 1 ? '' : 's'}`
  // Counted off what the walls close in rather than off which runs were drawn
  // shut, so a room walled in against a neighbour's wall counts as the room it
  // is — and the walls left over, that close nothing, count as walls.
  const floors = planFloors(walls, project.spaces)
  const loose = walls.reduce((sum, run) => sum + run.points.length - 1, 0)
  if (!floors.count)
    return `${loose} wall${loose === 1 ? '' : 's'} · In progress`
  return `${floors.count} run${floors.count === 1 ? '' : 's'} · ${formatArea(floors.floor, units, 1)}`
}

function Projects() {
  useLayoutEffect(() => {
    restoreLibrary()
  }, [])
  const projects = useSelector(plannerStore, (state) => state.projects)
  const restored = useSelector(plannerStore, (state) => state.restored)
  const units = useSelector(plannerStore, (state) => state.units)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  if (!restored) return <PageLoading label="Loading plans…" />

  const open = (id: string) =>
    navigate({ to: '/p/$projectId', params: { projectId: id } })
  const start = () => open(plannerStore.actions.newProject())
  const tryExample = () =>
    open(plannerStore.actions.importProject(createStarterPlan(), 'copy'))
  const needle = query.trim().toLocaleLowerCase()
  const shown = projects
    .filter((project) =>
      [
        project.name,
        ...project.walls
          .filter((run) => run.kind === 'closet')
          .map((run) => run.name),
        // A room that was walled in rather than drawn is a room to search by
        // too; its name is the only place it is written down.
        ...project.spaces.map((space) => space.name),
      ].some((name) => name.toLocaleLowerCase().includes(needle)),
    )
    .reverse()

  return (
    <PageLayout>
      <div className="py-10 sm:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6 sm:mb-10">
          <div className="space-y-2">
            <h1 className="text-4xl font-medium tracking-tight">Your plans</h1>
            <p className="text-muted-foreground text-base">
              Pick up where you left off, or start with a new space.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ImportDialog
              trigger={
                <Button variant="outline" className="h-11 px-4 text-sm">
                  <IconUpload aria-hidden="true" data-icon="inline-start" />
                  Import JSON
                </Button>
              }
              onProjectImported={open}
            />
            <Button onClick={start} className="h-11 px-4 text-sm">
              <IconPlus aria-hidden="true" data-icon="inline-start" />
              New plan
            </Button>
          </div>
        </div>
        <section aria-label="Saved plans" className="space-y-6">
          {projects.length > 0 && (
            <div className="flex items-center justify-between gap-4 border-b pb-5">
              <p
                role="status"
                className="text-muted-foreground shrink-0 text-sm tabular-nums"
              >
                {needle
                  ? `${shown.length} of ${projects.length}`
                  : projects.length}{' '}
                plan{projects.length === 1 ? '' : 's'}
              </p>
              <div className="relative w-full max-w-64">
                <IconSearch
                  aria-hidden="true"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                />
                <Input
                  type="search"
                  autoComplete="off"
                  aria-label="Search plans"
                  placeholder="Search plans or rooms…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-11 pr-10 pl-9 text-sm [&::-webkit-search-cancel-button]:appearance-none"
                />
                {query && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Clear search"
                    className="absolute top-1.5 right-1"
                    onClick={() => setQuery('')}
                  >
                    <IconX aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          )}
          {shown.length > 0 ? (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((project) => (
                <li key={project.id}>
                  <Link
                    to="/p/$projectId"
                    params={{ projectId: project.id }}
                    className="group block h-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
                  >
                    <Card className="h-full gap-0 rounded-md py-0 shadow-none ring-border transition-colors group-hover:ring-foreground/40">
                      <CardContent className="h-52 rounded-t-md border-b bg-muted/40 px-1 sm:h-56">
                        <PlanPreview project={project} />
                      </CardContent>
                      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 p-5">
                        <CardTitle className="truncate text-base font-medium">
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
              <h2 className="text-base font-medium">
                {projects.length > 0 ? 'No plans found' : 'No plans yet'}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {projects.length > 0
                  ? 'Try a different plan or room name.'
                  : 'Create a new plan, import one, or try the example below.'}
              </p>
              {projects.length > 0 && (
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => setQuery('')}
                >
                  Clear search
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <Button
              variant="ghost"
              onClick={tryExample}
              className="text-muted-foreground h-11 px-2 text-sm"
            >
              Try an example
              <IconArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            {projects.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => downloadLibraryBackup(projects)}
                className="text-muted-foreground h-11 text-sm"
              >
                <IconDownload aria-hidden="true" data-icon="inline-start" />
                Back up all
              </Button>
            )}
          </div>
        </section>
      </div>
    </PageLayout>
  )
}
