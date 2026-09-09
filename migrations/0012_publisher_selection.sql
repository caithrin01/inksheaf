-- Creator corrections are separate from the inference journal: restoring a piece
-- cannot reset spend or overwrite a worker's cache reservation.
CREATE TABLE IF NOT EXISTS publisher_selections (
  signup_id INTEGER PRIMARY KEY REFERENCES signups(id),
  revision INTEGER NOT NULL DEFAULT 0,
  restored_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE edition_versions ADD COLUMN selection_revision INTEGER NOT NULL DEFAULT 0;

-- This check and the version insert are one SQLite operation. A correction that
-- wins the race to finish prevents the older selection from becoming deliverable.
CREATE TRIGGER IF NOT EXISTS edition_selection_current BEFORE INSERT ON edition_versions
WHEN NEW.selection_revision != COALESCE(
  (SELECT revision FROM publisher_selections WHERE signup_id=NEW.signup_id), 0)
BEGIN SELECT RAISE(ABORT, 'publisher selection changed'); END;
