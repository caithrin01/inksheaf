-- Created by hand in production on 2026-09-01 and never committed (Codex audit P0-9).
CREATE TABLE IF NOT EXISTS press (
  signup_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mailings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id INTEGER NOT NULL,
  level TEXT, addresses TEXT, quote TEXT,
  status TEXT NOT NULL,
  stripe_session TEXT, stripe_payment TEXT, paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
