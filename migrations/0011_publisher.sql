-- Private, resumable publisher work. These rows never create public book URLs.
CREATE TABLE publisher_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id INTEGER NOT NULL REFERENCES signups(id),
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(signup_id, run_id, sequence)
);
CREATE INDEX publisher_events_signup ON publisher_events(signup_id, id);
CREATE TABLE publisher_state (
  signup_id INTEGER PRIMARY KEY REFERENCES signups(id),
  revision INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
