import { useCallback, useEffect, useState } from 'react';
import CatalogImageCropEditor from './CatalogImageCropEditor';
import { catalogImageStyle } from '../../lib/catalogImagePosition';
import {
  absCatalogUrl,
  catalogLineNames,
} from '../../lib/catalogUtils';
import { buildCatalogCellLines, hasCatalogCellText } from '../../lib/catalogLineText';
import { formatOriginLabel, normalizeOriginInput } from '../../lib/catalogLayout';
import {
  catalogGridCols,
  perPageSlotCount,
  SLIDE_TARGET_AUTO,
  SLIDE_TARGET_NEW,
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
  catalogFields,
  selectedLineId,
  cropLineId,
  onToggleCropLine,
  onSaveLineCrop,
  onDropSlot,
  onClearSlot,
  onDragLine,
  onSelectLine,
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

  const { eng } = catalogLineNames(line);
  const cellLines = buildCatalogCellLines(line, catalogFields);

  return (
    <div
      className={`composer-slot filled ${selectedLineId === line.id ? 'selected' : ''}`}
      draggable
      onClick={() => onSelectLine?.(line.id)}
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
        <div
          className="composer-slot-img-frame"
          onClick={(e) => {
            e.stopPropagation();
            onSelectLine?.(line.id);
            if (line.imageUrl) onToggleCropLine?.(cropLineId === line.id ? null : line.id);
          }}
          title="클릭 → 위치/확대 편집"
        >
          {line.imageUrl ? (
            <img src={absCatalogUrl(line.imageUrl)} alt="" style={catalogImageStyle(line)} />
          ) : (
            <span>{eng?.slice(0, 2) || '품'}</span>
          )}
        </div>
      </div>
      {cropLineId === line.id && line.imageUrl ? (
        <div className="composer-slot-crop" onClick={e => e.stopPropagation()}>
          <CatalogImageCropEditor
            compact
            imageUrl={line.imageUrl}
            source={line}
            onSave={transform => onSaveLineCrop?.(line, transform)}
            onClose={() => onToggleCropLine?.(null)}
          />
        </div>
      ) : null}
      <div className="composer-slot-text">
        {cellLines.map(row => (
          <div
            key={row.kind}
            className={row.kind === 'price' ? 'composer-slot-price' : row.kind.startsWith('extra') ? 'composer-slot-extra' : 'composer-slot-name'}
          >
            {row.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CatalogSlideComposer({
  perPage,
  onPerPageChange,
  slides,
  linesById,
  catalogFields,
  onDropZone,
  onDropSlot,
  onDropAutoSlot,
  onClearSlot,
  onRemoveSlide,
  onAddEmptySlide,
  onUpdateSlide,
  onSelectLine,
  selectedLineId,
  cropLineId,
  onToggleCropLine,
  onSaveLineCrop,
  activeSlideTarget,
  onSelectSlideTarget,
  editorOpen = true,
}) {
  const slotCount = perPageSlotCount(perPage);
  const cols = catalogGridCols(perPage);

  const [expandedSlideId, setExpandedSlideId] = useState(null);

  useEffect(() => {
    if (!slides.length) {
      setExpandedSlideId(null);
      return;
    }
    const targetIsSlide = activeSlideTarget
      && activeSlideTarget !== SLIDE_TARGET_AUTO
      && activeSlideTarget !== SLIDE_TARGET_NEW
      && slides.some(s => s.id === activeSlideTarget);
    if (targetIsSlide) {
      setExpandedSlideId(activeSlideTarget);
      return;
    }
    setExpandedSlideId(prev => (
      prev && slides.some(s => s.id === prev) ? prev : slides[slides.length - 1].id
    ));
  }, [slides, activeSlideTarget]);

  const toggleSlideExpanded = useCallback((slideId, e) => {
    e?.stopPropagation();
    setExpandedSlideId(prev => (prev === slideId ? null : slideId));
  }, []);

  const focusSlide = useCallback((slideId) => {
    setExpandedSlideId(slideId);
    onSelectSlideTarget?.(slideId);
  }, [onSelectSlideTarget]);

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
        <span className="composer-label">추가 대상</span>
        <select
          className="filter-select"
          value={activeSlideTarget || SLIDE_TARGET_AUTO}
          onChange={e => onSelectSlideTarget?.(e.target.value)}
          title="품종/품목 드롭 시 넣을 슬라이드"
        >
          <option value={SLIDE_TARGET_AUTO}>자동(빈 칸)</option>
          <option value={SLIDE_TARGET_NEW}>+ 새 슬라이드</option>
          {slides.map((sl, i) => (
            <option key={sl.id} value={sl.id}>
              슬라이드 {i + 1} — {sl.titleBig}
            </option>
          ))}
        </select>
        <span className="composer-hint">▶ 접기/펼치기 · 헤더 클릭 → 대상 지정 · 품목은 칸에 직접 배치</span>
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
        {slides.map((slide, si) => {
          const isTarget = activeSlideTarget === slide.id;
          const isExpanded = expandedSlideId === slide.id;
          return (
          <article
            key={slide.id}
            className={`composer-slide-card ${isTarget ? 'target-slide' : ''} ${isExpanded ? 'expanded' : 'collapsed'}`}
          >
            <header
              className="composer-slide-hdr"
              onClick={() => focusSlide(slide.id)}
              title="클릭 → 펼치기 + 추가 대상 지정"
            >
              <button
                type="button"
                className="composer-slide-toggle"
                onClick={(e) => toggleSlideExpanded(slide.id, e)}
                title={isExpanded ? '접기' : '펼치기'}
                aria-expanded={isExpanded}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
              <div className="composer-slide-titles">
                <strong>{slide.titleBig}</strong>
                {slide.titleSmall ? (
                  <span className="composer-origin">{formatOriginLabel(slide.titleSmall)}</span>
                ) : null}
                {isTarget ? <span className="composer-target-badge">← 추가 대상</span> : null}
              </div>
              <span className="composer-slide-no">#{si + 1}</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={(e) => { e.stopPropagation(); onRemoveSlide(slide.id); }}
                title="슬라이드 삭제"
              >
                삭제
              </button>
            </header>
            {isExpanded ? (
            <div className={`composer-slide-stage ${editorOpen ? 'with-editor' : 'full'}`}>
              <div
                className="composer-slide-meta"
                onClick={(e) => e.stopPropagation()}
              >
                <label className="composer-meta-field">
                  <span>품종</span>
                  <input
                    type="text"
                    className="form-control"
                    value={slide.titleBig || ''}
                    placeholder="카네이션"
                    onChange={(e) => onUpdateSlide?.(slide.id, { titleBig: e.target.value })}
                  />
                </label>
                <label className="composer-meta-field">
                  <span>원산지</span>
                  <input
                    type="text"
                    className="form-control"
                    value={slide.titleSmall || ''}
                    placeholder="콜롬비아"
                    onChange={(e) => onUpdateSlide?.(slide.id, {
                      titleSmall: normalizeOriginInput(e.target.value),
                    })}
                  />
                </label>
                <img className="composer-slide-logo" src="/nenova-logo.png" alt="NENOVA" />
              </div>
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
                    catalogFields={catalogFields}
                    selectedLineId={selectedLineId}
                    cropLineId={cropLineId}
                    onToggleCropLine={onToggleCropLine}
                    onSaveLineCrop={onSaveLineCrop}
                    onDropSlot={onDropSlot}
                    onClearSlot={onClearSlot}
                    onSelectLine={onSelectLine}
                  />
                  );
                })}
              </div>
            </div>
            ) : (
              <div className="composer-slide-collapsed-hint">
                {(slide.slots || []).filter(Boolean).length}칸 배치됨 · ▶ 클릭하여 펼치기
              </div>
            )}
          </article>
          );
        })}
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
        .composer-slide-card.target-slide {
          border-color: var(--blue);
          box-shadow: 0 0 0 2px var(--blue-bg);
        }
        .composer-slide-hdr { cursor: pointer; }
        .composer-target-badge {
          margin-left: 8px;
          font-size: 10px;
          font-weight: 700;
          color: var(--blue);
        }
        .composer-slide-card.collapsed {
          flex-shrink: 0;
        }
        .composer-slide-card.expanded {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .composer-slide-toggle {
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 11px;
          color: var(--text3);
          padding: 0 4px;
          line-height: 1;
          flex-shrink: 0;
        }
        .composer-slide-titles {
          min-width: 0;
          flex: 1;
        }
        .composer-slide-hdr .btn-danger {
          margin-left: auto;
          flex-shrink: 0;
        }
        .composer-slide-collapsed-hint {
          padding: 4px 10px 8px 28px;
          font-size: 10px;
          color: var(--text3);
          background: var(--header-bg);
          border-top: 1px solid var(--border);
        }
        .composer-slide-stage {
          width: 100%;
          max-width: none;
          margin: 0 auto;
          aspect-ratio: 16 / 9;
          padding: 6px 10px 10px;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .composer-slide-meta {
          flex-shrink: 0;
          display: flex;
          align-items: flex-end;
          gap: 8px;
          padding: 2px 0 6px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 4px;
        }
        .composer-meta-field {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .composer-meta-field span {
          font-size: 9px;
          color: var(--text3);
          font-weight: 600;
        }
        .composer-meta-field :global(.form-control) {
          font-size: 12px;
          font-weight: 700;
          color: #000;
          padding: 2px 6px;
          height: 26px;
        }
        .composer-meta-field:first-child {
          flex: 1;
          max-width: 140px;
        }
        .composer-meta-field:nth-child(2) {
          flex: 1;
          max-width: 160px;
        }
        .composer-slide-logo {
          margin-left: auto;
          height: 36px;
          width: auto;
          max-width: 100px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .composer-slide-stage.full {
          max-height: min(calc(100vh - 180px), 720px);
        }
        .composer-slide-stage.with-editor {
          max-height: min(calc(100vh - 320px), 640px);
        }
        .composer-slide-card.expanded .composer-slide-stage {
          flex: 1;
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
        .composer-slide-no { font-size: 10px; color: var(--text3); flex-shrink: 0; }
        .composer-grid {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-rows: repeat(2, minmax(0, 1fr));
          column-gap: 4px;
          row-gap: 4px;
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
          padding: 2px 2px 3px;
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
        .composer-slot.filled.selected {
          border-color: var(--blue);
          box-shadow: 0 0 0 2px var(--blue-bg);
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
          width: 100%;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          min-height: 0;
        }
        .composer-slot-img-frame {
          width: 25%;
          max-width: 25%;
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
          cursor: pointer;
          border: 1px solid transparent;
          border-radius: 3px;
        }
        .composer-slot.filled .composer-slot-img-frame:hover {
          border-color: var(--blue);
        }
        .composer-slot-crop {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 2px 0;
        }
        .composer-slot-img-frame img {
          width: 100%;
          height: 100%;
          display: block;
        }
        .composer-slot-img-frame span {
          font-size: clamp(8px, 1vw, 11px);
          font-weight: 700;
          color: #bbb;
        }
        .composer-slot-text {
          width: 100%;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: 0;
          overflow: hidden;
          padding-top: 2px;
        }
        .composer-slot-name {
          font-size: clamp(7px, 0.85vw, 10px);
          font-weight: 600;
          line-height: 1.1;
          text-align: center;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          width: 100%;
          color: #000;
        }
        .composer-slot-extra {
          font-size: 8px;
          color: #000;
          text-align: center;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .composer-slot-price {
          font-size: 8px;
          font-weight: 700;
          color: #000;
          flex-shrink: 0;
          text-align: center;
        }
      `}</style>
    </div>
  );
}

export { DND_GROUP, DND_PROD, DND_LINE, SLIDE_TARGET_AUTO, SLIDE_TARGET_NEW };
