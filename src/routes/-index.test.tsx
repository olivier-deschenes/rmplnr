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

/**
 * The plan list as an empty browser first meets it. The query client is the
 * page's own rather than the router's, because GitHub sync reads its
 * connection through TanStack Query and the list now offers it.
 */
async function renderEmptyLibrary(): Promise<string> {
  plannerStore.actions.closeProject()
  plannerStore.actions.loadLibrary({ version: 1, projects: [] })

  const queryClient = new QueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

it('offers JSON import before the browser has any plans', async () => {
  const html = await renderEmptyLibrary()
  expect(html).toContain('Import JSON')
  expect(html).not.toContain('Back up all')
})

it('offers GitHub sync before the browser has any plans', async () => {
  // An empty library is exactly the case the editor-only button could not
  // serve: with no plan to open there was no way through to the repository
  // already holding the plans.
  const html = await renderEmptyLibrary()
  expect(html).toContain('Sync with GitHub')
})
