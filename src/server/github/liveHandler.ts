interface SelectedLiveConnection {
  repositoryId: string
  sessionExpiresAt: number
}

interface RepositoryEventsStub {
  fetch: (request: Request) => Promise<Response>
}

interface RepositoryEventsNamespace {
  getByName: (name: string) => RepositoryEventsStub
}

export interface GithubLiveRuntime {
  repositoryEvents: RepositoryEventsNamespace
  requireSelectedConnection: (
    request: Request,
  ) => Promise<SelectedLiveConnection>
}

function errorResponse(status: number, message: string): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

function safeAuthStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return 500
  }

  const status = Reflect.get(error, 'status')
  return status === 401 || status === 403 ? status : 500
}

/** Authenticates a browser before proxying its upgrade to the repository hub. */
export async function handleGithubLiveUpgrade(
  request: Request,
  runtime: GithubLiveRuntime,
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, {
      status: 405,
      headers: { allow: 'GET', 'cache-control': 'no-store' },
    })
  }

  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return errorResponse(426, 'Expected a WebSocket upgrade.')
  }

  const origin = request.headers.get('origin')
  if (origin === null || origin !== new URL(request.url).origin) {
    return errorResponse(403, 'This connection must come from this site.')
  }

  let connection: SelectedLiveConnection
  try {
    connection = await runtime.requireSelectedConnection(request)
  } catch (error) {
    const status = safeAuthStatus(error)
    return errorResponse(
      status,
      status === 401
        ? 'Connect GitHub to receive repository updates.'
        : status === 403
          ? 'Repository access is no longer available.'
          : 'The live connection could not be authorized.',
    )
  }

  if (
    !/^[1-9][0-9]*$/.test(connection.repositoryId) ||
    !Number.isSafeInteger(connection.sessionExpiresAt) ||
    connection.sessionExpiresAt <= Date.now()
  ) {
    return errorResponse(401, 'The GitHub session has expired.')
  }

  const headers = new Headers({
    upgrade: 'websocket',
    'x-rmplnr-repository-id': connection.repositoryId,
    'x-rmplnr-session-expires-at': String(connection.sessionExpiresAt),
  })
  const internalRequest = new Request(
    `https://repository-events.internal/${connection.repositoryId}`,
    { method: 'GET', headers },
  )
  const hub = runtime.repositoryEvents.getByName(
    `github-repository:${connection.repositoryId}`,
  )

  return hub.fetch(internalRequest)
}
