-- Printed short links, inksheaf.com/l/<code> (2026-09-02).
CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link',
  signup_id INTEGER, slug TEXT, letter TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit TEXT
);
