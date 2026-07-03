-- Renovation ranker schema. One scans row per address per scan date so
-- re-scans can track degradation/improvement over time.

CREATE TABLE IF NOT EXISTS properties (
  id          SERIAL PRIMARY KEY,
  address     TEXT NOT NULL UNIQUE,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  zip         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scans (
  id                    SERIAL PRIMARY KEY,
  property_id           INTEGER NOT NULL REFERENCES properties(id),
  scan_date             TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT NOT NULL, -- scored | no_reliable_imagery | error
  pano_id               TEXT,
  imagery_capture_date  TEXT,          -- "YYYY-MM" from Street View metadata
  model                 TEXT,
  report                JSONB,         -- full VisionReport (findings + image_quality + notes)
  scores                JSONB,         -- category + per-contractor scores + confidence
  error                 TEXT
);

CREATE INDEX IF NOT EXISTS scans_property_idx ON scans(property_id, scan_date DESC);

-- One row per category per scan, for SQL-side filtering of lead lists.
CREATE TABLE IF NOT EXISTS scan_findings (
  id        SERIAL PRIMARY KEY,
  scan_id   INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  category  TEXT NOT NULL,
  item      TEXT NOT NULL,
  severity  SMALLINT NOT NULL,
  visible   BOOLEAN NOT NULL,
  evidence  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS scan_findings_scan_idx ON scan_findings(scan_id);
CREATE INDEX IF NOT EXISTS scan_findings_cat_idx ON scan_findings(category, severity);

-- Audit trail of lists sold/exported per contractor type (Phase 2 fills this in).
CREATE TABLE IF NOT EXISTS contractor_exports (
  id               SERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  contractor_type  TEXT NOT NULL,
  filters          JSONB,
  row_count        INTEGER NOT NULL
);
