import { useEffect, useRef, useState } from 'react';
import {
  deleteCatalogImage,
  fetchCatalogImages,
  replaceCatalogImage,
  resizeImageFile,
  setCatalogPrimary,
  updateCatalogImagePosition,
  uploadCatalogImage,
} from '../../lib/catalogImageClient';
import { catalogImageStyle, resolveCatalogImagePosition } from '../../lib/catalogImagePosition';
import { absCatalogUrl } from '../../lib/catalogUtils';

function clampPos(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(0, Math.round(v)));
}

function CatalogImagePositionEditor({ img, busy, onSave, onClose }) {
  const startRef = useRef(null);
  const { posX: initX, posY: initY } = resolveCatalogImagePosition(img);
  const [posX, setPosX] = useState(initX);
  const [posY, setPosY] = useState(initY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPosX(initX);
    setPosY(initY);
  }, [img.id, initX, initY]);

  const applySave = async () => {
    setSaving(true);
    try {
      await onSave({ posX, posY });
    } finally {
      setSaving(false);
    }
  };

  const onFramePointerDown = (e) => {
    if (busy || saving) return;
    e.preventDefault();
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

  return (
    <div className="catalog-img-pos-panel">
      <div
        className="catalog-img-pos-frame"
        onPointerDown={onFramePointerDown}
        title="드래그하여 꽃 위치 조정"
      >
        <img src={absCatalogUrl(img.url)} alt="" style={catalogImageStyle({ posX, posY })} draggable={false} />
      </div>
      <div className="catalog-img-pos-sliders">
        <label>
          <span>가로</span>
          <input type="range" min={0} max={100} value={posX} disabled={busy || saving} onChange={e => setPosX(Number(e.target.value))} />
          <span>{posX}%</span>
        </label>
        <label>
          <span>세로</span>
          <input type="range" min={0} max={100} value={posY} disabled={busy || saving} onChange={e => setPosY(Number(e.target.value))} />
          <span>{posY}%</span>
        </label>
      </div>
      <div className="catalog-img-pos-actions">
        <button type="button" className="btn btn-sm" disabled={busy || saving} onClick={() => { setPosX(50); setPosY(50); }}>중앙</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || saving} onClick={applySave}>
          {saving ? '저장…' : '적용'}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy || saving} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

export default function CatalogImagePicker({
  open,
  prodKey,
  prodLabel,
  images = [],
  selectedImageId,
  onClose,
  onImagesChange,
  onSelect,
}) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [editingPosId, setEditingPosId] = useState(null);

  if (!open) return null;

  const refresh = async () => {
    const data = await fetchCatalogImages(prodKey);
    onImagesChange?.(prodKey, data.images || []);
    return data.images || [];
  };

  const handleUpload = async (file, replaceId) => {
    setBusy(true);
    setMsg('');
    try {
      const resized = await resizeImageFile(file);
      let image;
      if (replaceId) {
        image = await replaceCatalogImage(replaceId, resized);
      } else {
        image = await uploadCatalogImage(resized, prodKey);
      }
      const list = await refresh();
      onSelect?.(image);
      if (!selectedImageId && list.length === 1) onSelect?.(list[0]);
      setMsg(replaceId ? '이미지를 교체했습니다.' : '이미지를 추가했습니다.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onFileChange = (e, replaceId) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file, replaceId);
  };

  const handlePrimary = async (id) => {
    setBusy(true);
    setMsg('');
    try {
      const image = await setCatalogPrimary(id);
      await refresh();
      onSelect?.(image);
      setMsg('대표 이미지로 지정했습니다.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePositionSave = async (id, { posX, posY }) => {
    setBusy(true);
    setMsg('');
    try {
      const image = await updateCatalogImagePosition(id, { posX, posY });
      await refresh();
      if (selectedImageId === id) onSelect?.(image);
      setMsg('이미지 위치를 저장했습니다.');
      setEditingPosId(null);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 이미지를 삭제할까요? (서버에서 영구 삭제)')) return;
    setBusy(true);
    setMsg('');
    try {
      await deleteCatalogImage(id);
      const list = await refresh();
      if (selectedImageId === id) {
        onSelect?.(list[0] || null);
      }
      if (editingPosId === id) setEditingPosId(null);
      setMsg('삭제했습니다.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="catalog-img-modal-overlay" onClick={onClose} role="presentation">
      <div className="catalog-img-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="catalog-img-modal-head">
          <strong>📷 {prodLabel || `품목 #${prodKey}`}</strong>
          <button type="button" className="btn btn-sm" onClick={onClose}>닫기</button>
        </div>
        <p className="catalog-img-modal-sub">추가 · 교체 · 대표 · 위치 조정 · 삭제 (JPEG 자동 리사이즈)</p>
        {msg && <div className="banner-ok" style={{ margin: '0 0 8px' }}>{msg}</div>}

        <div className="catalog-img-grid">
          {images.map(img => (
            <div
              key={img.id}
              className={`catalog-img-tile ${selectedImageId === img.id ? 'selected' : ''} ${img.isPrimary ? 'primary' : ''}`}
            >
              <button type="button" className="catalog-img-tile-btn" onClick={() => onSelect?.(img)}>
                <img src={absCatalogUrl(img.url)} alt="" style={catalogImageStyle(img)} />
              </button>
              {img.isPrimary && <span className="catalog-img-badge">대표</span>}
              <div className="catalog-img-actions">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => handlePrimary(img.id)}>대표</button>
                <button
                  type="button"
                  className={`btn btn-sm ${editingPosId === img.id ? 'btn-primary' : ''}`}
                  disabled={busy}
                  onClick={() => setEditingPosId(editingPosId === img.id ? null : img.id)}
                >
                  위치
                </button>
                <label className="btn btn-sm" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
                  교체
                  <input type="file" accept="image/*" hidden disabled={busy} onChange={e => onFileChange(e, img.id)} />
                </label>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleDelete(img.id)}>삭제</button>
              </div>
              {editingPosId === img.id && (
                <CatalogImagePositionEditor
                  img={img}
                  busy={busy}
                  onSave={pos => handlePositionSave(img.id, pos)}
                  onClose={() => setEditingPosId(null)}
                />
              )}
            </div>
          ))}
          <label className={`catalog-img-add ${busy ? 'disabled' : ''}`}>
            <span>＋ 추가</span>
            <input ref={fileRef} type="file" accept="image/*" hidden disabled={busy} onChange={e => onFileChange(e, null)} />
          </label>
        </div>
      </div>

      <style jsx global>{`
        .catalog-img-modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 2000;
          display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        .catalog-img-modal {
          background: var(--surface); border: 2px solid var(--border2); width: min(640px, 96vw);
          max-height: 90vh; overflow: auto; padding: 12px; box-shadow: 3px 3px 12px rgba(0,0,0,0.25);
        }
        .catalog-img-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .catalog-img-modal-sub { font-size: 11px; color: var(--text3); margin-bottom: 10px; }
        .catalog-img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
        .catalog-img-tile {
          border: 1px solid var(--border2); border-radius: 4px; padding: 6px; position: relative; background: #fff;
        }
        .catalog-img-tile.selected { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-bg); }
        .catalog-img-tile.primary { border-color: var(--green); }
        .catalog-img-tile-btn {
          display: block; width: 100%; padding: 0; border: none; background: transparent; cursor: pointer;
        }
        .catalog-img-tile-btn img {
          width: 100%; height: 100px; display: block; background: #fafafa;
        }
        .catalog-img-badge {
          position: absolute; top: 8px; left: 8px; font-size: 10px; background: var(--green); color: #fff;
          padding: 1px 6px; border-radius: 3px; font-weight: 700;
        }
        .catalog-img-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
        .catalog-img-pos-panel {
          margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border2);
        }
        .catalog-img-pos-frame {
          width: 100%; height: 140px; border: 1px solid var(--border2); border-radius: 4px;
          overflow: hidden; background: #fafafa; cursor: grab; touch-action: none;
        }
        .catalog-img-pos-frame:active { cursor: grabbing; }
        .catalog-img-pos-frame img { width: 100%; height: 100%; }
        .catalog-img-pos-sliders { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
        .catalog-img-pos-sliders label {
          display: grid; grid-template-columns: 28px 1fr 36px; gap: 6px; align-items: center; font-size: 11px;
        }
        .catalog-img-pos-actions { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
        .catalog-img-add {
          border: 2px dashed var(--border2); border-radius: 4px; min-height: 140px;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          color: var(--text3); font-size: 13px; font-weight: 600;
        }
        .catalog-img-add.disabled { opacity: 0.5; pointer-events: none; }
        .catalog-img-add:hover { border-color: var(--blue); color: var(--blue); }
      `}</style>
    </div>
  );
}
