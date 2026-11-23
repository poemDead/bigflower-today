import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { DictionaryEntry } from '../../shared/types.ts';

interface DictionaryDrawerProps {
  closing?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (msg: string) => void;
}

const HOLD_DELETE_MS = 1500;

export function DictionaryDrawer({
  closing = false,
  onClose,
  onChanged,
  onNotify,
}: DictionaryDrawerProps) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'ai'>('all');
  const [query, setQuery] = useState('');
  const [holdingKey, setHoldingKey] = useState<string | null>(null);
  const [armedDeleteKey, setArmedDeleteKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const armedTimerRef = useRef<number | null>(null);

  const clearHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldingKey(null);
  };

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
      if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const loadEntries = async (status: 'all' | 'verified' | 'ai', q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/dictionary?${params.toString()}`);
      const data = (await res.json()) as { entries: DictionaryEntry[] };
      setEntries(data.entries || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadEntries(statusFilter, query);
    }, 150);
    return () => clearTimeout(timer);
  }, [statusFilter, query]);

  const handleConfirm = async (rawKey: string) => {
    const res = await fetch('/api/dictionary/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawKey }),
    });
    if (res.ok) {
      onNotify('已确认并锁定为永久词典条目');
      await loadEntries(statusFilter, query);
      onChanged();
    }
  };

  const handleDelete = async (rawKey: string) => {
    const res = await fetch(`/api/dictionary?rawKey=${encodeURIComponent(rawKey)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      onNotify('已从词典中删除该条目');
      await loadEntries(statusFilter, query);
      onChanged();
    }
  };

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const startHoldDelete = (rawKey: string) => {
    if (holdingKey) return;
    if (prefersReducedMotion()) {
      if (armedDeleteKey === rawKey) {
        if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current);
        setArmedDeleteKey(null);
        void handleDelete(rawKey);
      } else {
        setArmedDeleteKey(rawKey);
        if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current);
        armedTimerRef.current = window.setTimeout(() => {
          setArmedDeleteKey((prev) => (prev === rawKey ? null : prev));
        }, 3000);
      }
      return;
    }

    setHoldingKey(rawKey);
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      setHoldingKey(null);
      void handleDelete(rawKey);
    }, HOLD_DELETE_MS);
  };

  const handleExport = () => {
    const verifiedOnly = entries.filter((e) => e.status === 'verified');
    const dataToExport = verifiedOnly.length > 0 ? verifiedOnly : entries;
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bigflower-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`已导出 ${dataToExport.length} 条词典记录`);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed as { entries?: unknown[] })?.entries;
      if (!Array.isArray(list)) {
        onNotify('导入失败：JSON 格式应为词典数组');
        return;
      }
      const res = await fetch('/api/dictionary/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: list }),
      });
      const data = (await res.json()) as { imported?: number; error?: string };
      if (!res.ok) {
        onNotify(data.error || '导入失败');
        return;
      }
      onNotify(`成功导入 ${data.imported ?? 0} 条词典记录`);
      await loadEntries(statusFilter, query);
      onChanged();
    } catch {
      onNotify('导入失败：无法解析 JSON 文件');
    }
  };

  return (
    <div
      className="backdrop backdrop-end"
      data-closing={closing ? '' : undefined}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title tabular">花名词典（{entries.length}）</h2>
            <p className="modal-subtitle">已确认词条永久复用，不再重复调用 AI</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="tools-row">
            <div className="search-wrap">
              <Search size={14} className="search-icon" />
              <input
                className="search-input"
                type="search"
                enterKeyHint="search"
                autoCapitalize="none"
                autoCorrect="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索日文、中文、英文或原始花名..."
              />
            </div>

            <div className="filter-group">
              {(['all', 'verified', 'ai'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`filter-btn ${statusFilter === st ? 'active' : ''}`}
                  onClick={() => setStatusFilter(st)}
                >
                  {st === 'all' ? '全部' : st === 'verified' ? '已确认' : 'AI 缓存'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="empty-state">加载词典中...</div>
          ) : entries.length === 0 ? (
            <div className="empty-state">
              暂无词典记录。点击主列表中任意花材的左侧圆圈或编辑图标即可沉淀到词典。
            </div>
          ) : (
            <div className="dict-list">
              {entries.map((entry) => (
                <div key={entry.rawKey} className="dict-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="dict-ja">{entry.cleanedJa}</span>
                      {entry.status === 'verified' ? (
                        <span className="dict-badge-verified">
                          <CheckCircle2 size={12} /> 已确认
                        </span>
                      ) : (
                        <span className="dict-badge-ai">
                          <Sparkles size={12} /> AI
                        </span>
                      )}
                      {entry.category && (
                        <span className="spec-tag spec-tag-size">{entry.category}</span>
                      )}
                    </div>
                    {(entry.zhName || entry.enName) && (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 12.5,
                          color: 'var(--ink-secondary)',
                        }}
                      >
                        {entry.zhName}
                        {entry.zhName && entry.enName ? ' · ' : ''}
                        <span style={{ color: 'var(--ink-muted)' }}>{entry.enName}</span>
                      </div>
                    )}
                    <div className="dict-raw">原: {entry.rawSample}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {entry.status === 'ai' && (
                      <button
                        type="button"
                        className="btn btn-soft-moss btn-sm"
                        onClick={() => void handleConfirm(entry.rawKey)}
                      >
                        确认
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger btn-sm hold-delete-btn"
                      data-holding={holdingKey === entry.rawKey ? '' : undefined}
                      data-armed={armedDeleteKey === entry.rawKey ? '' : undefined}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return;
                        startHoldDelete(entry.rawKey);
                      }}
                      onPointerUp={clearHold}
                      onPointerLeave={clearHold}
                      onPointerCancel={clearHold}
                      onKeyDown={(e) => {
                        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                          e.preventDefault();
                          startHoldDelete(entry.rawKey);
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          clearHold();
                        }
                      }}
                      onBlur={clearHold}
                      onContextMenu={(e) => e.preventDefault()}
                      title="按住 1.5 秒删除该条目（防止误删）"
                      aria-label={`按住删除 ${entry.cleanedJa}`}
                    >
                      <span className="hold-delete-base">
                        <Trash2 size={12} />
                        {armedDeleteKey === entry.rawKey ? '再点确认' : '按住删'}
                      </span>
                      <span className="hold-delete-overlay" aria-hidden="true">
                        <Trash2 size={12} />
                        {armedDeleteKey === entry.rawKey ? '再点确认' : '按住删'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={handleExport}>
              <Download size={14} />
              导出 JSON
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} />
              导入 JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = '';
              }}
            />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
