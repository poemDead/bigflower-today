CREATE TABLE IF NOT EXISTS flower_dictionary (
  raw_key TEXT PRIMARY KEY,
  raw_sample TEXT NOT NULL,
  cleaned_ja TEXT NOT NULL,
  zh_name TEXT NOT NULL DEFAULT '',
  en_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ai' CHECK (status IN ('ai', 'verified')),
  ai_model TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flower_dictionary_status
  ON flower_dictionary(status);

CREATE INDEX IF NOT EXISTS idx_flower_dictionary_updated_at
  ON flower_dictionary(updated_at DESC);

CREATE TABLE IF NOT EXISTS fetch_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
