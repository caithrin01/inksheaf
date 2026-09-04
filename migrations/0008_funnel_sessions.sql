-- Privacy-light lead funnel. A random browser-session id is tied to the public publication host;
-- email remains in signups and is joined only by signup_id. No IP or archive content is stored.
CREATE TABLE IF NOT EXISTS funnel_sessions (
  session TEXT NOT NULL,
  host TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_event TEXT NOT NULL DEFAULT 'preview_ok',
  preview_ok_at TEXT,
  preview_failed_at TEXT,
  reserve_started_at TEXT,
  signup_id INTEGER,
  signup_at TEXT,
  verified_at TEXT,
  alerted_preview_at TEXT,
  alerted_signup_at TEXT,
  alerted_verified_at TEXT,
  PRIMARY KEY (session, host)
);
CREATE INDEX IF NOT EXISTS funnel_sessions_signup ON funnel_sessions (signup_id);
CREATE INDEX IF NOT EXISTS funnel_sessions_updated ON funnel_sessions (updated_at);
