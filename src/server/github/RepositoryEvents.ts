import { DurableObject } from 'cloudflare:workers'

import type { RepositoryEventMessage } from '#/features/github/repositoryEvents.ts'

const MAXIMUM_STORED_DELIVERIES = 512
const REPOSITORY_ID_PATTERN = /^[1-9][0-9]*$/
const GITHUB_SHA_PATTERN = /^[a-f0-9]{40,64}$/
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/

interface ConnectionAttachment {
  repositoryId: string
  sessionExpiresAt: number
}

interface LatestHintRow extends Record<string, unknown> {
  event_type: 'repository-changed' | 'access-changed'
  repository_id: string
  head_sha: string | null
}

export interface RepositoryNotificationResult {
  duplicate: boolean
}

function isConnectionAttachment(value: unknown): value is ConnectionAttachment {
  if (typeof value !== 'object' || value === null) return false
  const attachment = value as Record<string, unknown>

  return (
    typeof attachment.repositoryId === 'string' &&
    REPOSITORY_ID_PATTERN.test(attachment.repositoryId) &&
    typeof attachment.sessionExpiresAt === 'number' &&
    Number.isSafeInteger(attachment.sessionExpiresAt)
  )
}

function assertRepositoryId(repositoryId: string): void {
  if (!REPOSITORY_ID_PATTERN.test(repositoryId)) {
    throw new Error('Invalid repository id.')
  }
}

function assertDeliveryId(deliveryId: string): void {
  if (!DELIVERY_ID_PATTERN.test(deliveryId)) {
    throw new Error('Invalid delivery id.')
  }
}

/** One hibernating notification hub for one GitHub repository. */
export class RepositoryEvents extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    void ctx.blockConcurrencyWhile(async () => {
      this.migrate()
    })
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)

    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        'SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations',
      )
      .one().version

    if (version < 1) {
      const now = Date.now()
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS github_deliveries (
          delivery_id TEXT PRIMARY KEY,
          received_at INTEGER NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS latest_hint (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          event_type TEXT NOT NULL CHECK (
            event_type IN ('repository-changed', 'access-changed')
          ),
          repository_id TEXT NOT NULL,
          head_sha TEXT,
          changed_at INTEGER NOT NULL
        );
      `)
      this.ctx.storage.sql.exec(
        'INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?)',
        now,
      )
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (
      request.method !== 'GET' ||
      request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
    ) {
      return new Response('Expected a WebSocket upgrade.', { status: 426 })
    }

    const repositoryId = request.headers.get('x-rmplnr-repository-id') ?? ''
    const expiresHeader = request.headers.get('x-rmplnr-session-expires-at')
    const sessionExpiresAt = Number(expiresHeader)

    if (
      !REPOSITORY_ID_PATTERN.test(repositoryId) ||
      !Number.isSafeInteger(sessionExpiresAt) ||
      sessionExpiresAt <= Date.now()
    ) {
      return new Response('Unauthorized.', { status: 401 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    server.serializeAttachment({
      repositoryId,
      sessionExpiresAt,
    } satisfies ConnectionAttachment)
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async notifyRepositoryChanged(
    deliveryId: string,
    repositoryId: string,
    headSha: string,
  ): Promise<RepositoryNotificationResult> {
    assertRepositoryId(repositoryId)
    assertDeliveryId(deliveryId)
    if (!GITHUB_SHA_PATTERN.test(headSha)) throw new Error('Invalid head SHA.')

    return this.persistAndBroadcast(deliveryId, {
      type: 'repository-changed',
      repositoryId,
      headSha,
    })
  }

  async notifyAccessChanged(
    deliveryId: string,
    repositoryId: string,
  ): Promise<RepositoryNotificationResult> {
    assertRepositoryId(repositoryId)
    assertDeliveryId(deliveryId)

    return this.persistAndBroadcast(deliveryId, {
      type: 'access-changed',
      repositoryId,
    })
  }

  async getLatestHint(): Promise<RepositoryEventMessage | null> {
    const rows = this.ctx.storage.sql
      .exec<LatestHintRow>(
        'SELECT event_type, repository_id, head_sha FROM latest_hint WHERE singleton = 1',
      )
      .toArray()

    const latest = rows.at(0)
    if (!latest) return null

    if (latest.event_type === 'access-changed') {
      return {
        type: 'access-changed',
        repositoryId: latest.repository_id,
      }
    }

    if (latest.head_sha === null) return null
    return {
      type: 'repository-changed',
      repositoryId: latest.repository_id,
      headSha: latest.head_sha,
    }
  }

  private persistAndBroadcast(
    deliveryId: string,
    message: RepositoryEventMessage,
  ): RepositoryNotificationResult {
    const now = Date.now()
    const inserted = this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO github_deliveries (delivery_id, received_at) VALUES (?, ?)',
      deliveryId,
      now,
    )

    if (inserted.rowsWritten === 0) return { duplicate: true }

    // These synchronous SQLite writes are committed before any socket sees the
    // hint, so eviction or a failed broadcast cannot lose the authoritative cue.
    this.ctx.storage.sql.exec(
      `INSERT INTO latest_hint (
        singleton, event_type, repository_id, head_sha, changed_at
      ) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        event_type = excluded.event_type,
        repository_id = excluded.repository_id,
        head_sha = excluded.head_sha,
        changed_at = excluded.changed_at`,
      message.type,
      message.repositoryId,
      message.type === 'repository-changed' ? message.headSha : null,
      now,
    )
    this.ctx.storage.sql.exec(
      `DELETE FROM github_deliveries
       WHERE delivery_id NOT IN (
         SELECT delivery_id
         FROM github_deliveries
         ORDER BY received_at DESC, delivery_id DESC
         LIMIT ?
       )`,
      MAXIMUM_STORED_DELIVERIES,
    )

    this.broadcast(message)
    return { duplicate: false }
  }

  private broadcast(message: RepositoryEventMessage): void {
    const serialized = JSON.stringify(message)
    const now = Date.now()

    for (const socket of this.ctx.getWebSockets()) {
      const attachment: unknown = socket.deserializeAttachment()

      if (
        !isConnectionAttachment(attachment) ||
        attachment.repositoryId !== message.repositoryId ||
        attachment.sessionExpiresAt <= now
      ) {
        socket.close(1008, 'Session expired')
        continue
      }

      try {
        socket.send(serialized)
        if (message.type === 'access-changed') {
          // A reconnect forces the outer Worker to authorize access again.
          socket.close(4003, 'Repository access changed')
        }
      } catch {
        socket.close(1011, 'Notification failed')
      }
    }
  }

  webSocketMessage(socket: WebSocket): void {
    // Clients receive invalidations only; accepting application data would turn
    // this endpoint into an unnecessary second command channel.
    socket.close(1008, 'Client messages are not supported')
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'WebSocket error')
  }
}
