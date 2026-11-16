-- Swoop Ahead's database (Cloudflare D1, which is SQLite).
--
--   wrangler d1 execute swoopahead --local  --file=schema.sql    the copy used by `wrangler pages dev`
--   wrangler d1 execute swoopahead --remote --file=schema.sql    the live one

-- One row per bird's patch. Reports within the merge distance share a spot.
CREATE TABLE IF NOT EXISTS spots (
  id           INTEGER PRIMARY KEY,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  name         TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quiet', 'removed')),
  quiet_season INTEGER,            -- the year it was marked quiet for
  first_report TEXT NOT NULL,      -- ISO UTC
  last_report  TEXT NOT NULL,      -- ISO UTC
  reports      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_spots_lat ON spots(lat);

-- Every report behind a spot. uid comes from the sender, so a tap resent after
-- a dropped link counts once. install is a random id a Karoo makes once; it is
-- shown to the admin only, so one device sending junk can be seen.
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  spot_id     INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  install     TEXT,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  heading_deg REAL,                -- direction of travel at the tap, if known
  at          TEXT NOT NULL,       -- ISO UTC, when it happened
  source      TEXT NOT NULL CHECK (source IN ('karoo', 'web', 'hand', 'datavic')),
  uid         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_spot ON reports(spot_id, at);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

-- Values changed on the admin page. A key with no row uses the default in lib/store.ts.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Counts for the hourly limits. key is a scrambled network address, different
-- every day. Rows older than a day are deleted.
CREATE TABLE IF NOT EXISTS limits (
  key  TEXT NOT NULL,
  hour TEXT NOT NULL,
  n    INTEGER NOT NULL,
  PRIMARY KEY (key, hour)
);
