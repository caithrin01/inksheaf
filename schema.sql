CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  publication_url TEXT NOT NULL,
  name TEXT, role TEXT, email TEXT NOT NULL,
  archive_type TEXT, frequency TEXT, posts_per_year INTEGER,
  cadence_pref TEXT, us_subscribers TEXT, expected_orders TEXT,
  founding_count TEXT, price_range TEXT, interview_ok TEXT, concern TEXT,
  raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session TEXT, event TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preview_cache (
  host TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL
);
