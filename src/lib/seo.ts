/**
 * Everything a crawler is told about a page, in one place.
 *
 * The editor is local-first, so most of the site is a private workspace that
 * has nothing to offer a search result: only the landing page is worth
 * indexing. `seo()` builds the tags for both cases, and `noindex` is the
 * switch between them.
 */

/** The canonical origin. Every absolute URL a crawler is handed starts here. */
export const SITE_URL = 'https://rmplnr.com'

export const SITE_NAME = 'rmplnr'

/** The brand line, kept for the places that want the voice over the keywords. */
export const SITE_TAGLINE = 'A little room to think'

export const DEFAULT_TITLE = 'rmplnr · Free 2D room planner and floor plan tool'

export const DEFAULT_DESCRIPTION =
  'Draw your rooms to scale, place furniture, and see what fits before you move it. A free 2D room planner that runs in your browser — no account, nothing uploaded.'

/** The social card. Sized 1200×630, the ratio every crawler crops toward. */
export const OG_IMAGE = {
  url: `${SITE_URL}/og.png`,
  width: 1200,
  height: 630,
  alt: 'A room plan drawn to scale in rmplnr, with dimensions and furniture in place.',
}

/** An absolute URL, which is the only kind `og:` and `canonical` may carry. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).href
}

export type SeoOptions = {
  /** The full `<title>`. Falls back to the landing page's. */
  title?: string
  description?: string
  /**
   * The page's own path, which becomes its canonical URL. Left off for pages
   * that are kept out of the index, where there is no canonical to point at.
   */
  path?: string
  /**
   * Keep the page out of search results. Links are still followed, so a
   * private page can pass its equity back to the landing page.
   */
  noindex?: boolean
}

type MetaTags = Array<React.JSX.IntrinsicElements['meta']>
type LinkTags = Array<React.JSX.IntrinsicElements['link']>

/**
 * The meta and link tags for one page, ready to spread into a route's `head()`.
 *
 * Open Graph and Twitter tags are written for every page rather than only the
 * indexed one: a shared link to the editor should still unfurl as rmplnr.
 */
export function seo(options: SeoOptions = {}): {
  meta: MetaTags
  links: LinkTags
} {
  const title = options.title ?? DEFAULT_TITLE
  const description = options.description ?? DEFAULT_DESCRIPTION
  const canonical = options.path ? absoluteUrl(options.path) : null

  const meta: MetaTags = [
    { title },
    { name: 'description', content: description },

    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: 'en_US' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: OG_IMAGE.url },
    { property: 'og:image:width', content: String(OG_IMAGE.width) },
    { property: 'og:image:height', content: String(OG_IMAGE.height) },
    { property: 'og:image:alt', content: OG_IMAGE.alt },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: OG_IMAGE.url },
    { name: 'twitter:image:alt', content: OG_IMAGE.alt },
  ]

  if (canonical) meta.push({ property: 'og:url', content: canonical })

  // `noindex, follow` keeps the private pages out of results while letting
  // the links on them still count. The indexed page asks for the extras
  // Google only offers when a page opts in to full previews.
  meta.push({
    name: 'robots',
    content: options.noindex
      ? 'noindex, follow'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
  })

  const links: LinkTags = canonical
    ? [{ rel: 'canonical', href: canonical }]
    : []

  return { meta, links }
}

/**
 * A JSON-LD block for a route's `head()`.
 *
 * The router looks for this key among the meta entries and renders it as a
 * `<script type="application/ld+json">`, serialising and escaping the object
 * on the way out. Its meta type has not caught up with the key yet, so the
 * widening is done here once instead of at every call site.
 */
export function jsonLd(
  data: Record<string, unknown>,
): React.JSX.IntrinsicElements['meta'] {
  return {
    'script:ld+json': data,
  } as unknown as React.JSX.IntrinsicElements['meta']
}
