import type {
  CutFlowerRawItem,
  DictionaryEntry,
  DictionaryStatus,
  ParserAlert,
  ParserMode,
  TouchakuImage,
} from '../shared/types.ts';

export interface StoredParsedBatch {
  id: string;
  contentHash: string;
  title: string;
  link: string;
  publishedAt: string;
  isoDate: string;
  dateLabel: string;
  hasCutFlowers: boolean;
  isPottedOnly: boolean;
  parserMode: ParserMode;
  rawItems: CutFlowerRawItem[];
  images: TouchakuImage[];
  parsedAt: string;
}

interface DictionaryRow {
  raw_key: string;
  raw_sample: string;
  cleaned_ja: string;
  zh_name: string;
  en_name: string;
  category: string;
  status: DictionaryStatus;
  ai_model: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: DictionaryRow): DictionaryEntry {
  return {
    rawKey: row.raw_key,
    rawSample: row.raw_sample,
    cleanedJa: row.cleaned_ja,
    zhName: row.zh_name,
    enName: row.en_name,
    category: row.category,
    status: row.status,
    aiModel: row.ai_model,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let schemaInitialized = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;
  await db.batch([
    db.prepare(`
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
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_flower_dictionary_status
        ON flower_dictionary(status)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_flower_dictionary_updated_at
        ON flower_dictionary(updated_at DESC)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS fetch_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )
    `),
    db.prepare(`
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
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_parsed_batches_iso_date
        ON parsed_batches(iso_date DESC, parsed_at DESC)
    `),
    db.prepare(`
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
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_parser_alerts_active
        ON parser_alerts(dismissed_at, created_at DESC)
    `),
  ]);
  schemaInitialized = true;
}

export async function getDictionaryByKeys(
  db: D1Database,
  rawKeys: string[],
): Promise<Map<string, DictionaryEntry>> {
  await ensureSchema(db);
  const result = new Map<string, DictionaryEntry>();
  if (rawKeys.length === 0) return result;

  // SQLite parameter limit safety: chunk by 80 keys
  const CHUNK_SIZE = 80;
  for (let i = 0; i < rawKeys.length; i += CHUNK_SIZE) {
    const chunk = rawKeys.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const query = `SELECT * FROM flower_dictionary WHERE raw_key IN (${placeholders})`;
    const { results } = await db
      .prepare(query)
      .bind(...chunk)
      .all<DictionaryRow>();
    for (const row of results) {
      result.set(row.raw_key, rowToEntry(row));
    }
  }
  return result;
}

export async function listDictionary(
  db: D1Database,
  options?: { status?: DictionaryStatus | 'all'; query?: string },
): Promise<DictionaryEntry[]> {
  await ensureSchema(db);
  const conditions: string[] = [];
  const binds: string[] = [];

  if (options?.status && options.status !== 'all') {
    conditions.push('status = ?');
    binds.push(options.status);
  }

  if (options?.query && options.query.trim()) {
    const like = `%${options.query.trim()}%`;
    conditions.push(
      '(raw_key LIKE ? OR raw_sample LIKE ? OR cleaned_ja LIKE ? OR zh_name LIKE ? OR en_name LIKE ? OR category LIKE ?)',
    );
    binds.push(like, like, like, like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM flower_dictionary ${where} ORDER BY CASE status WHEN 'verified' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1000`;
  const stmt = binds.length > 0 ? db.prepare(sql).bind(...binds) : db.prepare(sql);
  const { results } = await stmt.all<DictionaryRow>();
  return results.map(rowToEntry);
}

export async function upsertDictionaryEntry(
  db: D1Database,
  entry: {
    rawKey: string;
    rawSample: string;
    cleanedJa: string;
    zhName: string;
    enName: string;
    category: string;
    status: DictionaryStatus;
    aiModel?: string | null;
  },
): Promise<DictionaryEntry> {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const confirmedAt = entry.status === 'verified' ? now : null;

  await db
    .prepare(`
      INSERT INTO flower_dictionary (
        raw_key, raw_sample, cleaned_ja, zh_name, en_name, category,
        status, ai_model, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(raw_key) DO UPDATE SET
        raw_sample = COALESCE(NULLIF(excluded.raw_sample, ''), flower_dictionary.raw_sample),
        cleaned_ja = excluded.cleaned_ja,
        zh_name = excluded.zh_name,
        en_name = excluded.en_name,
        category = excluded.category,
        status = excluded.status,
        ai_model = CASE
          WHEN excluded.status = 'verified' THEN flower_dictionary.ai_model
          ELSE excluded.ai_model
        END,
        confirmed_at = CASE
          WHEN excluded.status = 'verified' THEN excluded.confirmed_at
          ELSE flower_dictionary.confirmed_at
        END,
        updated_at = excluded.updated_at
    `)
    .bind(
      entry.rawKey,
      entry.rawSample,
      entry.cleanedJa.trim(),
      entry.zhName.trim(),
      entry.enName.trim(),
      entry.category.trim(),
      entry.status,
      entry.aiModel ?? null,
      confirmedAt,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM flower_dictionary WHERE raw_key = ?')
    .bind(entry.rawKey)
    .first<DictionaryRow>();

  if (!row) {
    throw new Error(`Failed to read upserted dictionary entry: ${entry.rawKey}`);
  }
  return rowToEntry(row);
}

export async function saveAiEntriesIfNotVerified(
  db: D1Database,
  entries: Array<{
    rawKey: string;
    rawSample: string;
    cleanedJa: string;
    zhName: string;
    enName: string;
    category: string;
    aiModel: string;
  }>,
): Promise<DictionaryEntry[]> {
  await ensureSchema(db);
  if (entries.length === 0) return [];

  const now = new Date().toISOString();
  const statements = entries.map((entry) =>
    db
      .prepare(`
        INSERT INTO flower_dictionary (
          raw_key, raw_sample, cleaned_ja, zh_name, en_name, category,
          status, ai_model, confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ai', ?, NULL, ?, ?)
        ON CONFLICT(raw_key) DO UPDATE SET
          cleaned_ja = excluded.cleaned_ja,
          zh_name = excluded.zh_name,
          en_name = excluded.en_name,
          category = excluded.category,
          ai_model = excluded.ai_model,
          updated_at = excluded.updated_at
        WHERE flower_dictionary.status != 'verified'
      `)
      .bind(
        entry.rawKey,
        entry.rawSample,
        entry.cleanedJa.trim(),
        entry.zhName.trim(),
        entry.enName.trim(),
        entry.category.trim(),
        entry.aiModel,
        now,
        now,
      ),
  );

  await db.batch(statements);
  const map = await getDictionaryByKeys(
    db,
    entries.map((e) => e.rawKey),
  );
  return entries
    .map((e) => map.get(e.rawKey))
    .filter((e): e is DictionaryEntry => Boolean(e));
}

export async function confirmDictionaryEntry(
  db: D1Database,
  rawKey: string,
): Promise<DictionaryEntry | null> {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db
    .prepare(`
      UPDATE flower_dictionary
      SET status = 'verified', confirmed_at = ?, updated_at = ?
      WHERE raw_key = ?
    `)
    .bind(now, now, rawKey)
    .run();

  const row = await db
    .prepare('SELECT * FROM flower_dictionary WHERE raw_key = ?')
    .bind(rawKey)
    .first<DictionaryRow>();

  return row ? rowToEntry(row) : null;
}

export async function deleteDictionaryEntry(
  db: D1Database,
  rawKey: string,
): Promise<boolean> {
  await ensureSchema(db);
  const res = await db
    .prepare('DELETE FROM flower_dictionary WHERE raw_key = ?')
    .bind(rawKey)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function readCache<T>(
  db: D1Database,
  cacheKey: string,
  maxAgeMs: number,
): Promise<{ payload: T; fetchedAt: string } | null> {
  await ensureSchema(db);
  const row = await db
    .prepare('SELECT payload, fetched_at FROM fetch_cache WHERE cache_key = ?')
    .bind(cacheKey)
    .first<{ payload: string; fetched_at: string }>();

  if (!row) return null;
  const age = Date.now() - Date.parse(row.fetched_at);
  if (Number.isNaN(age) || age > maxAgeMs) return null;

  try {
    return {
      payload: JSON.parse(row.payload) as T,
      fetchedAt: row.fetched_at,
    };
  } catch {
    return null;
  }
}

export async function writeCache(
  db: D1Database,
  cacheKey: string,
  payload: unknown,
): Promise<string> {
  await ensureSchema(db);
  const fetchedAt = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO fetch_cache (cache_key, payload, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at
    `)
    .bind(cacheKey, JSON.stringify(payload), fetchedAt)
    .run();
  return fetchedAt;
}

interface ParsedBatchRow {
  post_id: string;
  content_hash: string;
  title: string;
  link: string;
  published_at: string;
  iso_date: string;
  date_label: string;
  has_cut_flowers: number;
  is_potted_only: number;
  parser_mode: ParserMode;
  items_json: string;
  images_json: string;
  parsed_at: string;
}

function rowToParsedBatch(row: ParsedBatchRow): StoredParsedBatch {
  return {
    id: row.post_id,
    contentHash: row.content_hash,
    title: row.title,
    link: row.link,
    publishedAt: row.published_at,
    isoDate: row.iso_date,
    dateLabel: row.date_label,
    hasCutFlowers: row.has_cut_flowers === 1,
    isPottedOnly: row.is_potted_only === 1,
    parserMode: row.parser_mode,
    rawItems: JSON.parse(row.items_json) as CutFlowerRawItem[],
    images: JSON.parse(row.images_json) as TouchakuImage[],
    parsedAt: row.parsed_at,
  };
}

export async function getParsedBatchById(
  db: D1Database,
  postId: string,
): Promise<StoredParsedBatch | null> {
  await ensureSchema(db);
  const row = await db
    .prepare('SELECT * FROM parsed_batches WHERE post_id = ?')
    .bind(postId)
    .first<ParsedBatchRow>();
  return row ? rowToParsedBatch(row) : null;
}

export async function upsertParsedBatch(
  db: D1Database,
  batch: Omit<StoredParsedBatch, 'parsedAt'>,
): Promise<StoredParsedBatch> {
  await ensureSchema(db);
  const parsedAt = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO parsed_batches (
        post_id, content_hash, title, link, published_at, iso_date, date_label,
        has_cut_flowers, is_potted_only, parser_mode, items_json, images_json, parsed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        content_hash = excluded.content_hash,
        title = excluded.title,
        link = excluded.link,
        published_at = excluded.published_at,
        iso_date = excluded.iso_date,
        date_label = excluded.date_label,
        has_cut_flowers = excluded.has_cut_flowers,
        is_potted_only = excluded.is_potted_only,
        parser_mode = excluded.parser_mode,
        items_json = excluded.items_json,
        images_json = excluded.images_json,
        parsed_at = excluded.parsed_at
    `)
    .bind(
      batch.id,
      batch.contentHash,
      batch.title,
      batch.link,
      batch.publishedAt,
      batch.isoDate,
      batch.dateLabel,
      batch.hasCutFlowers ? 1 : 0,
      batch.isPottedOnly ? 1 : 0,
      batch.parserMode,
      JSON.stringify(batch.rawItems),
      JSON.stringify(batch.images),
      parsedAt,
    )
    .run();

  return { ...batch, parsedAt };
}

export async function listRecentParsedBatches(
  db: D1Database,
  limit = 15,
): Promise<StoredParsedBatch[]> {
  await ensureSchema(db);
  const { results } = await db
    .prepare('SELECT * FROM parsed_batches ORDER BY iso_date DESC, published_at DESC LIMIT ?')
    .bind(limit)
    .all<ParsedBatchRow>();
  return results.map(rowToParsedBatch);
}

interface ParserAlertRow {
  post_id: string;
  post_title: string;
  post_url: string;
  iso_date: string;
  reason: string;
  fallback_status: 'workers_ai_ok' | 'anthropic_ok' | 'failed';
  fallback_item_count: number;
  raw_excerpt: string;
  created_at: string;
  updated_at: string;
}

export async function upsertParserAlert(
  db: D1Database,
  alert: {
    postId: string;
    postTitle: string;
    postUrl: string;
    isoDate: string;
    reason: string;
    fallbackStatus: 'workers_ai_ok' | 'anthropic_ok' | 'failed';
    fallbackItemCount: number;
    rawExcerpt: string;
  },
): Promise<{ isNew: boolean }> {
  await ensureSchema(db);
  const existing = await db
    .prepare('SELECT post_id FROM parser_alerts WHERE post_id = ?')
    .bind(alert.postId)
    .first<{ post_id: string }>();

  const now = new Date().toISOString();
  await db
    .prepare(`
      INSERT INTO parser_alerts (
        post_id, post_title, post_url, iso_date, reason,
        fallback_status, fallback_item_count, raw_excerpt,
        dismissed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        post_title = excluded.post_title,
        post_url = excluded.post_url,
        reason = excluded.reason,
        fallback_status = excluded.fallback_status,
        fallback_item_count = excluded.fallback_item_count,
        raw_excerpt = excluded.raw_excerpt,
        updated_at = excluded.updated_at
    `)
    .bind(
      alert.postId,
      alert.postTitle,
      alert.postUrl,
      alert.isoDate,
      alert.reason,
      alert.fallbackStatus,
      alert.fallbackItemCount,
      alert.rawExcerpt,
      now,
      now,
    )
    .run();

  return { isNew: !existing };
}

export async function listActiveParserAlerts(
  db: D1Database,
): Promise<ParserAlert[]> {
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      'SELECT * FROM parser_alerts WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT 10',
    )
    .all<ParserAlertRow>();
  return results.map((row) => ({
    postId: row.post_id,
    postTitle: row.post_title,
    postUrl: row.post_url,
    isoDate: row.iso_date,
    reason: row.reason,
    fallbackStatus: row.fallback_status,
    fallbackItemCount: row.fallback_item_count,
    rawExcerpt: row.raw_excerpt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function dismissParserAlert(
  db: D1Database,
  postId: string,
): Promise<boolean> {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const res = await db
    .prepare('UPDATE parser_alerts SET dismissed_at = ?, updated_at = ? WHERE post_id = ?')
    .bind(now, now, postId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
