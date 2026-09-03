import { setCookie } from '@tanstack/react-start/server'

import type { GithubConnectionStatus } from '#/features/github/contracts.ts'

import {
  createPkcePair,
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  randomToken,
  sha256Hex,
} from './crypto.ts'
import { GithubServerError } from './errors.ts'
import { GithubApiClient } from './githubHttp.ts'
import { getGithubRuntime } from './runtime.ts'
import type { GithubRuntimeBindings } from './runtime.ts'
import {
  OAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  assertAllowedOrigin,
  expiredCookie,
  oauthCookie,
  parseCookie,
  safeReturnPath,
  sessionCookie,
} from './security.ts'
import {
  clearConnectionRevocation,
  consumeOauthFlow,
  createSession,
  deleteExpiredAuthRows,
  deleteSession,
  getConnection,
  getGithubCredentials,
  getSessionWithUser,
  putOauthFlow,
  rotateSession,
  toSelectedRepository,
  toUserSummary,
  touchSession,
  upsertGithubUser,
} from './store.ts'
import type {
  GithubConnectionRow,
  GithubSessionRow,
  GithubUserRow,
} from './store.ts'
import {
  exchangeAuthorizationCode,
  getUserAccessToken,
  storeGithubTokenSet,
} from './tokens.ts'

const OAUTH_TTL_SECONDS = 10 * 60
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const SESSION_ROTATION_SECONDS = 24 * 60 * 60
const SESSION_TOUCH_SECONDS = 5 * 60

interface GithubUserApiResponse {
  id: number | string
  login: string
  avatar_url: string
  html_url: string
}

export interface AuthenticatedGithubRequest {
  user: GithubUserRow
  session: GithubSessionRow
  connection: GithubConnectionRow | null
}

function installationUrl(bindings: GithubRuntimeBindings): string {
  return `https://github.com/apps/${encodeURIComponent(bindings.GITHUB_APP_SLUG)}/installations/new`
}

function callbackUrl(
  bindings: GithubRuntimeBindings,
  request: Request,
): string {
  return (
    bindings.GITHUB_CALLBACK_URL ??
    new URL('/api/github/oauth/callback', request.url).toString()
  )
}

export async function beginGithubOauth(
  request: Request,
  returnPath: string | undefined,
): Promise<{ authorizeUrl: string; setCookie: string }> {
  assertAllowedOrigin(request)
  const bindings = await getGithubRuntime()
  const now = Math.floor(Date.now() / 1000)
  const state = randomToken()
  const stateHash = await sha256Hex(state)
  const pkce = await createPkcePair()
  const redirectUri = callbackUrl(bindings, request)
  const verifierCipher = await encryptSecret(
    pkce.verifier,
    bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
    `github-oauth:${stateHash}`,
  )

  await Promise.all([
    deleteExpiredAuthRows(bindings.AUTH_DB, now),
    putOauthFlow(bindings.AUTH_DB, {
      state_hash: stateHash,
      verifier_cipher: verifierCipher,
      redirect_uri: redirectUri,
      return_path: safeReturnPath(returnPath),
      created_at: now,
      expires_at: now + OAUTH_TTL_SECONDS,
    }),
  ])

  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', bindings.GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return {
    authorizeUrl: url.toString(),
    setCookie: oauthCookie(state, OAUTH_TTL_SECONDS),
  }
}

function callbackRedirect(
  request: Request,
  path: string,
  outcome: 'connected' | 'error',
): URL {
  const redirect = new URL(safeReturnPath(path), request.url)
  redirect.searchParams.set('github', outcome)
  return redirect
}

function callbackResponse(url: URL): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString(),
      'cache-control': 'no-store',
    },
  })
}

function callbackFailure(request: Request, path = '/'): Response {
  const response = callbackResponse(callbackRedirect(request, path, 'error'))
  response.headers.append('set-cookie', expiredCookie(OAUTH_COOKIE_NAME))
  return response
}

export async function handleGithubOauthCallback(
  request: Request,
): Promise<Response> {
  const bindings = await getGithubRuntime()
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = parseCookie(request, OAUTH_COOKIE_NAME)
  const stateMatchesCookie =
    state !== null &&
    cookieState !== null &&
    constantTimeEqual(state, cookieState)
  if (!code || !state || !cookieState || !stateMatchesCookie) {
    // GitHub sends the installation-only redirect without `code`, and an
    // abandoned tab arrives with an expired cookie. Both land here, so name
    // which half was missing rather than folding them into one error.
    console.error('github oauth callback rejected before token exchange', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasCookie: Boolean(cookieState),
      stateMatchesCookie,
      params: [...url.searchParams.keys()],
    })
    return callbackFailure(request)
  }

  const now = Math.floor(Date.now() / 1000)
  const stateHash = await sha256Hex(state)
  const flow = await consumeOauthFlow(bindings.AUTH_DB, stateHash)
  if (!flow || flow.expires_at <= now) {
    console.error('github oauth flow missing or expired', {
      found: Boolean(flow),
      expired: flow ? flow.expires_at <= now : null,
    })
    return callbackFailure(request)
  }

  try {
    const verifier = await decryptSecret(
      flow.verifier_cipher,
      bindings.GITHUB_TOKEN_ENCRYPTION_KEY,
      `github-oauth:${stateHash}`,
    )
    const token = await exchangeAuthorizationCode(bindings, {
      code,
      verifier,
      redirectUri: flow.redirect_uri,
    })
    const client = new GithubApiClient(async () => token.access_token)
    const githubUser = await client.request<GithubUserApiResponse>('/user')
    const user = await upsertGithubUser(
      bindings.AUTH_DB,
      {
        id: String(githubUser.id),
        login: githubUser.login,
        avatarUrl: githubUser.avatar_url,
        profileUrl: githubUser.html_url,
      },
      now,
    )
    await storeGithubTokenSet(bindings, user.id, token, now)
    // The credentials that were revoked are replaced; the mark they left on the
    // connection is not, and it outranks them in `getGithubStatus`.
    await clearConnectionRevocation(bindings.AUTH_DB, user.id, now)

    const oldSessionToken = parseCookie(request, SESSION_COOKIE_NAME)
    if (oldSessionToken) {
      await deleteSession(bindings.AUTH_DB, await sha256Hex(oldSessionToken))
    }

    const sessionToken = randomToken()
    await createSession(bindings.AUTH_DB, {
      token_hash: await sha256Hex(sessionToken),
      user_id: user.id,
      created_at: now,
      rotated_at: now,
      last_seen_at: now,
      expires_at: now + SESSION_TTL_SECONDS,
    })

    const response = callbackResponse(
      callbackRedirect(request, flow.return_path, 'connected'),
    )
    response.headers.append(
      'set-cookie',
      sessionCookie(sessionToken, SESSION_TTL_SECONDS),
    )
    response.headers.append('set-cookie', expiredCookie(OAUTH_COOKIE_NAME))
    return response
  } catch (error) {
    console.error('github oauth callback failed after token exchange started', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : error,
    })
    return callbackFailure(request, flow.return_path)
  }
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedGithubRequest> {
  const token = parseCookie(request, SESSION_COOKIE_NAME)
  if (!token) {
    throw new GithubServerError(
      'not-connected',
      401,
      'Connect GitHub to use repository sync.',
    )
  }

  const bindings = await getGithubRuntime()
  const tokenHash = await sha256Hex(token)
  const authenticated = await getSessionWithUser(bindings.AUTH_DB, tokenHash)
  const now = Math.floor(Date.now() / 1000)
  if (!authenticated || authenticated.session.expires_at <= now) {
    if (authenticated) await deleteSession(bindings.AUTH_DB, tokenHash)
    throw new GithubServerError(
      'not-connected',
      401,
      'Your GitHub session expired. Please reconnect.',
    )
  }

  if (authenticated.session.last_seen_at <= now - SESSION_TOUCH_SECONDS) {
    await touchSession(bindings.AUTH_DB, tokenHash, now)
    authenticated.session.last_seen_at = now
  }

  return {
    ...authenticated,
    connection: await getConnection(bindings.AUTH_DB, authenticated.user.id),
  }
}

export async function authenticateServerFunctionRequest(
  request: Request,
): Promise<AuthenticatedGithubRequest> {
  assertAllowedOrigin(request)
  const authenticated = await authenticateRequest(request)
  const now = Math.floor(Date.now() / 1000)
  if (authenticated.session.rotated_at > now - SESSION_ROTATION_SECONDS) {
    return authenticated
  }

  const bindings = await getGithubRuntime()
  const nextToken = randomToken()
  const nextSession: GithubSessionRow = {
    ...authenticated.session,
    token_hash: await sha256Hex(nextToken),
    rotated_at: now,
    last_seen_at: now,
  }
  await rotateSession(
    bindings.AUTH_DB,
    authenticated.session.token_hash,
    nextSession,
  )
  setCookie(SESSION_COOKIE_NAME, nextToken, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: Math.max(0, nextSession.expires_at - now),
  })
  authenticated.session = nextSession
  return authenticated
}

export async function getGithubStatus(
  request: Request,
): Promise<GithubConnectionStatus> {
  assertAllowedOrigin(request)
  const bindings = await getGithubRuntime()

  let authenticated: AuthenticatedGithubRequest
  try {
    authenticated = await authenticateServerFunctionRequest(request)
  } catch (error) {
    if (error instanceof GithubServerError && error.code === 'not-connected') {
      return { status: 'disconnected', installUrl: installationUrl(bindings) }
    }
    throw error
  }

  const credentials = await getGithubCredentials(
    bindings.AUTH_DB,
    authenticated.user.id,
  )
  const revoked =
    credentials === null || authenticated.connection?.access_state === 'revoked'
  return {
    status: revoked ? 'access-revoked' : 'connected',
    user: toUserSummary(authenticated.user),
    repository: authenticated.connection
      ? toSelectedRepository(authenticated.connection)
      : null,
    installUrl: installationUrl(bindings),
  }
}

export async function githubClientForUser(
  userId: string,
): Promise<GithubApiClient> {
  const bindings = await getGithubRuntime()
  return new GithubApiClient((forceRefresh) =>
    getUserAccessToken(bindings, userId, forceRefresh),
  )
}

export { installationUrl }
