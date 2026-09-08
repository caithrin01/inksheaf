-- A request can be retried without creating another reservation. A new edition gets
-- a new request key, even when its publication and recipient have been used before.
ALTER TABLE signups ADD COLUMN reservation_key TEXT;
ALTER TABLE signups ADD COLUMN reservation_payload_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS signups_reservation_key ON signups (reservation_key);

-- Provider acceptance is separate from inbox delivery. Preserve ambiguous sends so
-- the same verification message can be retried with the provider's idempotency key.
ALTER TABLE email_verifications ADD COLUMN send_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE email_verifications ADD COLUMN provider_id TEXT;
ALTER TABLE email_verifications ADD COLUMN sent_at TEXT;
ALTER TABLE email_verifications ADD COLUMN send_started_at TEXT;
ALTER TABLE email_verifications ADD COLUMN send_error TEXT;
ALTER TABLE email_verifications ADD COLUMN message_json TEXT;
ALTER TABLE email_verifications ADD COLUMN send_mode TEXT;
