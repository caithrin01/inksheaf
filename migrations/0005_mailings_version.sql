-- A mailing names the version it pays for and the amount agreed (P0-2, P0-6).
ALTER TABLE mailings ADD COLUMN version_id INTEGER;
ALTER TABLE mailings ADD COLUMN amount_cents INTEGER;
ALTER TABLE mailings ADD COLUMN currency TEXT;
ALTER TABLE mailings ADD COLUMN stripe_event_id TEXT;
