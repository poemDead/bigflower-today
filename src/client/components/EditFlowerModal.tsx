import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Save, X } from 'lucide-react';
import { buildGoogleImageUrl } from '../../shared/googleSearch.ts';
import type { CutFlowerItem } from '../../shared/types.ts';

const CATEGORIES = [
  '',
  'バラ・玫瑰',
  'ラン・兰花',
  'ユリ・百合',
  'キク・菊类',
  'カーネーション・康乃馨',
  '実もの・果枝',
  'グリーン・叶材枝材',
  '草花・其他切花',
];

interface EditFlowerModalProps {
  item: CutFlowerItem;
  saving: boolean;
  closing?: boolean;
  onClose: () => void;
  onSave: (payload: {
    rawKey: string;
    rawSample: string;
    cleanedJa: string;
    zhName: string;
    enName: string;
    category: string;
  }) => Promise<void>;
}

export function EditFlowerModal({
  item,
  saving,
  closing = false,
  onClose,
  onSave,
}: EditFlowerModalProps) {
  const [cleanedJa, setCleanedJa] = useState(item.cleanedJa);
  const [zhName, setZhName] = useState(item.zhName);
  const [enName, setEnName] = useState(item.enName);
  const [category, setCategory] = useState(item.category);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const previewSearchUrl = buildGoogleImageUrl(cleanedJa || item.cleanedJa);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cleanedJa.trim()) return;
    await onSave({
      rawKey: item.rawKey,
      rawSample: item.rawDisplay,
      cleanedJa: cleanedJa.trim(),
      zhName: zhName.trim(),
      enName: enName.trim(),
      category: category.trim(),
    });
  };

  return (
    <div
      className="backdrop"
      data-closing={closing ? '' : undefined}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">编辑花名并写入词典</h2>
            <p className="modal-subtitle">保存后永久复用词典，后续同品种不再重复调用 AI</p>
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

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="meta-box">
              <div className="meta-box-label">博客原始文本（匹配键：{item.rawKey}）</div>
              <div className="meta-box-value">{item.rawDisplay}</div>
            </div>

            <div className="field">
              <label htmlFor="cleanedJa">清理后的日文花名（用于展示与 Google 搜图）</label>
              <input
                id="cleanedJa"
                type="text"
                value={cleanedJa}
                onChange={(e) => setCleanedJa(e.target.value)}
                required
                placeholder="例如：アリゾナイトスギ ブルーアイス"
              />
            </div>

            <div className="field">
              <label htmlFor="zhName">中文名</label>
              <input
                id="zhName"
                type="text"
                value={zhName}
                onChange={(e) => setZhName(e.target.value)}
                placeholder="例如：蓝冰柏"
              />
            </div>

            <div className="field">
              <label htmlFor="enName">英文名</label>
              <input
                id="enName"
                type="text"
                value={enName}
                onChange={(e) => setEnName(e.target.value)}
                placeholder="例如：Arizona Cypress 'Blue Ice'"
              />
            </div>

            <div className="field">
              <label htmlFor="category">切花分类（可选）</label>
              <select
                id="category"
                value={CATEGORIES.includes(category) ? category : ''}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">不指定分类</option>
                {CATEGORIES.filter(Boolean).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <a
              href={previewSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm"
            >
              <ExternalLink size={14} />
              测试日文搜图
            </a>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={saving || !cleanedJa.trim()}
              >
                <Save size={14} />
                {saving ? '保存中...' : '保存并写入词典'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
