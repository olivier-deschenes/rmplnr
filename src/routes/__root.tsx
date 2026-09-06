import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { NotFoundPage } from '#/components/not-found.tsx'
import { Toaster } from '#/components/ui/sonner.tsx'
import { seo } from '#/lib/seo.ts'

import appCss from '../styles.css?url'
// The face nearly every word on the page is set in. Named here so the browser
// can start fetching it with the stylesheet rather than after parsing it.
import geistLatin from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

/**
 * The defaults every page starts from. A route that says nothing inherits the
 * landing page's title and description; anything a route does set wins, since
 * head tags are collected from the deepest match outwards.
 *
 * The canonical URL is deliberately not here: it has to name the page it is
 * on, so each route supplies its own, and pages kept out of the index have
 * none at all.
 */
const defaults = seo()

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      // The app is light-only, so the browser chrome is told the one colour.
      { name: 'theme-color', content: '#ffffff' },
      { name: 'color-scheme', content: 'light' },
      // Measurements like `240 x 180` are not phone numbers.
      { name: 'format-detection', content: 'telephone=no' },
      ...defaults.meta,
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'preload',
        href: geistLatin,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="bottom-center" />
        {/*
         * Devtools are a development instrument. Keeping them behind the build
         * flag is what lets the bundler drop them, so a visitor never pays for
         * them in bytes or in time to interactive.
         */}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
