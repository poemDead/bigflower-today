import { Hono, type Context } from 'hono';
import { buildGoogleImageUrl } from '../shared/googleSearch.ts';
import type {
  ArrivalResponse,
  BlogBatchDetail,
  BlogBatchSummary,
  CutFlowerItem,
  CutFlowerRawItem,
  DictionaryEntry,
  DictionaryStatus,
  ParserMode,
  TodayArrivalStatus,
  TouchakuInfo,
  TranslateBatchRequest,
  TranslateBatchResponse,
  UpsertDictionaryRequest,
} from '../shared/types.ts';
import {
  detectAiProvider,
  translateCutFlowersWithAi,
  type AiEnvConfig,
} from './ai.ts';
import {
  confirmDictionaryEntry,
  deleteDictionaryEntry,
  dismissParserAlert,
  getDictionaryByKeys,
  getParsedBatchById,
  listActiveParserAlerts,
  listDictionary,
  listRecentParsedBatches,
  readCache,
  saveAiEntriesIfNotVerified,
  upsertDictionaryEntry,
  upsertParsedBatch,
  upsertParserAlert,
  writeCache,
  type StoredParsedBatch,
} from './db.ts';
import {
  extractCutFlowersWithAnthropicFallback,
  extractCutFlowersWithWorkersAi,
  judgeParsedCutFlowersWithClef,
  sendParserAlertEmail,
  sendParserAlertWebhook,
  type SendEmailBinding,
  type WorkersAiBinding,
} from './fallbackParser.ts';
import {
  BLOG_RSS_URL,
  TOUCHAKU_URL,
  getJstNow,
  parseBlogRssXml,
  parseTouchakuHtml,
  type ParsedBlogPost,
} from './parser.ts';

export interface Env extends AiEnvConfig {
  DB: D1Database;
  AI?: WorkersAiBinding;
  EMAIL?: SendEmailBinding;
  ASSETS?: Fetcher;
  APP_ENV?: string;
  ALERT_FROM_EMAIL?: string;
  ALERT_TO_EMAIL?: string;
  ALERT_WEBHOOK_URL?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CRON_TRANSLATE_LIMIT = 15;

const ALLOWED_IMAGE_HOSTS = ['bigflower.co.jp', 'www.bigflower.co.jp'];

function isAllowedImageUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_IMAGE_HOSTS.includes(host)) return true;
    if (/^blog-imgs-\d+\.fc2\.com$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * AI trigger HTTP endpoints (/api/admin/*) are STRICTLY disabled in production.
 * In production, AI runs ONLY inside Cloudflare's internal Cron `scheduled()` handler —
 * zero public surface area and zero possibility of header spoofing.
 * Allowed via HTTP ONLY during local development on localhost / 127.0.0.1.
 */
function canAccessAdminAi(c: Context<{ Bindings: Env }>): boolean {
  if (c.env.APP_ENV !== 'local') {
    return false;
  }
  try {
    const host = new URL(c.req.url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs = 12000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; BigflowerTodayBot/1.0; +https://github.com/bigflower-today)',
        Accept: 'text/html,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAndStorePost(
  env: Env,
  post: ParsedBlogPost,
): Promise<StoredParsedBatch> {
  const existing = await getParsedBatchById(env.DB, post.id);
  if (
    existing &&
    existing.contentHash === post.contentFingerprint &&
    existing.parserMode !== 'failed'
  ) {
    return existing;
  }

  let finalItems: CutFlowerRawItem[] = post.rawItems;
  let parserMode: ParserMode = 'rule';
  let needsFallback = post.ruleNeedsFallback;
  let triggerReason = post.fallbackReason || '';

  // Layer 2: Cloudflare Clef 27B decision judge (free tier, 0 output token cost)
  // Catches partial truncation, potted-plant leakage, or wrong-column extraction
  if (!needsFallback && !post.isPottedOnly && post.hasCutFlowers && env.AI) {
    try {
      const verdict = await judgeParsedCutFlowersWithClef(env.AI, post);
      if (!verdict.passed) {
        needsFallback = true;
        triggerReason = verdict.reason;
      }
    } catch (err) {
      // If Clef is temporarily unavailable, trust rule parser rather than failing the batch
      console.error('Clef judge skipped due to error:', err);
    }
  }

  if (needsFallback) {
    let fallbackStatus: 'workers_ai_ok' | 'anthropic_ok' | 'failed' = 'failed';
    let fallbackError = '';

    // 1. Primary fallback: Cloudflare Workers AI free tier (@cf/openai/gpt-oss-120b)
    if (env.AI) {
      try {
        const extracted = await extractCutFlowersWithWorkersAi(
          env.AI,
          post.title,
          post.plainText,
        );
        if (extracted.length > 0) {
          finalItems = extracted;
          parserMode = 'workers_ai';
          fallbackStatus = 'workers_ai_ok';
        }
      } catch (err) {
        fallbackError = `Workers AI: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 2. Secondary fallback (e.g. local dev without remote Workers AI binding)
    if (fallbackStatus === 'failed' && env.ANTHROPIC_API_KEY?.trim()) {
      try {
        const extracted = await extractCutFlowersWithAnthropicFallback(
          env,
          post.title,
          post.plainText,
        );
        if (extracted.length > 0) {
          finalItems = extracted;
          parserMode = 'anthropic';
          fallbackStatus = 'anthropic_ok';
        }
      } catch (err) {
        fallbackError = [
          fallbackError,
          `Anthropic: ${err instanceof Error ? err.message : String(err)}`,
        ]
          .filter(Boolean)
          .join(' | ');
      }
    }

    if (fallbackStatus === 'failed') {
      parserMode = 'failed';
      // If rule parser had zero items and fallback also failed, never overwrite a prior good batch
      if (finalItems.length === 0 && existing && existing.rawItems.length > 0) {
        finalItems = existing.rawItems;
      }
    }

    const reason = fallbackError
      ? `${triggerReason || '硬规则解析失败'}（${fallbackError.slice(0, 160)}）`
      : triggerReason || '硬规则解析异常，疑似博客格式变更';

    const { isNew } = await upsertParserAlert(env.DB, {
      postId: post.id,
      postTitle: post.title,
      postUrl: post.link,
      isoDate: post.isoDate,
      reason,
      fallbackStatus,
      fallbackItemCount: finalItems.length,
      rawExcerpt: post.rawExcerpt,
    });

    if (isNew) {
      await sendParserAlertEmail(env, {
        postTitle: post.title,
        postUrl: post.link,
        isoDate: post.isoDate,
        reason,
        fallbackStatus,
        fallbackItemCount: finalItems.length,
        rawExcerpt: post.rawExcerpt,
      });
      await sendParserAlertWebhook(env.ALERT_WEBHOOK_URL, {
        postTitle: post.title,
        postUrl: post.link,
        reason,
        fallbackStatus,
        fallbackItemCount: finalItems.length,
      });
    }
  }

  return await upsertParsedBatch(env.DB, {
    id: post.id,
    contentHash: post.contentFingerprint,
    title: post.title,
    link: post.link,
    publishedAt: post.publishedAt,
    isoDate: post.isoDate,
    dateLabel: post.dateLabel,
    hasCutFlowers: finalItems.length > 0,
    isPottedOnly: post.isPottedOnly && finalItems.length === 0,
    parserMode,
    rawItems: finalItems,
    images: post.images,
  });
}

async function syncUpstreamData(
  env: Env,
  forceRefresh: boolean,
): Promise<{
  touchaku: TouchakuInfo | null;
  batches: StoredParsedBatch[];
  fetchedAt: string;
  warnings: string[];
}> {
  const warnings: string[] = [];

  let touchakuHtml: string | null = null;
  let rssXml: string | null = null;
  let fetchedAt = new Date().toISOString();

  if (!forceRefresh) {
    const cached = await readCache<{ touchakuHtml: string | null; rssXml: string | null }>(
      env.DB,
      'upstream_snapshot',
      CACHE_TTL_MS,
    );
    if (cached) {
      touchakuHtml = cached.payload.touchakuHtml;
      rssXml = cached.payload.rssXml;
      fetchedAt = cached.fetchedAt;
    }
  }

  const fetchedFresh = touchakuHtml === null && rssXml === null;
  if (fetchedFresh) {
    const [touchakuRes, rssRes] = await Promise.allSettled([
      fetchTextWithTimeout(TOUCHAKU_URL),
      fetchTextWithTimeout(BLOG_RSS_URL),
    ]);

    if (touchakuRes.status === 'fulfilled') {
      touchakuHtml = touchakuRes.value;
    } else {
      warnings.push(`到货时间页抓取失败：${String(touchakuRes.reason)}`);
    }

    if (rssRes.status === 'fulfilled') {
      rssXml = rssRes.value;
    } else {
      warnings.push(`进货博客抓取失败：${String(rssRes.reason)}`);
    }

    if (touchakuHtml !== null || rssXml !== null) {
      fetchedAt = await writeCache(env.DB, 'upstream_snapshot', {
        touchakuHtml,
        rssXml,
      });
    } else {
      const stale = await readCache<{ touchakuHtml: string | null; rssXml: string | null }>(
        env.DB,
        'upstream_snapshot',
        7 * 24 * 60 * 60 * 1000,
      );
      if (stale) {
        touchakuHtml = stale.payload.touchakuHtml;
        rssXml = stale.payload.rssXml;
        fetchedAt = stale.fetchedAt;
        warnings.push('源站暂时无法访问，当前展示的是最近一次缓存数据。');
      }
    }
  }

  const now = new Date();
  const touchaku = touchakuHtml ? parseTouchakuHtml(touchakuHtml, now) : null;

  if (rssXml) {
    const parsedPosts = parseBlogRssXml(rssXml, now);
    for (const post of parsedPosts) {
      await resolveAndStorePost(env, post);
    }
  }

  const batches = await listRecentParsedBatches(env.DB, 15);
  return { touchaku, batches, fetchedAt, warnings };
}

async function translatePendingInBatch(
  env: Env,
  batch: StoredParsedBatch,
  options?: {
    rawKeys?: string[];
    forceRetranslateAi?: boolean;
    limit?: number;
  },
): Promise<TranslateBatchResponse> {
  const provider = detectAiProvider(env);
  if (!provider) {
    return {
      translatedCount: 0,
      skippedVerifiedCount: 0,
      failedCount: 0,
      remainingCount: 0,
      providerLabel: null,
      entries: [],
      error:
        '尚未配置 AI API Key。请在本地 .dev.vars（或 Cloudflare Secrets）中设置 ANTHROPIC_API_KEY。',
    };
  }

  const requestedKeys =
    options?.rawKeys && options.rawKeys.length > 0 ? new Set(options.rawKeys) : null;
  const candidateItems = requestedKeys
    ? batch.rawItems.filter((item) => requestedKeys.has(item.rawKey))
    : batch.rawItems;

  const existingMap = await getDictionaryByKeys(
    env.DB,
    candidateItems.map((i) => i.rawKey),
  );

  let skippedVerifiedCount = 0;
  const allPending = candidateItems.filter((item) => {
    const existing = existingMap.get(item.rawKey);
    if (existing?.status === 'verified') {
      skippedVerifiedCount += 1;
      return false;
    }
    if (existing?.status === 'ai' && !options?.forceRetranslateAi) {
      return false;
    }
    return true;
  });

  if (allPending.length === 0) {
    return {
      translatedCount: 0,
      skippedVerifiedCount,
      failedCount: 0,
      remainingCount: 0,
      providerLabel: provider.label,
      entries: [],
    };
  }

  const chunkLimit = Math.max(1, Math.min(options?.limit ?? 10, 20));
  const toTranslate = allPending.slice(0, chunkLimit);
  const remainingCount = Math.max(0, allPending.length - toTranslate.length);

  const { provider: usedProvider, results } = await translateCutFlowersWithAi(
    env,
    toTranslate.map((item) => ({
      rawKey: item.rawKey,
      rawDisplay: item.rawDisplay,
      fallbackCleanedJa: item.fallbackCleanedJa,
    })),
  );

  const rawDisplayByKey = new Map(
    toTranslate.map((item) => [item.rawKey, item.rawDisplay]),
  );

  const saved = await saveAiEntriesIfNotVerified(
    env.DB,
    results
      .filter((r) => rawDisplayByKey.has(r.rawKey))
      .map((r) => ({
        rawKey: r.rawKey,
        rawSample: rawDisplayByKey.get(r.rawKey) || r.rawKey,
        cleanedJa: r.cleanedJa,
        zhName: r.zhName,
        enName: r.enName,
        category: r.category,
        aiModel: usedProvider.label,
      })),
  );

  return {
    translatedCount: saved.length,
    skippedVerifiedCount,
    failedCount: Math.max(0, toTranslate.length - saved.length),
    remainingCount,
    providerLabel: usedProvider.label,
    entries: saved,
  };
}

function summarizeBatch(batch: StoredParsedBatch): BlogBatchSummary {
  return {
    id: batch.id,
    title: batch.title,
    link: batch.link,
    publishedAt: batch.publishedAt,
    isoDate: batch.isoDate,
    dateLabel: batch.dateLabel,
    hasCutFlowers: batch.hasCutFlowers,
    isPottedOnly: batch.isPottedOnly,
    cutFlowerCount: batch.rawItems.length,
    parserMode: batch.parserMode,
  };
}

function mergeItemsWithDictionary(
  batch: StoredParsedBatch,
  dictMap: Map<string, DictionaryEntry>,
): CutFlowerItem[] {
  return batch.rawItems.map((raw) => {
    const entry = dictMap.get(raw.rawKey);
    const cleanedJa = entry?.cleanedJa || raw.fallbackCleanedJa;
    return {
      rawKey: raw.rawKey,
      rawDisplay: raw.rawDisplay,
      cleanedJa,
      zhName: entry?.zhName || '',
      enName: entry?.enName || '',
      category: entry?.category || '',
      sizes: raw.sizes,
      lotCount: raw.lotCount,
      source: entry ? entry.status : 'untranslated',
      aiModel: entry?.aiModel ?? null,
      confirmedAt: entry?.confirmedAt ?? null,
      googleImageUrl: buildGoogleImageUrl(cleanedJa),
    };
  });
}

function computeTodayStatus(
  todayJst: string,
  touchaku: TouchakuInfo | null,
  batches: StoredParsedBatch[],
): {
  hasTodayCutFlowers: boolean;
  todayStatus: TodayArrivalStatus;
  todayStatusMessage: string;
} {
  const todayPosts = batches.filter((p) => p.isoDate === todayJst);
  const todayCutPost = todayPosts.find((p) => p.hasCutFlowers);
  const todayPottedOnly = todayPosts.some((p) => p.isPottedOnly);

  if (todayCutPost) {
    if (touchaku?.isToday && touchaku.isArrived) {
      return {
        hasTodayCutFlowers: true,
        todayStatus: 'arrived',
        todayStatusMessage: touchaku.arrivalTime
          ? `今日有切花进货（共 ${todayCutPost.rawItems.length} 种），预计 ${touchaku.arrivalTime} 左右已到货`
          : `今日有切花进货（共 ${todayCutPost.rawItems.length} 种），已到货`,
      };
    }
    if (touchaku?.isToday && touchaku.arrivalTime) {
      return {
        hasTodayCutFlowers: true,
        todayStatus: 'scheduled',
        todayStatusMessage: `今日有切花进货（共 ${todayCutPost.rawItems.length} 种），预计 ${touchaku.arrivalTime} 左右到货`,
      };
    }
    return {
      hasTodayCutFlowers: true,
      todayStatus: 'listed',
      todayStatusMessage: `今日切花进货单已发布（共 ${todayCutPost.rawItems.length} 种），请关注到货时间`,
    };
  }

  if (todayPottedOnly) {
    return {
      hasTodayCutFlowers: false,
      todayStatus: 'no_cut_flowers',
      todayStatusMessage: '今日仅发布了鉢花 / 花苗进货，没有切花进货',
    };
  }

  if (touchaku?.isToday) {
    return {
      hasTodayCutFlowers: false,
      todayStatus: 'no_cut_flowers',
      todayStatusMessage: '今日到货通知已更新，但博客暂未发布切花明细',
    };
  }

  return {
    hasTodayCutFlowers: false,
    todayStatus: 'no_cut_flowers',
    todayStatusMessage: touchaku?.nextArrivalText
      ? `今日暂无切花进货（${touchaku.nextArrivalText}）`
      : '今日暂无切花进货信息',
  };
}

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => {
  const provider = detectAiProvider(c.env);
  return c.json({
    ok: true,
    aiConfigured: Boolean(provider),
    canTriggerAi: canAccessAdminAi(c),
    workersAiBound: Boolean(c.env.AI),
    aiProviderLabel: provider?.label ?? null,
    nowJst: getJstNow().nowJst,
  });
});

app.get('/api/arrivals', async (c) => {
  const forceRefresh = c.req.query('refresh') === '1';
  const requestedBatchId = c.req.query('batchId')?.trim() || '';

  const jst = getJstNow();
  const provider = detectAiProvider(c.env);
  const { touchaku, batches, fetchedAt, warnings } = await syncUpstreamData(
    c.env,
    forceRefresh,
  );
  const parserAlerts = await listActiveParserAlerts(c.env.DB);

  const cutFlowerBatches = batches.filter((p) => p.hasCutFlowers);
  let targetBatch: StoredParsedBatch | null = null;

  if (requestedBatchId) {
    targetBatch = cutFlowerBatches.find((p) => p.id === requestedBatchId) ?? null;
  }
  if (!targetBatch) {
    targetBatch =
      cutFlowerBatches.find((p) => p.isoDate === jst.todayJst) ??
      cutFlowerBatches[0] ??
      null;
  }

  let selectedBatch: BlogBatchDetail | null = null;
  const stats = { total: 0, verified: 0, ai: 0, untranslated: 0 };

  if (targetBatch) {
    const dictMap = await getDictionaryByKeys(
      c.env.DB,
      targetBatch.rawItems.map((i) => i.rawKey),
    );
    const items = mergeItemsWithDictionary(targetBatch, dictMap);
    for (const item of items) {
      stats.total += 1;
      if (item.source === 'verified') stats.verified += 1;
      else if (item.source === 'ai') stats.ai += 1;
      else stats.untranslated += 1;
    }

    selectedBatch = {
      ...summarizeBatch(targetBatch),
      images: targetBatch.images,
      items,
    };
  }

  const { hasTodayCutFlowers, todayStatus, todayStatusMessage } =
    computeTodayStatus(jst.todayJst, touchaku, batches);

  const payload: ArrivalResponse = {
    todayJst: jst.todayJst,
    nowJst: jst.nowJst,
    hasTodayCutFlowers,
    todayStatus,
    todayStatusMessage,
    touchaku,
    selectedBatch,
    recentCutFlowerBatches: cutFlowerBatches.slice(0, 8).map(summarizeBatch),
    recentAllBatches: batches.slice(0, 8).map(summarizeBatch),
    stats,
    aiConfigured: Boolean(provider),
    canTriggerAi: canAccessAdminAi(c),
    aiProviderLabel: provider?.label ?? null,
    parserAlerts,
    fetchedAt,
    warnings,
  };

  return c.json(payload);
});

// Protected AI endpoints (local dev or Cloudflare Access only — never exposed publicly)
app.post('/api/admin/translate', async (c) => {
  if (!canAccessAdminAi(c)) {
    return c.json<TranslateBatchResponse>(
      {
        translatedCount: 0,
        skippedVerifiedCount: 0,
        failedCount: 0,
        remainingCount: 0,
        providerLabel: null,
        entries: [],
        error: 'AI 翻译接口不对外公开，线上由后台定时任务自动运行。',
      },
      403,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as TranslateBatchRequest;
  const { batches } = await syncUpstreamData(c.env, false);
  const cutFlowerBatches = batches.filter((p) => p.hasCutFlowers);

  const targetBatch = body.batchId
    ? cutFlowerBatches.find((p) => p.id === body.batchId)
    : cutFlowerBatches[0];

  if (!targetBatch) {
    return c.json<TranslateBatchResponse>(
      {
        translatedCount: 0,
        skippedVerifiedCount: 0,
        failedCount: 0,
        remainingCount: 0,
        providerLabel: detectAiProvider(c.env)?.label ?? null,
        entries: [],
        error: '未找到对应的切花进货批次',
      },
      404,
    );
  }

  try {
    const result = await translatePendingInBatch(c.env, targetBatch, {
      rawKeys: body.rawKeys,
      forceRetranslateAi: body.forceRetranslateAi,
      limit: body.limit,
    });
    if (result.error) {
      return c.json(result, 400);
    }
    return c.json(result);
  } catch (err) {
    return c.json<TranslateBatchResponse>(
      {
        translatedCount: 0,
        skippedVerifiedCount: 0,
        failedCount: 1,
        remainingCount: 0,
        providerLabel: detectAiProvider(c.env)?.label ?? null,
        entries: [],
        error: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
});

app.post('/api/admin/sync', async (c) => {
  if (!canAccessAdminAi(c)) {
    return c.json({ error: '同步触发接口仅限管理员或定时任务使用' }, 403);
  }
  const summary = await runScheduledSyncJob(c.env);
  return c.json(summary);
});

app.post('/api/alerts/dismiss', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { postId?: string } | null;
  if (!body?.postId?.trim()) {
    return c.json({ error: '缺少 postId' }, 400);
  }
  const dismissed = await dismissParserAlert(c.env.DB, body.postId.trim());
  return c.json({ dismissed });
});

// Shared open dictionary endpoints (anyone can help confirm & refine flower names)
app.get('/api/dictionary', async (c) => {
  const statusParam = c.req.query('status') as DictionaryStatus | 'all' | undefined;
  const query = c.req.query('q') || undefined;
  const entries = await listDictionary(c.env.DB, {
    status: statusParam || 'all',
    query,
  });
  return c.json({ entries, total: entries.length });
});

app.put('/api/dictionary', async (c) => {
  const body = (await c.req.json().catch(() => null)) as UpsertDictionaryRequest | null;
  if (!body || !body.rawKey?.trim() || !body.cleanedJa?.trim()) {
    return c.json({ error: 'rawKey 和 cleanedJa 为必填项' }, 400);
  }

  const entry = await upsertDictionaryEntry(c.env.DB, {
    rawKey: body.rawKey.trim().slice(0, 160),
    rawSample: (body.rawSample?.trim() || body.rawKey.trim()).slice(0, 160),
    cleanedJa: body.cleanedJa.trim().slice(0, 160),
    zhName: (body.zhName?.trim() || '').slice(0, 160),
    enName: (body.enName?.trim() || '').slice(0, 160),
    category: (body.category?.trim() || '').slice(0, 60),
    status: body.status || 'verified',
  });

  return c.json({ entry, googleImageUrl: buildGoogleImageUrl(entry.cleanedJa) });
});

app.post('/api/dictionary/confirm', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | Partial<UpsertDictionaryRequest>
    | null;
  if (!body?.rawKey?.trim()) {
    return c.json({ error: '缺少 rawKey' }, 400);
  }

  const rawKey = body.rawKey.trim().slice(0, 160);
  const existing = await confirmDictionaryEntry(c.env.DB, rawKey);
  if (existing) {
    return c.json({
      entry: existing,
      googleImageUrl: buildGoogleImageUrl(existing.cleanedJa),
    });
  }

  if (!body.cleanedJa?.trim()) {
    return c.json({ error: '词典中不存在该条目，请提供 cleanedJa' }, 404);
  }

  const created = await upsertDictionaryEntry(c.env.DB, {
    rawKey,
    rawSample: (body.rawSample?.trim() || rawKey).slice(0, 160),
    cleanedJa: body.cleanedJa.trim().slice(0, 160),
    zhName: (body.zhName?.trim() || '').slice(0, 160),
    enName: (body.enName?.trim() || '').slice(0, 160),
    category: (body.category?.trim() || '').slice(0, 60),
    status: 'verified',
  });

  return c.json({
    entry: created,
    googleImageUrl: buildGoogleImageUrl(created.cleanedJa),
  });
});

app.post('/api/dictionary/import', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    entries?: UpsertDictionaryRequest[];
  } | null;
  if (!body || !Array.isArray(body.entries)) {
    return c.json({ error: '需要 entries 数组' }, 400);
  }

  let imported = 0;
  for (const item of body.entries.slice(0, 2000)) {
    if (!item?.rawKey?.trim() || !item?.cleanedJa?.trim()) continue;
    await upsertDictionaryEntry(c.env.DB, {
      rawKey: item.rawKey.trim().slice(0, 160),
      rawSample: (item.rawSample?.trim() || item.rawKey.trim()).slice(0, 160),
      cleanedJa: item.cleanedJa.trim().slice(0, 160),
      zhName: (item.zhName?.trim() || '').slice(0, 160),
      enName: (item.enName?.trim() || '').slice(0, 160),
      category: (item.category?.trim() || '').slice(0, 60),
      status: item.status || 'verified',
    });
    imported += 1;
  }

  return c.json({ imported });
});

app.delete('/api/dictionary', async (c) => {
  const rawKey =
    c.req.query('rawKey')?.trim() ||
    ((await c.req.json().catch(() => null)) as { rawKey?: string } | null)?.rawKey?.trim();

  if (!rawKey) {
    return c.json({ error: '缺少 rawKey' }, 400);
  }

  const deleted = await deleteDictionaryEntry(c.env.DB, rawKey);
  return c.json({ deleted });
});

app.get('/api/image', async (c) => {
  const targetUrl = c.req.query('url')?.trim();
  if (!targetUrl || !isAllowedImageUrl(targetUrl)) {
    return c.text('Forbidden image host', 403);
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BigflowerTodayBot/1.0)',
        Referer: targetUrl.includes('bigflower.co.jp')
          ? TOUCHAKU_URL
          : 'http://bigflowersugi.blog.fc2.com/',
      },
    });
    if (!upstream.ok) {
      return c.text('Upstream image unavailable', upstream.status as 404);
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return c.text('Invalid image content type', 415);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return c.text('Image proxy error', 502);
  }
});

app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

async function runScheduledSyncJob(env: Env): Promise<{
  syncedAt: string;
  cutFlowerBatchCount: number;
  latestBatchId: string | null;
  translatedCount: number;
  remainingCount: number;
  warnings: string[];
}> {
  const { batches, fetchedAt, warnings } = await syncUpstreamData(env, true);
  const cutBatches = batches.filter((b) => b.hasCutFlowers);
  const latestBatch = cutBatches[0] ?? null;

  let translatedCount = 0;
  let remainingCount = 0;

  if (latestBatch && detectAiProvider(env)) {
    try {
      const res = await translatePendingInBatch(env, latestBatch, {
        forceRetranslateAi: false,
        limit: CRON_TRANSLATE_LIMIT,
      });
      translatedCount = res.translatedCount;
      remainingCount = res.remainingCount;
    } catch (err) {
      warnings.push(
        `定时 AI 翻译失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    syncedAt: fetchedAt,
    cutFlowerBatchCount: cutBatches.length,
    latestBatchId: latestBatch?.id ?? null,
    translatedCount,
    remainingCount,
    warnings,
  };
}

export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      runScheduledSyncJob(env).then((summary) => {
        console.log(JSON.stringify({ event: 'cron_sync_complete', ...summary }));
      }),
    );
  },
};
