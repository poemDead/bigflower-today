CREATE TABLE IF NOT EXISTS parsed_batches (
  post_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  published_at TEXT NOT NULL,
  iso_date TEXT NOT NULL,
  date_label TEXT NOT NULL,
  has_cut_flowers INTEGER NOT NULL DEFAULT 0,
  is_potted_only INTEGER NOT NULL DEFAULT 0,
  parser_mode TEXT NOT NULL DEFAULT 'rule',
  items_json TEXT NOT NULL,
  images_json TEXT NOT NULL,
  parsed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parsed_batches_iso_date
  ON parsed_batches(iso_date DESC, parsed_at DESC);

CREATE TABLE IF NOT EXISTS parser_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL UNIQUE,
  post_title TEXT NOT NULL,
  post_url TEXT NOT NULL,
  iso_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  fallback_status TEXT NOT NULL,
  fallback_item_count INTEGER NOT NULL DEFAULT 0,
  raw_excerpt TEXT NOT NULL,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parser_alerts_active
  ON parser_alerts(dismissed_at, created_at DESC);
