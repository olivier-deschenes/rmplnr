import { expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

import { plannerStore } from '#/lib/planner/store.ts'
import { routeTree } from '#/routeTree.gen.ts'

import type { Project } from '#/lib/planner/types.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

const project: Project = {
  id: PLAN,
  name: 'Plan 1',
  rooms: [],
  furniture: [],
  openings: [],
}

it('holds back the empty editor until the saved plan is ready', async () => {
  plannerStore.setState((state) => ({
    ...state,
    restored: false,
    projectId: null,
  }))

  const queryClient = new QueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/p/${PLAN}`] }),
  })

  await router.load()

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  expect(html).toContain('Opening plan…')
  expect(html).not.toContain('data-toolbar-section="plan"')
})

it('keeps every editor control reachable in responsive groups', async () => {
  plannerStore.actions.loadLibrary({ version: 1, projects: [project] })
  plannerStore.actions.openProject(PLAN)

  const queryClient = new QueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/p/${PLAN}`] }),
  })

  await router.load()

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  expect(html).toContain('data-toolbar-section="plan"')
  expect(html).toContain('data-toolbar-section="tools"')
  expect(html).toContain('data-toolbar-section="actions"')
  expect(html).toContain('aria-label="Share this plan"')
  expect(html).toContain('aria-label="Back to all plans"')
  expect(html).toContain('href="/projects"')
  expect(html).toContain('aria-label="Share, import, or export"')
  expect(html).toContain('aria-label="Open inspector"')
  expect(html).toContain('aria-label="Inspector"')
  expect(html).toContain('aria-label="Keyboard shortcuts"')
  expect(html).toContain('hidden lg:flex')
})
