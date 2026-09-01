import { expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

import { routeTree } from '#/routeTree.gen.ts'

const PLAN = '11111111-1111-4111-8111-111111111111'

it('keeps every editor control reachable in responsive groups', async () => {
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
  expect(html).toContain('aria-label="Add image or PDF underlay"')
  expect(html).toContain('aria-label="Import or export"')
  expect(html).toContain('aria-label="Open inspector"')
  expect(html).toContain('aria-label="Inspector"')
  expect(html).toContain('aria-label="Keyboard shortcuts"')
  expect(html).toContain('hidden lg:flex')
})
