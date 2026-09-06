/**
 * The site answers to one name.
 *
 * Both `rmplnr.com` and `www.rmplnr.com` are pointed at the Worker, so without
 * this every page would exist twice under two hostnames — two URLs a search
 * engine has to choose between, splitting whatever either one earned. The
 * canonical tag says which name is meant; this makes it so.
 */
export const CANONICAL_HOST = 'rmplnr.com'

const REDIRECTED_HOSTS = new Set([`www.${CANONICAL_HOST}`])

/**
 * The permanent redirect to the canonical host, or null to serve the request
 * where it landed.
 *
 * Only page requests are moved. A redirect is answered by re-requesting with
 * `GET`, which would quietly drop the body of a GitHub webhook or an OAuth
 * exchange that happened to be addressed to the `www` name, so anything under
 * `/api/` is served rather than sent somewhere else. Crawlers only ever ask
 * for pages, so the redirect still does its whole job.
 */
export function canonicalHostRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const url = new URL(request.url)
  if (!REDIRECTED_HOSTS.has(url.hostname)) return null
  if (url.pathname.startsWith('/api/')) return null

  url.hostname = CANONICAL_HOST
  return Response.redirect(url.href, 301)
}
