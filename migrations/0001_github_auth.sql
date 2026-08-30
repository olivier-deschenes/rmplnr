PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS github_users (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_credentials (
  user_id TEXT PRIMARY KEY REFERENCES github_users(id) ON DELETE CASCADE,
  access_token_cipher TEXT NOT NULL,
  refresh_token_cipher TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  token_type TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS github_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES github_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS github_sessions_user_id
  ON github_sessions(user_id);
CREATE INDEX IF NOT EXISTS github_sessions_expires_at
  ON github_sessions(expires_at);

CREATE TABLE IF NOT EXISTS github_oauth_flows (
  state_hash TEXT PRIMARY KEY,
  verifier_cipher TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  return_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS github_oauth_flows_expires_at
  ON github_oauth_flows(expires_at);

CREATE TABLE IF NOT EXISTS github_repository_connections (
  user_id TEXT PRIMARY KEY REFERENCES github_users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  is_private INTEGER NOT NULL CHECK (is_private IN (0, 1)),
  can_push INTEGER NOT NULL CHECK (can_push IN (0, 1)),
  access_state TEXT NOT NULL DEFAULT 'active'
    CHECK (access_state IN ('active', 'unknown', 'revoked')),
  selected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS github_connections_repository_id
  ON github_repository_connections(repository_id);
CREATE INDEX IF NOT EXISTS github_connections_installation_id
  ON github_repository_connections(installation_id);

