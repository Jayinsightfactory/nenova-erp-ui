import { useEffect, useRef, useState } from 'react';
import {
  CATALOG_POS_MAX,
  CATALOG_POS_MIN,
  clampCatalogPos,
  normalizeRotate,
  resolveCatalogImageTransform,
} from '../../lib/catalogImagePosition';
import CatalogSlideImage from './CatalogSlideImage';
import { absCatalogUrl } from '../../lib/catalogUtils';

function clampScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 100;
  return Math.min(400, Math.max(100, Math.round(v)));
}

const NUDGE = 8;

/** 슬라이드/PPT 칸과 동일한 정사각 — 드래그·슬라이더·회전 */
export default function CatalogImageCropEditor({
  imageUrl,
  source,
  busy = false,
  compact = false,
  onSave,
  onClose,
}) {
  const startRef = useRef(null);
  const init = resolveCatalogImageTransform(source);
  const [posX, setPosX] = useState(init.posX);
  const [posY, setPosY] = useState(init.posY);
  const [scale, setScale] = useState(init.scale);
  const [rotate, setRotate] = useState(init.rotate);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = resolveCatalogImageTransform(source);
    setPosX(next.posX);
    setPosY(next.posY);
    setScale(next.scale);
    setRotate(next.rotate);
  }, [
    source?.imageId, source?.id,
    source?.imagePosX, source?.imagePosY, source?.imageScale, source?.imageRotate,
    source?.posX, source?.posY, source?.scale, source?.rotate,
  ]);

  const preview = {
    posX, posY, scale, rotate,
    imagePosX: posX, imagePosY: posY, imageScale: scale, imageRotate: rotate,
  };

  const applySave = async () => {
    setSaving(true);
    try {
      await onSave?.({
        posX, posY, scale, rotate,
        manualAdjusted: true,
        autoAdjusted: false,
      });
    } finally {
      setSaving(false);
    }
  };

  const nudge = (dx, dy) => {
    if (dx) setPosX(v => clampCatalogPos(v + dx));
    if (dy) setPosY(v => clampCatalogPos(v + dy));
  };

  const onFramePointerDown = (e) => {
    if (busy || saving) return;
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { x: e.clientX, y: e.clientY, posX, posY };
    const onMove = (ev) => {
      const st = startRef.current;
      if (!st) return;
      const dx = ev.clientX - st.x;
      const dy = ev.clientY - st.y;
      setPosX(clampCatalogPos(st.posX + dx * 1.4));
      setPosY(clampCatalogPos(st.posY + dy * 1.4));
    };
    const onUp = () => {
      startRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const frameH = compact ? 120 : 220;
  const disabled = busy || saving;

  return (
    <div className={`catalog-crop-editor ${compact ? 'compact' : ''}`}>
      <div
        className="catalog-crop-frame"
        style={{ height: frameH, maxHeight: frameH }}
        onPointerDown={onFramePointerDown}
        title="드래그로 상하·좌우 이동 (채우기 기준 · PPT 칸과 동일)"
      >
        <CatalogSlideImage source={preview} src={absCatalogUrl(imageUrl)} />
      </div>

      <div className="catalog-crop-nudge">
        <span className="catalog-crop-nudge-label">이동</span>
        <div className="catalog-crop-nudge-pad">
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => nudge(0, -NUDGE)} title="위">↑</button>
          <div className="catalog-crop-nudge-mid">
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => nudge(-NUDGE, 0)} title="왼쪽">←</button>
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => nudge(NUDGE, 0)} title="오른쪽">→</button>
          </div>
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => nudge(0, NUDGE)} title="아래">↓</button>
        </div>
      </div>

      <div className="catalog-crop-sliders">
        <label>
          <span>확대</span>
          <input type="range" min={100} max={400} value={scale} disabled={disabled} onChange={e => setScale(clampScale(e.target.value))} />
          <span>{scale}% {scale === 100 ? '채우기' : ''}</span>
        </label>
        <label>
          <span>가로</span>
          <input type="range" min={CATALOG_POS_MIN} max={CATALOG_POS_MAX} value={posX} disabled={disabled} onChange={e => setPosX(clampCatalogPos(e.target.value))} />
          <span>{posX}</span>
        </label>
        <label>
          <span>세로</span>
          <input type="range" min={CATALOG_POS_MIN} max={CATALOG_POS_MAX} value={posY} disabled={disabled} onChange={e => setPosY(clampCatalogPos(e.target.value))} />
          <span>{posY}</span>
        </label>
        <label>
          <span>회전</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={rotate}
            disabled={disabled}
            onChange={e => setRotate(normalizeRotate(e.target.value))}
          />
          <span>{rotate}°</span>
        </label>
      </div>

      <div className="catalog-crop-rotate-btns">
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setRotate(r => normalizeRotate(r - 90))}>↺ 90°</button>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setRotate(r => normalizeRotate(r + 90))}>↻ 90°</button>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setRotate(0)}>회전 0°</button>
      </div>

      <label className="catalog-crop-auto-flag" title="칸 크기에 맞게 자동 확대·중앙 정렬된 상태">
        <input
          type="checkbox"
          checked={!!(source?.imageAutoAdjusted ?? source?.autoAdjusted)}
          readOnly
          disabled
        />
        <span>자동수정됨</span>
      </label>

      <div className="catalog-crop-actions">
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => { setPosX(50); setPosY(50); setScale(100); setRotate(0); }}>전체 리셋</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={disabled} onClick={applySave}>
          {saving ? '저장…' : '적용'}
        </button>
        {onClose ? (
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={onClose}>닫기</button>
        ) : null}
      </div>

      <style jsx>{`
        .catalog-crop-editor { margin-top: 6px; }
        .catalog-crop-frame {
          width: 100%; border: 1px solid var(--border2); border-radius: 4px;
          overflow: hidden; background: #fafafa; cursor: grab; touch-action: none;
          aspect-ratio: 1;
        }
        .catalog-crop-frame :global(.catalog-slide-img-inner) {
          width: 100%; height: 100%;
        }
        .catalog-crop-frame:active { cursor: grabbing; }
        .catalog-crop-nudge {
          margin-top: 8px; display: flex; align-items: center; gap: 8px;
        }
        .catalog-crop-nudge-label { font-size: 10px; color: var(--text3); width: 28px; flex-shrink: 0; }
        .catalog-crop-nudge-pad {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .catalog-crop-nudge-mid { display: flex; gap: 4px; }
        .catalog-crop-nudge-pad :global(.btn) { min-width: 32px; padding: 2px 6px; }
        .catalog-crop-sliders { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
        .catalog-crop-sliders label {
          display: grid; grid-template-columns: 32px 1fr 40px; gap: 6px; align-items: center; font-size: 10px;
        }
        .catalog-crop-rotate-btns { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
        .catalog-crop-auto-flag {
          display: flex; align-items: center; gap: 6px; margin-top: 8px;
          font-size: 10px; color: var(--text2); cursor: default;
        }
        .catalog-crop-auto-flag input { margin: 0; accent-color: var(--blue); }
        .catalog-crop-actions { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
        .catalog-crop-editor.compact .catalog-crop-sliders label { font-size: 9px; }
      `}</style>
    </div>
  );
}
