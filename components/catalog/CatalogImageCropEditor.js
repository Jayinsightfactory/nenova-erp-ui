import { useEffect, useRef, useState } from 'react';
import { catalogImageStyle, resolveCatalogImageTransform } from '../../lib/catalogImagePosition';
import { absCatalogUrl } from '../../lib/catalogUtils';

function clampPos(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(0, Math.round(v)));
}

function clampScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 100;
  return Math.min(400, Math.max(100, Math.round(v)));
}

/** 슬라이드 칸과 동일한 정사각 — 드래그·확대로 자르기/위치 */
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = resolveCatalogImageTransform(source);
    setPosX(next.posX);
    setPosY(next.posY);
    setScale(next.scale);
  }, [source?.imageId, source?.id, source?.imagePosX, source?.imagePosY, source?.imageScale, source?.posX, source?.posY, source?.scale]);

  const preview = { posX, posY, scale, imagePosX: posX, imagePosY: posY, imageScale: scale };

  const applySave = async () => {
    setSaving(true);
    try {
      await onSave?.({ posX, posY, scale });
    } finally {
      setSaving(false);
    }
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
      setPosX(clampPos(st.posX + dx * 0.35));
      setPosY(clampPos(st.posY + dy * 0.35));
    };
    const onUp = () => {
      startRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const frameH = compact ? 100 : 140;

  return (
    <div className={`catalog-crop-editor ${compact ? 'compact' : ''}`}>
      <div
        className="catalog-crop-frame"
        style={{ height: frameH }}
        onPointerDown={onFramePointerDown}
        title="드래그: 위치 · 확대 (PPT 정사각 칸과 동일)"
      >
        <div className="catalog-crop-frame-inner">
          <img src={absCatalogUrl(imageUrl)} alt="" style={catalogImageStyle(preview)} draggable={false} />
        </div>
      </div>
      <div className="catalog-crop-sliders">
        <label>
          <span>확대</span>
          <input type="range" min={100} max={400} value={scale} disabled={busy || saving} onChange={e => setScale(clampScale(e.target.value))} />
          <span>{scale}%</span>
        </label>
        <label>
          <span>가로</span>
          <input type="range" min={0} max={100} value={posX} disabled={busy || saving} onChange={e => setPosX(Number(e.target.value))} />
        </label>
        <label>
          <span>세로</span>
          <input type="range" min={0} max={100} value={posY} disabled={busy || saving} onChange={e => setPosY(Number(e.target.value))} />
        </label>
      </div>
      <div className="catalog-crop-actions">
        <button type="button" className="btn btn-sm" disabled={busy || saving} onClick={() => { setPosX(50); setPosY(50); setScale(100); }}>리셋</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || saving} onClick={applySave}>
          {saving ? '저장…' : '적용'}
        </button>
        {onClose ? (
          <button type="button" className="btn btn-sm" disabled={busy || saving} onClick={onClose}>닫기</button>
        ) : null}
      </div>
      <style jsx>{`
        .catalog-crop-editor { margin-top: 6px; }
        .catalog-crop-frame {
          width: 100%; border: 1px solid var(--border2); border-radius: 4px;
          overflow: hidden; background: #fafafa; cursor: grab; touch-action: none;
        }
        .catalog-crop-frame-inner {
          width: 100%; height: 100%;
          overflow: hidden;
          display: flex; align-items: center; justify-content: center;
        }
        .catalog-crop-frame:active { cursor: grabbing; }
        .catalog-crop-frame-inner :global(img) { display: block; }
        .catalog-crop-sliders { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
        .catalog-crop-sliders label {
          display: grid; grid-template-columns: 32px 1fr 40px; gap: 6px; align-items: center; font-size: 10px;
        }
        .catalog-crop-actions { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
        .catalog-crop-editor.compact .catalog-crop-sliders label { font-size: 9px; }
      `}</style>
    </div>
  );
}
