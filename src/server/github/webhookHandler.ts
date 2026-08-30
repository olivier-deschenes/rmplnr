import {
  GithubWebhookError,
  assertGithubDeliveryId,
  parseGithubWebhook,
  readBoundedWebhookBody,
  verifyGithubWebhookSignature,
} from './webhookPayload.ts'

interface RepositoryEventsStub {
  notifyRepositoryChanged: (
    deliveryId: string,
    repositoryId: string,
    headSha: string,
  ) => Promise<{ duplicate: boolean }>
  notifyAccessChanged: (
    deliveryId: string,
    repositoryId: string,
  ) => Promise<{ duplicate: boolean }>
}

interface RepositoryEventsNamespace {
  getByName: (name: string) => RepositoryEventsStub
}

export interface GithubInstallationAccessEvent {
  event: 'installation' | 'installation_repositories'
  action: string
  installationId: string
  repositoryIdsAdded: Array<string>
  repositoryIdsRemoved: Array<string>
}

export interface GithubWebhookRuntime {
  webhookSecret: string
  repositoryEvents: RepositoryEventsNamespace
  isRepositorySelected: (repositoryId: string) => Promise<boolean>
  applyInstallationAccessEvent: (
    event: GithubInstallationAccessEvent,
  ) => Promise<Array<string>>
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function repositoryHubName(repositoryId: string): string {
  return `github-repository:${repositoryId}`
}

function validSelectedRepositoryIds(values: Array<string>): Array<string> {
  const unique = new Set<string>()

  for (const value of values) {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new Error('Invalid selected repository id.')
    }
    unique.add(value)
  }

  return [...unique]
}

/** Verifies and reduces a GitHub webhook to content-free repository hints. */
export async function handleGithubWebhook(
  request: Request,
  runtime: GithubWebhookRuntime,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: { allow: 'POST', 'cache-control': 'no-store' },
    })
  }

  try {
    const signature = request.headers.get('x-hub-signature-256') ?? ''
    const deliveryId = request.headers.get('x-github-delivery') ?? ''
    const event = request.headers.get('x-github-event') ?? ''

    assertGithubDeliveryId(deliveryId)
    if (!/^[a-z_]{1,64}$/.test(event)) {
      throw new GithubWebhookError(400, 'Invalid GitHub event name.')
    }
    if (runtime.webhookSecret.length === 0) {
      return emptyResponse(500)
    }

    const body = await readBoundedWebhookBody(request)
    if (
      !(await verifyGithubWebhookSignature(
        runtime.webhookSecret,
        signature,
        body,
      ))
    ) {
      return emptyResponse(401)
    }

    const notification = parseGithubWebhook(event, body)
    if (notification.type === 'ignored') return emptyResponse(204)

    if (notification.type === 'repository-changed') {
      if (!(await runtime.isRepositorySelected(notification.repositoryId))) {
        return emptyResponse(204)
      }

      const hub = runtime.repositoryEvents.getByName(
        repositoryHubName(notification.repositoryId),
      )
      await hub.notifyRepositoryChanged(
        deliveryId,
        notification.repositoryId,
        notification.headSha,
      )
      return emptyResponse(204)
    }

    const repositoryIds = validSelectedRepositoryIds(
      await runtime.applyInstallationAccessEvent({
        event: notification.event,
        action: notification.action,
        installationId: notification.installationId,
        repositoryIdsAdded: notification.repositoryIdsAdded,
        repositoryIdsRemoved: notification.repositoryIdsRemoved,
      }),
    )

    await Promise.all(
      repositoryIds.map((repositoryId) =>
        runtime.repositoryEvents
          .getByName(repositoryHubName(repositoryId))
          .notifyAccessChanged(deliveryId, repositoryId),
      ),
    )

    return emptyResponse(204)
  } catch (error) {
    if (error instanceof GithubWebhookError) {
      return emptyResponse(error.status)
    }

    // Do not put payloads, repository names, or credentials in either the
    // response or logs. GitHub will retry this delivery after a 5xx.
    return emptyResponse(500)
  }
}
