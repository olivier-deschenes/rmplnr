import { expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { renderToStaticMarkup } from 'react-dom/server'

import { routeTree } from '#/routeTree.gen.ts'

it('shows a useful recovery page for an unknown URL', async () => {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ['/missing-page'] }),
  })

  await router.load()

  const html = renderToStaticMarkup(<RouterProvider router={router} />)

  expect(html).toContain('rmplnr')
  expect(html).toContain('Page not found')
  expect(html).toContain('Your saved plans are still in this browser.')
  expect(html).toContain('href="/projects"')
  expect(html).toContain('All plans')
})
