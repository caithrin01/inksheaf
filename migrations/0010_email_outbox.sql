-- Delivery is independent of rendering/listing. The exact message and provider key survive
-- worker loss. This migration sends nothing and does not modify existing editions.
CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  version_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  intended_to TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  message_json TEXT NOT NULL,
  message_sha256 TEXT NOT NULL,
  send_status TEXT NOT NULL DEFAULT 'queued',
  delivery_status TEXT,
  provider_id TEXT,
  first_attempt_ms INTEGER,
  lease_started_ms INTEGER,
  accepted_ms INTEGER,
  delivery_event_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
);
CREATE INDEX email_outbox_version ON email_outbox(version_id, kind, created_ms);
