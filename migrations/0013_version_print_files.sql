-- The validated print files of one version (interior and cover wrap per volume).
-- Stored on the version, not the press status row, which each later status replaces.
ALTER TABLE edition_versions ADD COLUMN files_json TEXT;
