import type {
  GithubRepositorySummary,
  GithubSelectedRepository,
  GithubUserSummary,
} from '#/features/github/contracts.ts'

import type { D1Database } from './runtime.ts'

export interface GithubUserRow {
  id: string
  github_user_id: string
  login: string
  avatar_url: string
  profile_url: string
  created_at: number
  updated_at: number
}

export interface GithubCredentialRow {
  user_id: string
  access_token_cipher: string
  refresh_token_cipher: string | null
  access_token_expires_at: number | null
  refresh_token_expires_at: number | null
  token_type: string
  updated_at: number
}

export interface GithubSessionRow {
  token_hash: string
  user_id: string
  created_at: number
  rotated_at: number
  last_seen_at: number
  expires_at: number
}

export interface GithubOauthFlowRow {
  state_hash: string
  verifier_cipher: string
  redirect_uri: string
  return_path: string
  created_at: number
  expires_at: number
}

export interface GithubConnectionRow {
  user_id: string
  installation_id: string
  repository_id: string
  owner: string
  name: string
  full_name: string
  html_url: string
  default_branch: string
  is_private: number
  can_push: number
  access_state: 'active' | 'unknown' | 'revoked'
  selected_at: number
  updated_at: number
}

export function toUserSummary(row: GithubUserRow): GithubUserSummary {
  return {
    id: row.github_user_id,
    login: row.login,
    avatarUrl: row.avatar_url,
    profileUrl: row.profile_url,
  }
}

export function toSelectedRepository(
  row: GithubConnectionRow,
): GithubSelectedRepository {
  return {
    id: row.repository_id,
    installationId: row.installation_id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    htmlUrl: row.html_url,
    defaultBranch: row.default_branch,
    isPrivate: row.is_private === 1,
    canPush: row.can_push === 1,
    accessState: row.access_state,
  }
}

export async function deleteExpiredAuthRows(
  db: D1Database,
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM github_sessions WHERE expires_at <= ?').bind(now),
    db
      .prepare('DELETE FROM github_oauth_flows WHERE expires_at <= ?')
      .bind(now),
  ])
}

export async function putOauthFlow(
  db: D1Database,
  row: GithubOauthFlowRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO github_oauth_flows
        (state_hash, verifier_cipher, redirect_uri, return_path, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.state_hash,
      row.verifier_cipher,
      row.redirect_uri,
      row.return_path,
      row.created_at,
      row.expires_at,
    )
    .run()
}

export async function consumeOauthFlow(
  db: D1Database,
  stateHash: string,
): Promise<GithubOauthFlowRow | null> {
  return db
    .prepare(
      `DELETE FROM github_oauth_flows
       WHERE state_hash = ?
       RETURNING state_hash, verifier_cipher, redirect_uri, return_path,
                 created_at, expires_at`,
    )
    .bind(stateHash)
    .first<GithubOauthFlowRow>()
}

export async function upsertGithubUser(
  db: D1Database,
  githubUser: {
    id: string
    login: string
    avatarUrl: string
    profileUrl: string
  },
  now: number,
): Promise<GithubUserRow> {
  const newId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO github_users
        (id, github_user_id, login, avatar_url, profile_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_user_id) DO UPDATE SET
         login = excluded.login,
         avatar_url = excluded.avatar_url,
         profile_url = excluded.profile_url,
         updated_at = excluded.updated_at`,
    )
    .bind(
      newId,
      githubUser.id,
      githubUser.login,
      githubUser.avatarUrl,
      githubUser.profileUrl,
      now,
      now,
    )
    .run()

  const row = await db
    .prepare('SELECT * FROM github_users WHERE github_user_id = ?')
    .bind(githubUser.id)
    .first<GithubUserRow>()
  if (!row) throw new Error('GitHub user upsert did not return a user.')
  return row
}

export async function putGithubCredentials(
  db: D1Database,
  row: GithubCredentialRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO github_credentials
        (user_id, access_token_cipher, refresh_token_cipher,
         access_token_expires_at, refresh_token_expires_at, token_type, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token_cipher = excluded.access_token_cipher,
         refresh_token_cipher = excluded.refresh_token_cipher,
         access_token_expires_at = excluded.access_token_expires_at,
         refresh_token_expires_at = excluded.refresh_token_expires_at,
         token_type = excluded.token_type,
         updated_at = excluded.updated_at`,
    )
    .bind(
      row.user_id,
      row.access_token_cipher,
      row.refresh_token_cipher,
      row.access_token_expires_at,
      row.refresh_token_expires_at,
      row.token_type,
      row.updated_at,
    )
    .run()
}

export async function getGithubCredentials(
  db: D1Database,
  userId: string,
): Promise<GithubCredentialRow | null> {
  return db
    .prepare('SELECT * FROM github_credentials WHERE user_id = ?')
    .bind(userId)
    .first<GithubCredentialRow>()
}

export async function replaceGithubCredentials(
  db: D1Database,
  previousRefreshCipher: string,
  row: GithubCredentialRow,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE github_credentials SET
         access_token_cipher = ?,
         refresh_token_cipher = ?,
         access_token_expires_at = ?,
         refresh_token_expires_at = ?,
         token_type = ?,
         updated_at = ?
       WHERE user_id = ? AND refresh_token_cipher = ?`,
    )
    .bind(
      row.access_token_cipher,
      row.refresh_token_cipher,
      row.access_token_expires_at,
      row.refresh_token_expires_at,
      row.token_type,
      row.updated_at,
      row.user_id,
      previousRefreshCipher,
    )
    .run()
  return (result.meta.changes ?? 0) === 1
}

export async function deleteGithubCredentials(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM github_credentials WHERE user_id = ?')
    .bind(userId)
    .run()
}

export async function getSessionWithUser(
  db: D1Database,
  tokenHash: string,
): Promise<{ session: GithubSessionRow; user: GithubUserRow } | null> {
  const row = await db
    .prepare(
      `SELECT
         s.token_hash, s.user_id, s.created_at, s.rotated_at,
         s.last_seen_at, s.expires_at,
         u.github_user_id, u.login, u.avatar_url, u.profile_url,
         u.created_at AS user_created_at, u.updated_at AS user_updated_at
       FROM github_sessions s
       JOIN github_users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<
      GithubSessionRow &
        Omit<GithubUserRow, 'id' | 'created_at' | 'updated_at'> & {
          user_created_at: number
          user_updated_at: number
        }
    >()

  if (!row) return null
  return {
    session: {
      token_hash: row.token_hash,
      user_id: row.user_id,
      created_at: row.created_at,
      rotated_at: row.rotated_at,
      last_seen_at: row.last_seen_at,
      expires_at: row.expires_at,
    },
    user: {
      id: row.user_id,
      github_user_id: row.github_user_id,
      login: row.login,
      avatar_url: row.avatar_url,
      profile_url: row.profile_url,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at,
    },
  }
}

export async function createSession(
  db: D1Database,
  row: GithubSessionRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO github_sessions
        (token_hash, user_id, created_at, rotated_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.token_hash,
      row.user_id,
      row.created_at,
      row.rotated_at,
      row.last_seen_at,
      row.expires_at,
    )
    .run()
}

export async function rotateSession(
  db: D1Database,
  oldTokenHash: string,
  next: GithubSessionRow,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO github_sessions
          (token_hash, user_id, created_at, rotated_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        next.token_hash,
        next.user_id,
        next.created_at,
        next.rotated_at,
        next.last_seen_at,
        next.expires_at,
      ),
    db
      .prepare('DELETE FROM github_sessions WHERE token_hash = ?')
      .bind(oldTokenHash),
  ])
}

export async function touchSession(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE github_sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(now, tokenHash)
    .run()
}

export async function deleteSession(
  db: D1Database,
  tokenHash: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM github_sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .run()
}

export async function deleteUserSessions(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM github_sessions WHERE user_id = ?')
    .bind(userId)
    .run()
}

export async function getConnection(
  db: D1Database,
  userId: string,
): Promise<GithubConnectionRow | null> {
  return db
    .prepare('SELECT * FROM github_repository_connections WHERE user_id = ?')
    .bind(userId)
    .first<GithubConnectionRow>()
}

export async function putConnection(
  db: D1Database,
  userId: string,
  repository: GithubRepositorySummary,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO github_repository_connections
        (user_id, installation_id, repository_id, owner, name, full_name,
         html_url, default_branch, is_private, can_push, access_state,
         selected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         installation_id = excluded.installation_id,
         repository_id = excluded.repository_id,
         owner = excluded.owner,
         name = excluded.name,
         full_name = excluded.full_name,
         html_url = excluded.html_url,
         default_branch = excluded.default_branch,
         is_private = excluded.is_private,
         can_push = excluded.can_push,
         access_state = 'active',
         selected_at = excluded.selected_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      repository.installationId,
      repository.id,
      repository.owner,
      repository.name,
      repository.fullName,
      repository.htmlUrl,
      repository.defaultBranch,
      repository.isPrivate ? 1 : 0,
      repository.canPush ? 1 : 0,
      now,
      now,
    )
    .run()
}

export async function updateConnection(
  db: D1Database,
  userId: string,
  repository: GithubRepositorySummary,
  accessState: GithubConnectionRow['access_state'],
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE github_repository_connections SET
         installation_id = ?, owner = ?, name = ?, full_name = ?,
         html_url = ?, default_branch = ?, is_private = ?, can_push = ?,
         access_state = ?, updated_at = ?
       WHERE user_id = ? AND repository_id = ?`,
    )
    .bind(
      repository.installationId,
      repository.owner,
      repository.name,
      repository.fullName,
      repository.htmlUrl,
      repository.defaultBranch,
      repository.isPrivate ? 1 : 0,
      repository.canPush ? 1 : 0,
      accessState,
      now,
      userId,
      repository.id,
    )
    .run()
}

export async function deleteConnection(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM github_repository_connections WHERE user_id = ?')
    .bind(userId)
    .run()
}

export async function isRepositorySelected(
  db: D1Database,
  repositoryId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT repository_id FROM github_repository_connections WHERE repository_id = ? LIMIT 1',
    )
    .bind(repositoryId)
    .first<{ repository_id: string }>()
  return row !== null
}

export async function connectionsForInstallation(
  db: D1Database,
  installationId: string,
): Promise<GithubConnectionRow[]> {
  const result = await db
    .prepare(
      'SELECT * FROM github_repository_connections WHERE installation_id = ?',
    )
    .bind(installationId)
    .all<GithubConnectionRow>()
  return result.results
}

export async function setConnectionAccessState(
  db: D1Database,
  userId: string,
  state: GithubConnectionRow['access_state'],
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE github_repository_connections
       SET access_state = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(state, now, userId)
    .run()
}

/**
 * Lift a revocation once the user has authorized again.
 *
 * `revoked` is what the status endpoint reads to decide the connection is
 * broken, and nothing else clears it, so a fresh set of credentials with the
 * old flag still standing leaves the reconnect button reporting the very
 * failure it just fixed. Back to `unknown` rather than `active`: the user is
 * authorized again, but whether the app can still reach the repository is not
 * known until something asks GitHub, and that answer promotes it to `active`
 * or marks it revoked once more.
 */
export async function clearConnectionRevocation(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE github_repository_connections
       SET access_state = 'unknown', updated_at = ?
       WHERE user_id = ? AND access_state = 'revoked'`,
    )
    .bind(now, userId)
    .run()
}
