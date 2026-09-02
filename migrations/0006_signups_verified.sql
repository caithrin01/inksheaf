-- A reservation records whether its email was verified and its dispatch state (P0-7, P0-8).
ALTER TABLE signups ADD COLUMN email_verified_at TEXT;
ALTER TABLE signups ADD COLUMN dispatch_status TEXT;
