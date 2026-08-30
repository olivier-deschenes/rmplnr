import { constantTimeEqual } from './crypto.ts'
import { GithubServerError } from './errors.ts'

export const SESSION_COOKIE_NAME = '__Host-rmplnr_session'
export const OAUTH_COOKIE_NAME = '__Host-rmplnr_github_oauth'

const COOKIE_PATH = '/'

export function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const candidate = part.slice(0, separator).trim()
    if (candidate !== name) continue

    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }

  return null
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

export function sessionCookie(token: string, maxAge: number): string {
  return serializeCookie(SESSION_COOKIE_NAME, token, { maxAge })
}

export function oauthCookie(state: string, maxAge: number): string {
  return serializeCookie(OAUTH_COOKIE_NAME, state, { maxAge })
}

export function expiredCookie(name: string): string {
  return serializeCookie(name, '', { maxAge: 0 })
}

function isSameOriginUrl(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}

export function isAllowedOrigin(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null) return fetchSite === 'same-origin'

  const origin = request.headers.get('origin')
  if (origin !== null) return constantTimeEqual(origin, requestOrigin)

  const referer = request.headers.get('referer')
  return referer !== null && isSameOriginUrl(referer, requestOrigin)
}

export function assertAllowedOrigin(request: Request): void {
  if (!isAllowedOrigin(request)) {
    throw new GithubServerError(
      'forbidden-origin',
      403,
      'This GitHub request did not come from rmplnr.',
    )
  }
}

export function safeReturnPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'

  try {
    const url = new URL(value, 'https://plan.local')
    if (url.origin !== 'https://plan.local') return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
