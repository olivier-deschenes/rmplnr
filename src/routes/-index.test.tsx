import { expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

import { plannerStore } from '#/lib/planner/store.ts'
import { createStarterPlan } from '#/lib/planner/starterPlan.ts'
import { routeTree } from '#/routeTree.gen.ts'

import type { Project } from '#/lib/planner/types.ts'

/**
 * The home page with a restored library. The query client is the
 * page's own rather than the router's, because GitHub sync reads its
 * connection through TanStack Query and the list now offers it.
 */
async function renderHome(
  projects: Array<Project> = [],
  url = '/',
): Promise<string> {
  plannerStore.actions.closeProject()
  plannerStore.actions.loadLibrary({ version: 1, projects })

  const queryClient = new QueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  })

  await router.load()

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

it('offers JSON import before the browser has any plans', async () => {
  const html = await renderHome()
  expect(html).toContain('Import JSON')
  expect(html).not.toContain('Back up all')
})

it('offers GitHub sync before the browser has any plans', async () => {
  // An empty library is exactly the case the editor-only button could not
  // serve: with no plan to open there was no way through to the repository
  // already holding the plans.
  const html = await renderHome()
  expect(html).toContain('Sync with GitHub')
})

it('keeps the landing page at the root even with saved plans', async () => {
  const project = createStarterPlan()
  const html = await renderHome([project])
  expect(html).toContain('Start a plan')
  expect(html).toContain('href="/projects"')
  expect(html).not.toContain(`/p/${project.id}`)
  expect(plannerStore.state.projects).toEqual([project])
})

it('shows saved plans at /projects without changing the library', async () => {
  const project = createStarterPlan()
  const html = await renderHome([project], '/projects')
  expect(html).toContain(`/p/${project.id}`)
  expect(html).toContain('Back up all')
  expect(html).not.toContain('Start a plan')
  expect(plannerStore.state.projects).toEqual([project])
})

it('keeps an empty project library at /projects with ways to start', async () => {
  const html = await renderHome([], '/projects')
  expect(html).toContain('No plans yet')
  expect(html).toContain('New plan')
  expect(html).toContain('Import JSON')
  expect(html).toContain('Sync with GitHub')
  expect(html).not.toContain('Back up all')
  expect(html).not.toContain('Clear search')
})
