-- Run once on a database made before 2026-11-16 (schema.sql already has these columns).
--   wrangler d1 execute swoopahead --remote --file=migrate-0002.sql
ALTER TABLE spots ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN activity TEXT;
ALTER TABLE reports ADD COLUMN cancel TEXT;
