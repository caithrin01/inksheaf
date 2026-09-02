-- The immutable edition version (Codex audit P0-1) and the payment records (P0-6), the
-- verification and quota tables (P0-8). One version owns: the plan, the post ids and body
-- hashes it was built from, the renderer commit, the proof's digest and page count, the
-- print mode, the quote, and the approval. Everything downstream names a version id.
CREATE TABLE IF NOT EXISTS edition_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  plan_json TEXT NOT NULL,
  post_ids TEXT NOT NULL,          -- JSON array, in book order
  body_hashes TEXT NOT NULL,       -- JSON object, post id -> sha256 of body_html
  renderer_sha TEXT NOT NULL,      -- git commit of the press that built it
  print_mode TEXT NOT NULL,        -- bw | color
  volumes TEXT NOT NULL,           -- JSON per volume: label, pages, interior key, sha256, cover key
  proof_key TEXT, proof_sha256 TEXT, pages INTEGER,
  quote_json TEXT,                 -- the Lulu quote for this exact object
  status TEXT NOT NULL DEFAULT 'proofed',  -- proofed | approved | building-final | validated | listing-pending | listed | failed | superseded
  approval_nonce TEXT, approved_at TEXT, approved_from TEXT,
  listing_url TEXT, run_id TEXT, error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS edition_versions_signup ON edition_versions (signup_id, id);
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,             -- Stripe event id, seen once
  type TEXT NOT NULL,
  mailing_id INTEGER,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome TEXT
);
CREATE TABLE IF NOT EXISTS print_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailing_id INTEGER NOT NULL UNIQUE,
  version_id INTEGER,
  external_id TEXT NOT NULL UNIQUE, -- stable id sent to Lulu, so a retry never doubles
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | dispatched | printing | shipped | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS email_verifications (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  signup_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE TABLE IF NOT EXISTS allowlist (
  email TEXT PRIMARY KEY,
  host TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quota_hits (
  key TEXT NOT NULL,               -- ip:<hash> | host:<host> | email:<hash>
  bucket TEXT NOT NULL,            -- hour bucket
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket)
);
