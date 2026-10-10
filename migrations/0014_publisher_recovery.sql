-- Explicit operator restarts preserve the entire failed attempt, including
-- charges and render reservations. Automatic retries cannot use this path.
CREATE TABLE IF NOT EXISTS publisher_recovery_history (
  request_key TEXT PRIMARY KEY,
  signup_id INTEGER NOT NULL REFERENCES signups(id),
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(signup_id, revision)
);
