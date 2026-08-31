import { expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

import { plannerStore } from '#/lib/planner/store.ts'
import { routeTree } from '#/routeTree.gen.ts'

it('offers JSON import before the browser has any plans', async () => {
  plannerStore.actions.closeProject()
  plannerStore.actions.loadLibrary({ version: 1, projects: [] })
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()

  const html = renderToStaticMarkup(<RouterProvider router={router} />)
  expect(html).toContain('Import JSON')
  expect(html).not.toContain('Back up all')
})
