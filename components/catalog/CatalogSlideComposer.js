import { useCallback, useEffect, useRef, useState } from 'react';
import CatalogImageCropEditor from './CatalogImageCropEditor';
import CatalogSlideImage from './CatalogSlideImage';
import {
  absCatalogUrl,
  catalogLineNames,
} from '../../lib/catalogUtils';
import { normalizeCatalogLineForRender, resolveCatalogImageTransform } from '../../lib/catalogImagePosition';
import { buildCatalogCellLines, hasCatalogCellText } from '../../lib/catalogLineText';
import { catalogPptImageSizeLabel, estimateCatalogAutoTxtHcm, formatOriginLabel, layoutCssVars, normalizeOriginInput } from '../../lib/catalogLayout';
import { CATALOG_SLIDE_CSS } from './catalogSlideCss';
import {
  perPageSlotCount,
  SLIDE_TARGET_AUTO,
  SLIDE_TARGET_NEW,
} from '../../lib/catalogSlides';

const DND_GROUP = 'application/x-nenova-catalog-group';
const DND_PROD = 'application/x-nenova-catalog-prod';
const DND_PROD_KEYS = 'application/x-nenova-catalog-prod-keys';
const DND_LINE = 'application/x-nenova-catalog-line';

export function parseCatalogDragData(e) {
  const group = e.dataTransfer.getData(DND_GROUP);
  if (group) return { type: 'group', groupKey: group };
  const prodKeysRaw = e.dataTransfer.getData(DND_PROD_KEYS);
  if (prodKeysRaw) {
    try {
      const prodKeys = JSON.parse(prodKeysRaw).map(Number).filter(Number.isFinite);
      if (prodKeys.length) return { type: 'prod-batch', prodKeys };
    } catch { /* ignore */ }
  }
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
    e.dataTransfer.setData(DND_PROD, String(payload.prodKey));
    e.dataTransfer.setData('text/plain', `prod:${payload.prodKey}`);
    const keys = (Array.isArray(payload.prodKeys) ? payload.prodKeys : [payload.prodKey])
      .map(Number).filter(Number.isFinite);
    if (keys.length > 1) {
      e.dataTransfer.setData(DND_PROD_KEYS, JSON.stringify(keys));
    }
  } else if (payload.type === 'line') {
    e.dataTransfer.setData(DND_LINE, payload.lineId);
    e.dataTransfer.setData('text/plain', `line:${payload.lineId}`);
  }
}

function fieldsRenderKey(fields) {
  if (!fields) return '0';
  return [
    fields.showEng, fields.showKor, fields.showPrice,
    fields.showExtra1, fields.showExtra2, fields.showExtra3,
  ].map(v => (v ? '1' : '0')).join('');
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
        className="catalog-slide-item composer-slot empty"
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
  const renderLine = normalizeCatalogLineForRender(line);
  const pptFieldKey = fieldsRenderKey(catalogFields);

  return (
    <article
      className={`catalog-slide-item composer-slot filled ${selectedLineId === line.id ? 'selected' : ''}`}
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
      <div
        className="catalog-slide-img"
        onClick={(e) => {
          e.stopPropagation();
          onSelectLine?.(line.id);
          onToggleCropLine?.(cropLineId === line.id ? null : line.id);
        }}
        title="클릭 → 품목명·이미지 위치/확대"
      >
        {line.imageUrl ? (
          <>
            <CatalogSlideImage
              source={renderLine}
              src={absCatalogUrl(line.imageUrl)}
              key={`${line.id}-${renderLine.imagePosX}-${renderLine.imagePosY}-${renderLine.imageScale}-${renderLine.imageRotate}`}
            />
            {line.imageAutoAdjusted ? (
              <span className="composer-slot-auto-badge" title="칸 크기에 자동 맞춤됨">자동</span>
            ) : null}
          </>
        ) : (
          <span className="catalog-slide-ph">{eng?.slice(0, 2) || '품'}</span>
        )}
      </div>
      {hasCatalogCellText(line, catalogFields) ? (
        <div className="catalog-slide-names" key={pptFieldKey}>
          {cellLines.map(row => (
            <div
              key={row.kind}
              className={
                row.kind === 'price' ? 'price-name'
                  : row.kind.startsWith('extra') ? 'extra-name'
                    : row.kind === 'kor' ? 'kor-name' : 'eng-name'
              }
            >
              {row.text}
            </div>
          ))}
        </div>
      ) : null}
    </article>
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
  onUpdateLine,
  activeSlideTarget,
  onSelectSlideTarget,
  editorOpen = true,
}) {
  const slotCount = perPageSlotCount(perPage);

  // 배치된 품목 텍스트 줄수 기준 자동 여백 (PPT 익스포트와 동일 계산)
  const placedForTxt = slides.flatMap(s => (s.slots || []).map(id => (id ? linesById[id] : null)).filter(Boolean));
  const autoTxtH = estimateCatalogAutoTxtHcm(placedForTxt, catalogFields, perPage, 'wide');
  const mirrorVars = layoutCssVars(perPage, 'wide', { txtHcm: autoTxtH });

  const [expandedSlideId, setExpandedSlideId] = useState(null);
  const [cropDraft, setCropDraft] = useState(null);
  const backdropDownRef = useRef(false);

  const cropLine = cropLineId ? linesById[cropLineId] : null;

  // 모달을 열 때만 초기화 — 편집 중 cropDraft가 라인 동기화에 의해 되돌아가지 않게
  useEffect(() => {
    if (!cropLineId || !cropLine) {
      setCropDraft(null);
      return;
    }
    const t = resolveCatalogImageTransform(cropLine);
    setCropDraft({ posX: t.posX, posY: t.posY, scale: t.scale, rotate: t.rotate });
  }, [cropLineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineWithCropDraft = useCallback((line) => {
    if (!line || line.id !== cropLineId || !cropDraft) return line;
    return {
      ...line,
      imagePosX: cropDraft.posX,
      imagePosY: cropDraft.posY,
      imageScale: cropDraft.scale,
      imageRotate: cropDraft.rotate,
    };
  }, [cropLineId, cropDraft]);

  const closeCropModal = useCallback(() => {
    setCropDraft(null);
    onToggleCropLine?.(null);
  }, [onToggleCropLine]);

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
    else if (data && (data.type === 'prod' || data.type === 'prod-batch' || data.type === 'line')) onDropAutoSlot?.(data);
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
          title="슬라이드당 품목 칸 수 (1~5칸=1행, 6~10칸=2행)"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <option key={n} value={n}>
              {n}칸 ({n <= 5 ? `${n}×1` : `${Math.ceil(n / 2)}×2`})
            </option>
          ))}
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
            <div className="composer-slide-stage">
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
              <p className="composer-ppt-hint">
                PPT 미리보기와 동일 · 이미지 칸 {catalogPptImageSizeLabel(perPage)} (정사각)
              </p>
              <div className="composer-ppt-viewport">
                <div className="catalog-slide composer-ppt-mirror" style={mirrorVars}>
                  <div className="catalog-slide-hdr">
                    <span className="title-big">{slide.titleBig || '품종'}</span>
                    {slide.titleSmall ? (
                      <span className="title-small">{formatOriginLabel(slide.titleSmall)}</span>
                    ) : null}
                  </div>
                  <img className="catalog-slide-logo" src="/nenova-logo.png" alt="" />
                  <div className="catalog-slide-grid" key={fieldsRenderKey(catalogFields)}>
                    {Array.from({ length: slotCount }, (_, idx) => {
                      const lineId = slide.slots?.[idx] ?? null;
                      const line = lineId ? lineWithCropDraft(linesById[lineId]) : null;
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

      {cropLine ? (
        <div
          className="catalog-crop-modal-overlay"
          onMouseDown={(e) => {
            backdropDownRef.current = e.target === e.currentTarget;
          }}
          onMouseUp={(e) => {
            if (backdropDownRef.current && e.target === e.currentTarget) {
              closeCropModal();
            }
            backdropDownRef.current = false;
          }}
          role="presentation"
        >
          <div
            className="catalog-crop-modal"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="품목 편집"
          >
            <div className="catalog-crop-modal-head">
              <div className="catalog-crop-modal-head-titles">
                <strong>품목 편집</strong>
                {cropLine.imageAutoAdjusted ? (
                  <label className="catalog-crop-modal-auto" title="칸 크기에 맞게 자동 확대·중앙 정렬됨">
                    <input type="checkbox" checked readOnly disabled />
                    <span>자동수정됨</span>
                  </label>
                ) : null}
              </div>
              <button type="button" className="btn btn-sm" onClick={closeCropModal}>닫기</button>
            </div>

            <div className="catalog-slot-name-fields">
              <label className="catalog-slot-name-field">
                <span>영문명</span>
                <input
                  type="text"
                  className="form-control"
                  value={cropLine.engName || ''}
                  placeholder="영문명"
                  onChange={e => onUpdateLine?.(cropLine.id, { engName: e.target.value })}
                />
              </label>
              <label className="catalog-slot-name-field">
                <span>한글명</span>
                <input
                  type="text"
                  className="form-control"
                  value={cropLine.korName || ''}
                  placeholder="한글명"
                  onChange={e => onUpdateLine?.(cropLine.id, { korName: e.target.value })}
                />
              </label>
            </div>
            <p className="catalog-slot-name-hint">영문·한글명은 입력 즉시 자동 저장됩니다</p>

            {cropLine.imageUrl ? (
              <>
                <p className="catalog-crop-modal-sub">
                  PPT 정사각 칸({catalogPptImageSizeLabel(perPage)})과 동일 — 위치/확대는 PPT·인쇄에 그대로 반영
                </p>
                <CatalogImageCropEditor
                  key={cropLineId}
                  imageUrl={cropLine.imageUrl}
                  source={lineWithCropDraft(cropLine)}
                  onPreviewChange={setCropDraft}
                  onSave={async (transform) => {
                    const ok = await onSaveLineCrop?.(cropLine, transform);
                    if (ok !== false) {
                      setCropDraft(null);
                      onToggleCropLine?.(null);
                    }
                  }}
                  onClose={closeCropModal}
                />
              </>
            ) : (
              <p className="catalog-crop-no-img">이미지가 없습니다. 하단 품목 목록에서 이미지를 선택하세요.</p>
            )}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        ${CATALOG_SLIDE_CSS}
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
          padding: 6px 8px 10px;
          box-sizing: border-box;
          background: #fff;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .composer-ppt-hint {
          font-size: 10px;
          color: var(--text3);
          margin: 0 0 6px 2px;
        }
        .composer-ppt-viewport {
          width: 100%;
          overflow: auto;
          display: flex;
          justify-content: center;
          min-height: 0;
          flex: 1;
        }
        .composer-ppt-mirror {
          zoom: 0.48;
          margin: 0 auto;
          flex-shrink: 0;
        }
        .composer-ppt-mirror.catalog-slide {
          margin: 0 auto;
        }
        .composer-ppt-mirror .catalog-slide-item.composer-slot {
          position: relative;
          box-sizing: border-box;
        }
        .composer-ppt-mirror .catalog-slide-item.composer-slot.filled {
          border: 2px solid var(--green);
          border-radius: 2px;
          cursor: grab;
        }
        .composer-ppt-mirror .catalog-slide-item.composer-slot.filled.selected {
          border-color: var(--blue);
          box-shadow: 0 0 0 2px var(--blue-bg);
        }
        .composer-ppt-mirror .catalog-slide-item.composer-slot.empty {
          border: 1px dashed var(--border2);
          background: var(--header-bg);
          justify-content: center;
        }
        .composer-ppt-mirror .catalog-slide-img {
          cursor: pointer;
        }
        .composer-ppt-mirror .catalog-slide-img:hover {
          outline: 1px solid var(--blue);
        }
        .composer-slot-ph { font-size: 22px; color: var(--text3); }
        .composer-slot-clear {
          position: absolute;
          top: 2px;
          right: 2px;
          z-index: 3;
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
        .composer-slide-card.expanded .composer-slide-stage {
          flex: 1;
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
        .catalog-crop-modal-overlay {
          position: fixed; inset: 0; z-index: 6000;
          background: rgba(15, 23, 42, 0.45);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .catalog-crop-modal {
          width: min(420px, 96vw);
          max-height: 90vh; overflow-y: auto;
          background: #fff; border-radius: 8px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
          border: 1px solid var(--border2);
          padding: 12px 14px 14px;
        }
        .catalog-crop-modal-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
        }
        .catalog-crop-modal-head-titles {
          display: flex; flex-direction: column; gap: 4px; min-width: 0;
        }
        .catalog-crop-modal-auto {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 10px; font-weight: 500; color: var(--blue);
          cursor: default;
        }
        .catalog-crop-modal-auto input { margin: 0; accent-color: var(--blue); }
        .composer-slot-auto-badge {
          position: absolute; right: 2px; bottom: 2px; z-index: 2;
          font-size: 8px; line-height: 1.2; padding: 1px 3px;
          background: rgba(37, 99, 235, 0.9); color: #fff;
          border-radius: 2px; pointer-events: none;
        }
        .catalog-slide-img-inner { position: relative; }
        .catalog-slide-img { position: relative; }
        .catalog-crop-modal-sub {
          font-size: 11px; color: var(--text3); margin: 4px 0 8px;
        }
        .catalog-slot-name-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin: 8px 0 4px;
        }
        .catalog-slot-name-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11px;
        }
        .catalog-slot-name-field span { color: var(--text3); font-size: 10px; }
        .catalog-slot-name-hint {
          font-size: 10px;
          color: var(--text3);
          margin: 0 0 8px;
        }
        .catalog-crop-no-img {
          font-size: 12px;
          color: var(--text2);
          margin: 12px 0;
          text-align: center;
        }
      `}</style>
    </div>
  );
}

export { DND_GROUP, DND_PROD, DND_LINE, SLIDE_TARGET_AUTO, SLIDE_TARGET_NEW };
