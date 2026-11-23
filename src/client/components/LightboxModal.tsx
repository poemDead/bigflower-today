import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import type { TouchakuImage } from '../../shared/types.ts';

interface LightboxModalProps {
  images: TouchakuImage[];
  index: number;
  closing?: boolean;
  onChangeIndex: (nextIndex: number) => void;
  onClose: () => void;
}

export function LightboxModal({
  images,
  index,
  closing = false,
  onChangeIndex,
  onClose,
}: LightboxModalProps) {
  const current = images[index];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') {
        onChangeIndex((index - 1 + images.length) % images.length);
      }
      if (e.key === 'ArrowRight') {
        onChangeIndex((index + 1) % images.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [images.length, index, onChangeIndex, onClose]);

  if (!current) return null;

  return (
    <div
      className="backdrop"
      data-closing={closing ? '' : undefined}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={current.proxyUrl}
          alt={current.filename}
          className="lightbox-img"
        />

        <div className="lightbox-bar">
          {images.length > 1 && (
            <button
              type="button"
              className="lightbox-btn"
              onClick={() => onChangeIndex((index - 1 + images.length) % images.length)}
            >
              <ChevronLeft size={15} />
              上一张
            </button>
          )}
          <span className="tabular" style={{ padding: '0 6px', opacity: 0.85 }}>
            {index + 1} / {images.length}
          </span>
          {images.length > 1 && (
            <button
              type="button"
              className="lightbox-btn"
              onClick={() => onChangeIndex((index + 1) % images.length)}
            >
              下一张
              <ChevronRight size={15} />
            </button>
          )}
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="lightbox-btn"
          >
            <ExternalLink size={13} />
            原图
          </a>
          <button type="button" className="lightbox-btn" onClick={onClose}>
            <X size={15} />
            关闭
          </button>
        </div>

        {images.length > 1 && (
          <div className="lightbox-strip">
            {images.map((img, idx) => (
              <button
                key={img.url}
                type="button"
                className={`lightbox-strip-thumb ${idx === index ? 'active' : ''}`}
                onClick={() => onChangeIndex(idx)}
              >
                <img src={img.proxyUrl} alt={`缩略图 ${idx + 1}`} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
