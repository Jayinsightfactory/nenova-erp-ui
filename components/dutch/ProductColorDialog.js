import { useEffect, useRef, useState } from 'react';
import { productColorDescription } from '../../lib/productColor';

export default function ProductColorDialog({ product, initialColor, onSave, onClose }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const savingRef = useRef(false);
  const [color, setColor] = useState(initialColor || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  let description = '', validationError = '';
  try { description = productColorDescription(product.Descr, color); }
  catch (cause) { validationError = cause.message; }
  useEffect(() => {
    dialogRef.current.showModal();
    inputRef.current.focus();
    inputRef.current.select();
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (savingRef.current || validationError) return;
    savingRef.current = true; setSaving(true); setError('');
    try { await onSave(color); }
    catch (cause) { setError(cause.message || '저장하지 못했습니다. 입력 내용을 확인하세요.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <dialog ref={dialogRef} aria-labelledby="product-color-title" onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="product-color-title">칼라 수정</h2>
      <strong>{product.ProdName}</strong>
      <label>칼라<input ref={inputRef} value={color} maxLength={40} disabled={saving} onChange={event => { setColor(event.target.value); setError(''); }} /></label>
      <dl><dt>기존 품목비고</dt><dd>{product.Descr || '(없음)'}</dd><dt>저장할 품목비고</dt><dd>{description || '—'}</dd></dl>
      <p>저장하면 품목관리와 EXE에서 사용하는 품목비고에 반영됩니다.</p>
      {(error || validationError) && <p role="alert">{error || validationError}</p>}
      <footer><button type="button" disabled={saving} onClick={onClose}>취소</button><button type="submit" disabled={saving || !!validationError}>{saving ? '저장 중…' : '품목비고에 저장'}</button></footer>
    </form>
    <style jsx>{`dialog{width:min(440px,90vw);box-sizing:border-box;border:1px solid #9eb3ce;border-radius:8px;padding:20px;color:#172033}dialog::backdrop{background:#10203080}h2{margin:0 0 12px;font-size:18px}strong{display:block;overflow-wrap:anywhere}label{display:block;margin:16px 0;font-weight:700}input{box-sizing:border-box;display:block;width:100%;margin-top:6px;padding:9px;font-size:16px;border:1px solid #91a9c7;border-radius:4px}dt{font-weight:700;font-size:12px}dd{margin:4px 0 12px;padding:8px;background:#f0f5fb;white-space:pre-wrap;overflow-wrap:anywhere}p{font-size:12px}p[role=alert]{color:#b42318}footer{display:flex;justify-content:flex-end;gap:8px}button{padding:8px 12px;border:1px solid #8ea5c5;border-radius:4px;cursor:pointer}button[type=submit]{background:#155bd7;color:white}button:disabled{opacity:.5;cursor:default}input:focus-visible,button:focus-visible{outline:2px solid #155bd7;outline-offset:2px}`}</style>
  </dialog>;
}
