import { describe, expect, it } from 'bun:test'

import { canonicalHostRedirect } from './canonicalHost.ts'

const get = (url: string, method = 'GET') => new Request(url, { method })

describe('canonical host', () => {
  it('sends a page on the www name to the canonical one, permanently', () => {
    const response = canonicalHostRedirect(get('https://www.rmplnr.com/'))

    expect(response?.status).toBe(301)
    expect(response?.headers.get('location')).toBe('https://rmplnr.com/')
  })

  it('keeps the path, query, and everything else about the request', () => {
    const response = canonicalHostRedirect(
      get('https://www.rmplnr.com/p/abc?view=plan'),
    )

    expect(response?.headers.get('location')).toBe(
      'https://rmplnr.com/p/abc?view=plan',
    )
  })

  it('leaves a request already on the canonical host alone', () => {
    expect(canonicalHostRedirect(get('https://rmplnr.com/'))).toBeNull()
  })

  it('leaves other hosts alone, so local development still works', () => {
    expect(canonicalHostRedirect(get('http://localhost:3000/'))).toBeNull()
  })

  // A 301 is re-requested as a GET, which would arrive without its body.
  it('never redirects a webhook or an OAuth exchange', () => {
    expect(
      canonicalHostRedirect(
        get('https://www.rmplnr.com/api/github/webhook', 'POST'),
      ),
    ).toBeNull()
    expect(
      canonicalHostRedirect(
        get('https://www.rmplnr.com/api/github/oauth/callback'),
      ),
    ).toBeNull()
  })

  it('does not redirect a POST to a page either', () => {
    expect(
      canonicalHostRedirect(get('https://www.rmplnr.com/', 'POST')),
    ).toBeNull()
  })
})
