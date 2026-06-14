import { useRef, useState } from 'react';
import {
  deleteCatalogImage,
  replaceCatalogImage,
  resizeImageFile,
  setCatalogPrimary,
  uploadCatalogImage,
} from '../../lib/catalogImageClient';

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

  if (!open) return null;

  const refresh = async () => {
    const res = await fetch(`/api/catalog/images?prodKey=${prodKey}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조회 실패');
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
        <p className="catalog-img-modal-sub">추가 · 교체 · 대표 지정 · 삭제 (JPEG 자동 리사이즈)</p>
        {msg && <div className="banner-ok" style={{ margin: '0 0 8px' }}>{msg}</div>}

        <div className="catalog-img-grid">
          {images.map(img => (
            <div
              key={img.id}
              className={`catalog-img-tile ${selectedImageId === img.id ? 'selected' : ''} ${img.isPrimary ? 'primary' : ''}`}
            >
              <button type="button" className="catalog-img-tile-btn" onClick={() => onSelect?.(img)}>
                <img src={img.url} alt="" />
              </button>
              {img.isPrimary && <span className="catalog-img-badge">대표</span>}
              <div className="catalog-img-actions">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => handlePrimary(img.id)}>대표</button>
                <label className="btn btn-sm" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
                  교체
                  <input type="file" accept="image/*" hidden disabled={busy} onChange={e => onFileChange(e, img.id)} />
                </label>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleDelete(img.id)}>삭제</button>
              </div>
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
          background: var(--surface); border: 2px solid var(--border2); width: min(560px, 96vw);
          max-height: 90vh; overflow: auto; padding: 12px; box-shadow: 3px 3px 12px rgba(0,0,0,0.25);
        }
        .catalog-img-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .catalog-img-modal-sub { font-size: 11px; color: var(--text3); margin-bottom: 10px; }
        .catalog-img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
        .catalog-img-tile {
          border: 1px solid var(--border2); border-radius: 4px; padding: 6px; position: relative; background: #fff;
        }
        .catalog-img-tile.selected { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-bg); }
        .catalog-img-tile.primary { border-color: var(--green); }
        .catalog-img-tile-btn {
          display: block; width: 100%; padding: 0; border: none; background: transparent; cursor: pointer;
        }
        .catalog-img-tile-btn img {
          width: 100%; height: 100px; object-fit: contain; display: block; background: #fafafa;
        }
        .catalog-img-badge {
          position: absolute; top: 8px; left: 8px; font-size: 10px; background: var(--green); color: #fff;
          padding: 1px 6px; border-radius: 3px; font-weight: 700;
        }
        .catalog-img-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
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
