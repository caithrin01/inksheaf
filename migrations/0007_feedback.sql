-- Visitor feedback from the "Tell us what you think" form (2026-09-04). No IP, no cookie.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  text TEXT NOT NULL,
  email TEXT,
  publication TEXT,
  page TEXT,
  ua TEXT
);
