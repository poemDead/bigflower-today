import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Flower2,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { buildGoogleImageUrl } from '../shared/googleSearch.ts';
import type {
  ArrivalResponse,
  CutFlowerItem,
  TouchakuImage,
  TranslateBatchResponse,
} from '../shared/types.ts';
import { DictionaryDrawer } from './components/DictionaryDrawer.tsx';
import { EditFlowerModal } from './components/EditFlowerModal.tsx';
import { LightboxModal } from './components/LightboxModal.tsx';
import { usePresence } from './hooks/usePresence.ts';

function formatJstDisplayDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3) return isoDate;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${parts[0]}年${parts[1]}月${parts[2]}日（${weekdays[d.getUTCDay()]}）`;
}

function formatStoreNoteZh(rawNote?: string | null): string | null {
  if (!rawNote) return null;
  const lastLine = rawNote
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  if (!lastLine) return null;
  if (lastLine.includes('明大前') && lastLine.includes('永福') && lastLine.includes('30分')) {
    return '明大前・永福店提前 30 分钟以上';
  }
  return lastLine;
}

function formatNextArrivalZh(rawNext?: string | null): string | null {
  if (!rawNext) return null;
  const match = rawNext.match(/(\d{1,2}月\d{1,2}日)/);
  if (match) return `下次进货 ${match[1]}`;
  return rawNext;
}

function buildHeroCopy(data: ArrivalResponse) {
  const count = data.selectedBatch?.items.length ?? data.stats.total;
  const arrivalTime = data.touchaku?.arrivalTime;

  const stamp =
    data.todayStatus === 'arrived'
      ? '今日已到货'
      : data.todayStatus === 'scheduled'
        ? '预计今日到货'
        : data.todayStatus === 'listed'
          ? '今日清单已出'
          : '今日暂无切花';

  const summary =
    data.todayStatus === 'arrived'
      ? arrivalTime
        ? `环八荻洼 ${arrivalTime} 已到店 · 共 ${count} 种切花`
        : `环八荻洼已到店 · 共 ${count} 种切花`
      : data.todayStatus === 'scheduled'
        ? arrivalTime
          ? `环八荻洼预计 ${arrivalTime} 到店 · 共 ${count} 种切花`
          : `环八荻洼预计今日到店 · 共 ${count} 种切花`
        : data.todayStatus === 'listed'
          ? `今日切花清单已放出 · 共 ${count} 种`
          : '今日暂无切花进货，以下为最近一期清单';

  const metaParts = [
    formatStoreNoteZh(data.touchaku?.storeNote),
    formatNextArrivalZh(data.touchaku?.nextArrivalText),
  ].filter(Boolean) as string[];

  return {
    stamp,
    summary,
    metaLine: metaParts.join(' · '),
  };
}

export function App() {
  const [data, setData] = useState<ArrivalResponse | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [translateProgress, setTranslateProgress] = useState<{
    done: number;
    remaining: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<
    'all' | 'ai' | 'verified' | 'untranslated'
  >('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [editingItem, setEditingItem] = useState<CutFlowerItem | null>(null);
  const [lastEditingItem, setLastEditingItem] = useState<CutFlowerItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [justConfirmedKey, setJustConfirmedKey] = useState<string | null>(null);
  const [showDictionary, setShowDictionary] = useState(false);
  const [lightbox, setLightbox] = useState<{
    images: TouchakuImage[];
    index: number;
  } | null>(null);
  const [lastLightbox, setLastLightbox] = useState<{
    images: TouchakuImage[];
    index: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastToast, setLastToast] = useState<string | null>(null);

  const stopTranslateRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (editingItem) setLastEditingItem(editingItem);
  }, [editingItem]);

  useEffect(() => {
    if (lightbox) setLastLightbox(lightbox);
  }, [lightbox]);

  useEffect(() => {
    if (toast) setLastToast(toast);
  }, [toast]);

  const editPresence = usePresence(Boolean(editingItem), 170);
  const dictPresence = usePresence(showDictionary, 220);
  const lightboxPresence = usePresence(Boolean(lightbox), 170);
  const toastPresence = usePresence(Boolean(toast), 400);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const fetchArrivals = useCallback(
    async (opts?: { batchId?: string; refresh?: boolean; silent?: boolean }) => {
      if (opts?.refresh) {
        setRefreshing(true);
      } else if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams();
        if (opts?.batchId) params.set('batchId', opts.batchId);
        if (opts?.refresh) params.set('refresh', '1');
        const qs = params.toString();
        const res = await fetch(`/api/arrivals${qs ? `?${qs}` : ''}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as ArrivalResponse;
        setData(json);
        if (json.selectedBatch?.id) {
          setSelectedBatchId(json.selectedBatch.id);
        }
        if (opts?.refresh) {
          showToast('已同步最新到货时间与切花清单');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    void fetchArrivals();
  }, [fetchArrivals]);

  const runSingleChunkTranslation = useCallback(
    async (batchId: string, limit = 10) => {
      setTranslating(true);
      try {
        const res = await fetch('/api/admin/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchId,
            forceRetranslateAi: false,
            limit,
          }),
        });
        const json = (await res.json()) as TranslateBatchResponse;
        if (!res.ok) {
          showToast(json.error || 'AI 识别失败');
          return;
        }
        if (json.translatedCount > 0) {
          await fetchArrivals({ batchId, silent: true });
          showToast(
            json.remainingCount > 0
              ? `已识别 ${json.translatedCount} 种，还剩 ${json.remainingCount} 种待识别`
              : `已识别最后 ${json.translatedCount} 种，本批次全部完成`,
          );
        } else {
          showToast('当前批次已全部识别完成');
        }
      } catch {
        showToast('AI 识别请求出错，请检查网络或 API Key');
      } finally {
        setTranslating(false);
      }
    },
    [fetchArrivals, showToast],
  );

  const runContinuousTranslation = useCallback(
    async (batchId: string) => {
      stopTranslateRef.current = false;
      setTranslating(true);
      setTranslateProgress({ done: 0, remaining: data?.stats.untranslated || 0 });
      let totalTranslated = 0;

      try {
        while (!stopTranslateRef.current) {
          const res = await fetch('/api/admin/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              batchId,
              forceRetranslateAi: false,
              limit: 10,
            }),
          });
          const json = (await res.json()) as TranslateBatchResponse;
          if (!res.ok) {
            showToast(json.error || 'AI 识别失败');
            return;
          }
          totalTranslated += json.translatedCount;
          setTranslateProgress({
            done: totalTranslated,
            remaining: json.remainingCount,
          });
          if (json.translatedCount > 0) {
            await fetchArrivals({ batchId, silent: true });
          }
          if (json.remainingCount === 0 || json.translatedCount === 0) {
            break;
          }
        }

        if (stopTranslateRef.current) {
          showToast(`已停止，本轮共识别 ${totalTranslated} 种`);
        } else if (totalTranslated > 0) {
          showToast(`本批次全部识别完成，共 ${totalTranslated} 种`);
        }
      } catch {
        showToast('AI 识别请求出错，请检查网络或 API Key');
      } finally {
        setTranslating(false);
        setTranslateProgress(null);
      }
    },
    [data?.stats.untranslated, fetchArrivals, showToast],
  );

  const handleTranslateSingleItem = async (item: CutFlowerItem) => {
    if (!selectedBatchId) return;
    setTranslatingKey(item.rawKey);
    try {
      const res = await fetch('/api/admin/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: selectedBatchId,
          rawKeys: [item.rawKey],
          forceRetranslateAi: item.source === 'ai',
          limit: 1,
        }),
      });
      const json = (await res.json()) as TranslateBatchResponse;
      if (!res.ok) {
        showToast(json.error || 'AI 识别失败');
        return;
      }
      if (json.translatedCount > 0) {
        showToast(`已识别「${json.entries[0]?.cleanedJa || item.cleanedJa}」`);
        await fetchArrivals({ batchId: selectedBatchId, silent: true });
      }
    } catch {
      showToast('AI 识别请求出错');
    } finally {
      setTranslatingKey(null);
    }
  };

  const handleConfirmItem = async (item: CutFlowerItem) => {
    setConfirmingKey(item.rawKey);
    try {
      const res = await fetch('/api/dictionary/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawKey: item.rawKey,
          rawSample: item.rawDisplay,
          cleanedJa: item.cleanedJa,
          zhName: item.zhName,
          enName: item.enName,
          category: item.category,
        }),
      });
      if (!res.ok) {
        showToast('确认失败，请重试');
        return;
      }
      setJustConfirmedKey(item.rawKey);
      window.setTimeout(() => {
        setJustConfirmedKey((prev) => (prev === item.rawKey ? null : prev));
      }, 450);
      showToast(`已确认「${item.cleanedJa}」并写入永久词典`);
      await fetchArrivals({ batchId: selectedBatchId, silent: true });
    } finally {
      setConfirmingKey(null);
    }
  };

  const handleSaveEdit = async (payload: {
    rawKey: string;
    rawSample: string;
    cleanedJa: string;
    zhName: string;
    enName: string;
    category: string;
  }) => {
    setSavingEdit(true);
    try {
      const res = await fetch('/api/dictionary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, status: 'verified' }),
      });
      if (!res.ok) {
        showToast('保存失败，请检查必填项');
        return;
      }
      setEditingItem(null);
      showToast(`已保存「${payload.cleanedJa}」到词典，以后不再调用 AI`);
      await fetchArrivals({ batchId: selectedBatchId, silent: true });
    } finally {
      setSavingEdit(false);
    }
  };

  const allPhotos = useMemo(() => {
    const photos: TouchakuImage[] = [];
    const seen = new Set<string>();
    const addList = (list?: TouchakuImage[]) => {
      for (const img of list || []) {
        if (seen.has(img.url)) continue;
        seen.add(img.url);
        photos.push(img);
      }
    };
    addList(data?.touchaku?.images);
    addList(data?.selectedBatch?.images);
    return photos;
  }, [data]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.selectedBatch?.items || []) {
      if (!item.category) continue;
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filteredItems = useMemo(() => {
    const items = data?.selectedBatch?.items || [];
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.cleanedJa.toLowerCase().includes(q) ||
        item.rawDisplay.toLowerCase().includes(q) ||
        item.zhName.toLowerCase().includes(q) ||
        item.enName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [data, search, sourceFilter, categoryFilter]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, CutFlowerItem[]>();
    for (const item of filteredItems) {
      const key = item.category || '待归类花材';
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  const hero = useMemo(() => (data ? buildHeroCopy(data) : null), [data]);

  const statusFilters = useMemo(() => {
    if (!data) return [];
    const list: Array<['all' | 'ai' | 'verified' | 'untranslated', string, number]> = [
      ['all', '全部', data.stats.total],
      ['ai', 'AI 待确认', data.stats.ai],
      ['verified', '已收词典', data.stats.verified],
    ];
    if (data.stats.untranslated > 0) {
      list.push(['untranslated', '未翻译', data.stats.untranslated]);
    }
    return list;
  }, [data]);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Flower2 size={15} />
          </div>
          <h1 className="brand-title">大花花进货单</h1>
        </div>

        <nav className="topbar-actions" aria-label="快捷入口">
          <a
            href="https://bigflower.co.jp/touchaku/index.php"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            到货通知
            <ArrowUpRight size={12} />
          </a>
          <a
            href="http://bigflowersugi.blog.fc2.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            进货博客
            <ArrowUpRight size={12} />
          </a>
          <button
            type="button"
            className="nav-link"
            onClick={() => setShowDictionary(true)}
          >
            <BookOpen size={13} />
            花名词典
          </button>
          <button
            type="button"
            className="sync-btn"
            disabled={refreshing}
            onClick={() =>
              void fetchArrivals({ batchId: selectedBatchId, refresh: true })
            }
          >
            <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
            {refreshing ? '同步中' : '同步今日'}
          </button>
        </nav>
      </header>

      {error && (
        <div className="notice-banner error">
          <span>加载进货数据失败：{error}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void fetchArrivals({ refresh: true })}
          >
            重试
          </button>
        </div>
      )}

      {data?.warnings?.map((warn, idx) => (
        <div key={idx} className="notice-banner">
          <span>{warn}</span>
        </div>
      ))}

      {/* Refined Inline Washi Hero */}
      {loading && !data ? (
        <div className="empty-state">正在同步 Big Flower 最新到货时间与切花进货单...</div>
      ) : data && hero ? (
        <>
          <section className="hero-section">
            <div className="hero-copy">
              <div className="hero-title-row">
                <h2 className="hero-date">{formatJstDisplayDate(data.todayJst)}</h2>
                <span className={`status-stamp ${data.todayStatus}`}>{hero.stamp}</span>
              </div>
              <p className="hero-summary tabular">{hero.summary}</p>
              {hero.metaLine && <p className="hero-meta">{hero.metaLine}</p>}
            </div>

            {allPhotos.length > 0 && (
              <div className="photo-strip" aria-label="今日到货实拍">
                {allPhotos.slice(0, 3).map((img, idx) => (
                  <button
                    key={img.url}
                    type="button"
                    className="photo-thumb-btn"
                    onClick={() => setLightbox({ images: allPhotos, index: idx })}
                    title={`查看实拍（${idx + 1}/${allPhotos.length}）`}
                  >
                    <img src={img.proxyUrl} alt={img.filename} loading="lazy" />
                    {idx === 2 && allPhotos.length > 3 && (
                      <span className="photo-more-overlay tabular">
                        +{allPhotos.length - 3}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          {!data.aiConfigured && data.canTriggerAi && (
            <div className="notice-banner info">
              <div>
                <strong>当前未配置 Anthropic API Key：</strong>
                现在已展示基础清洗的日文切花名，可直接搜图或点编辑图标录入词典。
                配置 <code>ANTHROPIC_API_KEY</code> 到 <code>.dev.vars</code> 并重启后即可用{' '}
                <code>claude-haiku-5-5</code> 自动清洗花名并补全中英文。
              </div>
            </div>
          )}

          {!data.hasTodayCutFlowers &&
            data.selectedBatch &&
            data.selectedBatch.isoDate !== data.todayJst && (
              <div className="notice-banner">
                <span>
                  今天（{data.todayJst}）暂无切花进货单，下方为最近一期切花进货：
                  <strong>
                    {data.selectedBatch.dateLabel} · {data.selectedBatch.title}
                  </strong>
                </span>
              </div>
            )}

          {/* Sticky Unified Controls */}
          <div className="sticky-controls">
            <div className="batch-bar">
              <div className="batch-tabs" role="tablist" aria-label="进货期数">
                {data.recentCutFlowerBatches.map((batch) => {
                  const active = data.selectedBatch?.id === batch.id;
                  return (
                    <button
                      key={batch.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`batch-tab ${active ? 'active' : ''}`}
                      onClick={() => {
                        setCategoryFilter('all');
                        void fetchArrivals({ batchId: batch.id });
                      }}
                    >
                      {batch.dateLabel}
                      {batch.isoDate === data.todayJst ? '（今）' : ''}
                      <span className="batch-count tabular">{batch.cutFlowerCount}</span>
                    </button>
                  );
                })}
              </div>

              {data.aiConfigured &&
                data.canTriggerAi &&
                data.selectedBatch &&
                data.stats.untranslated > 0 && (
                  <div className="ai-controls">
                    <button
                      type="button"
                      className="ai-action-btn"
                      disabled={translating}
                      onClick={() =>
                        void runSingleChunkTranslation(data.selectedBatch!.id, 10)
                      }
                    >
                      <Sparkles size={13} className={translating ? 'spin' : ''} />
                      <span className="tabular">
                        {translating
                          ? translateProgress
                            ? `翻译中（已出 ${translateProgress.done}，剩 ${translateProgress.remaining}）`
                            : 'AI 翻译中...'
                          : data.stats.untranslated <= 10
                            ? `AI 翻译剩余 ${data.stats.untranslated} 种`
                            : `AI 翻译下 10 种（剩 ${data.stats.untranslated}）`}
                      </span>
                    </button>

                    {!translating && data.stats.untranslated > 10 && (
                      <button
                        type="button"
                        className="ai-secondary-btn"
                        onClick={() =>
                          void runContinuousTranslation(data.selectedBatch!.id)
                        }
                        title="每 10 种一批连续识别，可随时点击停止"
                      >
                        连续分批
                      </button>
                    )}

                    {translating && translateProgress && (
                      <button
                        type="button"
                        className="ai-stop-btn"
                        onClick={() => {
                          stopTranslateRef.current = true;
                        }}
                      >
                        停止
                      </button>
                    )}
                  </div>
                )}
            </div>

            <div className="tools-row">
              <div className="search-wrap">
                <Search size={14} className="search-icon" />
                <input
                  className="search-input"
                  type="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="找一种花：蓝冰柏、バラ、Ranunculus..."
                />
                {search && (
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => setSearch('')}
                    aria-label="清空搜索"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="filter-group" role="group" aria-label="状态筛选">
                {statusFilters.map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    className={`filter-btn ${sourceFilter === key ? 'active' : ''}`}
                    onClick={() => setSourceFilter(key)}
                  >
                    {label}
                    <span className="tabular">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            {categories.length > 0 && (
              <div className="cat-rail">
                <button
                  type="button"
                  className={`cat-chip ${categoryFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('all')}
                >
                  全部品类
                </button>
                {categories.map(([cat, count]) => (
                  <button
                    key={cat}
                    type="button"
                    className={`cat-chip ${categoryFilter === cat ? 'active' : ''}`}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat.split('・')[1] || cat}
                    <span className="tabular">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category-Grouped Washi Sheet */}
          <main className="flower-sheet">
            {groupedByCategory.length === 0 ? (
              <div className="empty-state">这一期里暂时没找到对应的花材</div>
            ) : (
              groupedByCategory.map(([catName, items]) => (
                <section key={catName} className="flower-group">
                  <header className="group-head">
                    <h3 className="group-title">{catName}</h3>
                    <span className="group-count tabular">{items.length} 种</span>
                  </header>

                  <ul className="flower-list">
                    {items.map((item) => {
                      const isAi = item.source === 'ai';
                      const isVerified = item.source === 'verified';
                      const isUntranslated = item.source === 'untranslated';
                      const zhSearchUrl = item.zhName
                        ? buildGoogleImageUrl(item.zhName)
                        : null;

                      return (
                        <li key={item.rawKey} className="flower-row">
                          <button
                            type="button"
                            className={`check-circle ${item.source}`}
                            data-just-confirmed={
                              isVerified && justConfirmedKey === item.rawKey
                                ? ''
                                : undefined
                            }
                            disabled={
                              isVerified ||
                              confirmingKey === item.rawKey ||
                              translatingKey === item.rawKey
                            }
                            onClick={() => {
                              if (isAi) void handleConfirmItem(item);
                              else if (
                                isUntranslated &&
                                data.aiConfigured &&
                                data.canTriggerAi
                              ) {
                                void handleTranslateSingleItem(item);
                              } else {
                                setEditingItem(item);
                              }
                            }}
                            title={
                              isVerified
                                ? '已收入永久词典'
                                : isAi
                                  ? '点击确认并收入词典'
                                  : data.aiConfigured && data.canTriggerAi
                                    ? '点击用 AI 翻译'
                                    : '点击编辑并录入词典'
                            }
                            aria-label={
                              isVerified
                                ? `${item.cleanedJa} 已收入词典`
                                : isAi
                                  ? `确认 ${item.cleanedJa} 收入词典`
                                  : `翻译 ${item.cleanedJa}`
                            }
                          >
                            {isVerified && (
                              <Check
                                key="verified"
                                size={11}
                                strokeWidth={2.8}
                                className="check-icon"
                              />
                            )}
                            {isAi && <Check key="ai" size={11} strokeWidth={2.4} />}
                            {isUntranslated && (
                              <Sparkles
                                size={10}
                                className={
                                  translatingKey === item.rawKey ? 'spin' : ''
                                }
                              />
                            )}
                          </button>

                          <div className="flower-main">
                            <div className="flower-name-line">
                              <a
                                href={item.googleImageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ja-search-link"
                                title={`用日文「${item.cleanedJa}」去 Google 搜图`}
                              >
                                <span>{item.cleanedJa}</span>
                                <ArrowUpRight size={12} className="search-arrow" />
                              </a>

                              {item.zhName && zhSearchUrl && (
                                <a
                                  href={zhSearchUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="zh-search-link"
                                  title={`用中文「${item.zhName}」去 Google 搜图`}
                                >
                                  <span>{item.zhName}</span>
                                  <ArrowUpRight size={11} className="search-arrow" />
                                </a>
                              )}

                              {(item.lotCount > 1 || item.sizes.length > 0) && (
                                <div className="spec-tags">
                                  {item.lotCount > 1 && (
                                    <span className="spec-tag spec-tag-lot tabular">
                                      ×{item.lotCount} 批
                                    </span>
                                  )}
                                  {item.sizes.map((sz) => (
                                    <span
                                      key={sz}
                                      className="spec-tag spec-tag-size tabular"
                                    >
                                      {sz}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {(item.enName || isUntranslated) && (
                              <div className="flower-sub-line">
                                {item.enName ? (
                                  <span className="flower-en">{item.enName}</span>
                                ) : (
                                  <span className="flower-placeholder">
                                    {translating ? 'AI 正在翻译中...' : '暂未翻译中英文'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flower-actions">
                            {isUntranslated && data.aiConfigured && data.canTriggerAi && (
                              <button
                                type="button"
                                className="row-translate-btn"
                                disabled={translatingKey === item.rawKey || translating}
                                onClick={() => void handleTranslateSingleItem(item)}
                              >
                                {translatingKey === item.rawKey ? '翻译中' : '翻译'}
                              </button>
                            )}

                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => setEditingItem(item)}
                              title="修改花名并写入词典"
                              aria-label={`修改 ${item.cleanedJa}`}
                            >
                              <Pencil size={13} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </main>
        </>
      ) : null}

      {editPresence.mounted && lastEditingItem && (
        <EditFlowerModal
          key={lastEditingItem.rawKey}
          item={lastEditingItem}
          saving={savingEdit}
          closing={editPresence.closing}
          onClose={() => setEditingItem(null)}
          onSave={handleSaveEdit}
        />
      )}

      {dictPresence.mounted && (
        <DictionaryDrawer
          closing={dictPresence.closing}
          onClose={() => setShowDictionary(false)}
          onChanged={() =>
            void fetchArrivals({ batchId: selectedBatchId, silent: true })
          }
          onNotify={showToast}
        />
      )}

      {lightboxPresence.mounted && lastLightbox && (
        <LightboxModal
          images={lastLightbox.images}
          index={lastLightbox.index}
          closing={lightboxPresence.closing}
          onChangeIndex={(nextIndex) =>
            setLightbox((prev) => (prev ? { ...prev, index: nextIndex } : null))
          }
          onClose={() => setLightbox(null)}
        />
      )}

      {toastPresence.mounted && lastToast && (
        <div
          className="toast"
          data-closing={toastPresence.closing ? '' : undefined}
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={15} style={{ color: '#8cc08e' }} />
          <span>{lastToast}</span>
        </div>
      )}
    </div>
  );
}
