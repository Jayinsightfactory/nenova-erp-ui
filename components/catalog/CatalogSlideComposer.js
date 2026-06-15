import { useCallback } from 'react';
import {
  absCatalogUrl,
  catalogLineNames,
  fmtCatalogSalePrice,
} from '../../lib/catalogUtils';
import { formatOriginLabel } from '../../lib/catalogLayout';
import {
  catalogGridCols,
  perPageSlotCount,
} from '../../lib/catalogSlides';

const DND_GROUP = 'application/x-nenova-catalog-group';
const DND_PROD = 'application/x-nenova-catalog-prod';
const DND_LINE = 'application/x-nenova-catalog-line';

export function parseCatalogDragData(e) {
  const group = e.dataTransfer.getData(DND_GROUP);
  if (group) return { type: 'group', groupKey: group };
  const prod = e.dataTransfer.getData(DND_PROD);
  if (prod) return { type: 'prod', prodKey: prod };
  const line = e.dataTransfer.getData(DND_LINE);
  if (line) return { type: 'line', lineId: line };
  const text = e.dataTransfer.getData('text/plain');
  if (text?.startsWith('group:')) return { type: 'group', groupKey: text.slice(6) };
  if (text?.startsWith('prod:')) return { type: 'prod', prodKey: text.slice(5) };
  if (text?.startsWith('line:')) return { type: 'line', lineId: text.slice(5) };
  return null;
}

export function setCatalogDragData(e, payload) {
  e.dataTransfer.effectAllowed = 'copyMove';
  if (payload.type === 'group') {
    e.dataTransfer.setData(DND_GROUP, payload.groupKey);
    e.dataTransfer.setData('text/plain', `group:${payload.groupKey}`);
  } else if (payload.type === 'prod') {
    e.dataTransfer.setData(DND_PROD, payload.prodKey);
    e.dataTransfer.setData('text/plain', `prod:${payload.prodKey}`);
  } else if (payload.type === 'line') {
    e.dataTransfer.setData(DND_LINE, payload.lineId);
    e.dataTransfer.setData('text/plain', `line:${payload.lineId}`);
  }
}

function MiniSlot({
  line,
  slotIndex,
  slideId,
  showNames,
  showPrice,
  onDropSlot,
  onClearSlot,
  onDragLine,
}) {
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDropSlot(slideId, slotIndex, parseCatalogDragData(e));
  };

  if (!line) {
    return (
      <div
        className="composer-slot empty"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        title="품목을 여기로 끌어다 놓으세요"
      >
        <span className="composer-slot-ph">+</span>
      </div>
    );
  }

  const { eng, kor } = catalogLineNames(line);
  const priceLabel = showPrice ? fmtCatalogSalePrice(line) : '';

  return (
    <div
      className="composer-slot filled"
      draggable
      onDragStart={(e) => {
        setCatalogDragData(e, { type: 'line', lineId: line.id });
        onDragLine?.(line.id);
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      title="다른 칸으로 끌어 이동"
    >
      <button
        type="button"
        className="composer-slot-clear"
        onClick={(e) => { e.stopPropagation(); onClearSlot(slideId, slotIndex); }}
        title="칸 비우기"
      >
        ×
      </button>
      <div className="composer-slot-img">
        {line.imageUrl ? (
          <img src={absCatalogUrl(line.imageUrl)} alt="" />
        ) : (
          <span>{eng?.slice(0, 2) || '품'}</span>
        )}
      </div>
      {showNames && (
        <div className="composer-slot-name">
          {eng || kor || line.catalogName || line.prodName}
        </div>
      )}
      {priceLabel ? <div className="composer-slot-price">{priceLabel}</div> : null}
    </div>
  );
}

export default function CatalogSlideComposer({
  perPage,
  onPerPageChange,
  slides,
  linesById,
  showNames,
  showPrice,
  onDropZone,
  onDropSlot,
  onDropAutoSlot,
  onClearSlot,
  onRemoveSlide,
  onAddEmptySlide,
}) {
  const slotCount = perPageSlotCount(perPage);
  const cols = catalogGridCols(perPage);

  const handleDropZone = useCallback((e) => {
    e.preventDefault();
    const data = parseCatalogDragData(e);
    if (data?.type === 'group') onDropZone(data.groupKey);
    else if (data && (data.type === 'prod' || data.type === 'line')) onDropAutoSlot?.(data);
  }, [onDropZone, onDropAutoSlot]);

  const handleDropZoneOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div className="catalog-composer">
      <div className="composer-toolbar">
        <span className="composer-label">PPT 칸 수</span>
        <select
          className="filter-select"
          value={perPage}
          onChange={e => onPerPageChange(Number(e.target.value))}
          title="슬라이드당 품목 칸 수"
        >
          <option value={8}>8칸 (4×2)</option>
          <option value={10}>10칸 (5×2)</option>
        </select>
        <button type="button" className="btn btn-sm" onClick={onAddEmptySlide} title="빈 슬라이드 추가">
          + 슬라이드
        </button>
        <span className="composer-hint">품종을 아래로 끌면 자동 추가 · 품목은 칸에 직접 배치</span>
      </div>

      <div
        className="composer-drop-banner"
        onDragOver={handleDropZoneOver}
        onDrop={handleDropZone}
      >
        <span className="composer-drop-icon">↓</span>
        <span>품종(②) 또는 품목(③)을 여기로 끌어오면 슬라이드에 자동 추가</span>
      </div>

      <div className="composer-slides">
        {!slides.length && (
          <div className="composer-empty">
            품목을 선택한 뒤 품종을 끌어오거나, 품목 카드를 칸에 직접 놓으세요.
          </div>
        )}
        {slides.map((slide, si) => (
          <article key={slide.id} className="composer-slide-card">
            <header className="composer-slide-hdr">
              <div>
                <strong>{slide.titleBig}</strong>
                {slide.titleSmall ? (
                  <span className="composer-origin">{formatOriginLabel(slide.titleSmall)}</span>
                ) : null}
              </div>
              <span className="composer-slide-no">#{si + 1}</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => onRemoveSlide(slide.id)}
                title="슬라이드 삭제"
              >
                삭제
              </button>
            </header>
            <div className="composer-slide-stage">
              <div
                className="composer-grid"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
              >
                {Array.from({ length: slotCount }, (_, idx) => {
                  const lineId = slide.slots?.[idx] ?? null;
                  const line = lineId ? linesById[lineId] : null;
                  return (
                    <MiniSlot
                      key={`${slide.id}-${idx}`}
                      line={line}
                      slotIndex={idx}
                      slideId={slide.id}
                      showNames={showNames}
                      showPrice={showPrice}
                      onDropSlot={onDropSlot}
                      onClearSlot={onClearSlot}
                    />
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>

      <style jsx>{`
        .catalog-composer {
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex: 1;
        }
        .composer-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .composer-label { font-size: 11px; color: var(--text3); }
        .composer-hint { font-size: 10px; color: var(--text3); margin-left: auto; }
        .composer-drop-banner {
          margin: 8px 12px 0;
          padding: 14px 16px;
          min-height: 48px;
          border: 2px dashed var(--blue);
          border-radius: 6px;
          background: var(--blue-bg);
          font-size: 13px;
          text-align: center;
          color: var(--blue);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .composer-drop-icon {
          font-size: 20px;
          font-weight: 700;
          line-height: 1;
        }
        .composer-slides {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .composer-empty {
          padding: 24px 12px;
          text-align: center;
          color: var(--text3);
          font-size: 12px;
        }
        .composer-slide-card {
          border: 1px solid var(--border2);
          border-radius: 6px;
          background: var(--surface);
          overflow: hidden;
        }
        .composer-slide-stage {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          aspect-ratio: 16 / 9;
          max-height: min(52vh, 520px);
          padding: 10px 14px 12px;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
        }
        .composer-slide-hdr {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: var(--header-bg);
          border-bottom: 1px solid var(--border);
          font-size: 12px;
        }
        .composer-slide-hdr strong { font-size: 13px; }
        .composer-origin { margin-left: 6px; font-size: 10px; color: var(--text3); }
        .composer-slide-no { margin-left: auto; font-size: 10px; color: var(--text3); }
        .composer-grid {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-rows: repeat(2, 1fr);
          gap: 6px;
        }
        .composer-slot {
          position: relative;
          border: 1px dashed var(--border2);
          border-radius: 4px;
          min-height: 0;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4px;
          background: #fff;
          overflow: hidden;
        }
        .composer-slot.empty {
          justify-content: center;
          background: var(--header-bg);
        }
        .composer-slot.filled {
          border-style: solid;
          border-color: var(--green);
          cursor: grab;
        }
        .composer-slot-ph { font-size: 22px; color: var(--text3); }
        .composer-slot-clear {
          position: absolute;
          top: 2px;
          right: 2px;
          z-index: 2;
          border: none;
          background: rgba(0,0,0,0.5);
          color: #fff;
          width: 18px;
          height: 18px;
          font-size: 12px;
          line-height: 1;
          cursor: pointer;
          border-radius: 2px;
          padding: 0;
        }
        .composer-slot-img {
          width: min(100%, 72px);
          height: min(55%, 80px);
          flex: 1 1 auto;
          max-height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 1;
        }
        .composer-slot-img img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .composer-slot-img span { font-size: 11px; font-weight: 700; color: #bbb; }
        .composer-slot-name {
          font-size: 10px;
          font-weight: 600;
          line-height: 1.15;
          text-align: center;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          width: 100%;
          flex-shrink: 0;
        }
        .composer-slot-price {
          font-size: 9px;
          font-weight: 700;
          color: var(--red);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

export { DND_GROUP, DND_PROD, DND_LINE };
