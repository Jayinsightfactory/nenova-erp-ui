import { useEffect, useRef, useState } from 'react';
import { shillaPnlProductMatchSnapshot } from '../../lib/shillaPnlProductMatchState';
import { fetchRaumPnlJson } from '../../lib/raumPnlHttp';
import {
  isCurrentShillaPnlSearchRequest,
  readShillaPnlProductSearchResponse,
  runShillaPnlSearchEnter,
  shillaPnlProductSearchUrl,
  shillaPnlSearchEmptyMessage,
} from '../../lib/shillaPnlSearch';

const border = '1px solid #cbd5e1';
const button = { height: 28, padding: '0 9px', border, borderRadius: 4, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 12 };
const primary = { ...button, background: '#0f766e', borderColor: '#0f766e', color: '#fff', fontWeight: 700 };

function productKey(product) {
  const value = Number(product?.ProdKey ?? product?.prodKey);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function productName(product) {
  return String(product?.ProdName ?? product?.prodName ?? product?.Name ?? product?.name ?? '').trim();
}

// 신라 저장 행 하나만 연결한다. 전역 품목명 매핑 API에는 절대 쓰지 않는다.
export default function ShillaProductMatchModal({ edit, onSaved, onClose, onBusyChange }) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const item = edit?.item;

  useEffect(() => {
    if (!edit) return;
    requestRef.current += 1;
    setQuery(String(item?.name ?? item?.Name ?? ''));
    setProducts([]);
    setHasSearched(false);
    setError('');
    setSearching(false);
    setSaving(false);
  }, [edit, item]);

  useEffect(() => () => { requestRef.current += 1; }, []);
  if (!edit || !item) return null;

  const search = async (rawQuery = query) => {
    const activeQuery = String(rawQuery ?? '').trim();
    if (!activeQuery || saving) return;
    const request = ++requestRef.current;
    setQuery(rawQuery);
    setHasSearched(true);
    setSearching(true);
    setError('');
    try {
      const response = await fetch(shillaPnlProductSearchUrl(activeQuery));
      const nextProducts = await readShillaPnlProductSearchResponse(response);
      if (!isCurrentShillaPnlSearchRequest(request, requestRef.current)) return;
      setProducts(nextProducts);
    } catch (cause) {
      if (!isCurrentShillaPnlSearchRequest(request, requestRef.current)) return;
      setProducts([]);
      setError(cause.message || '품목을 찾지 못했습니다.');
    } finally {
      if (isCurrentShillaPnlSearchRequest(request, requestRef.current)) setSearching(false);
    }
  };

  const save = async (prodKey) => {
    if (saving) return;
    const itemKey = Number(item.itemKey ?? item.ItemKey);
    if (!Number.isInteger(itemKey) || itemKey <= 0) {
      setError('저장된 신라 행 식별자가 없어 품목을 연결할 수 없습니다.');
      return;
    }
    requestRef.current += 1;
    setSearching(false);
    setSaving(true);
    onBusyChange?.(true);
    setError('');
    try {
      const result = await fetchRaumPnlJson('/api/raum/shilla-item-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerCode: 'shilla',
          orderYear: String(edit.orderYear),
          major: Number(edit.major),
          pnlKey: Number(edit.pnlKey),
          itemKey,
          prodKey,
          expected: shillaPnlProductMatchSnapshot(item),
        }),
      }, { operation: 'save' });
      await onSaved?.(result);
    } catch (cause) {
      setError(cause.message || '신라 품목 연결을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };

  const currentKey = productKey(item);
  return <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.45)', padding: 18 }} role="dialog" aria-modal="true" aria-label="신라 품목 연결">
    <div style={{ width: 'min(620px, 100%)', maxHeight: 'min(720px, 100%)', overflow: 'auto', background: '#fff', borderRadius: 8, padding: 14, boxShadow: '0 18px 45px rgba(15,23,42,.3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><b style={{ fontSize: 16 }}>신라 저장 행 품목 연결</b><span style={{ color: '#64748b', fontSize: 11 }}>이 행에만 저장됩니다.</span></div>
      <div style={{ marginTop: 8, padding: '7px 8px', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 4, fontSize: 12, lineHeight: 1.55 }}>
        <b>{item.name ?? item.Name}</b> · {(item.unit ?? item.Unit) || '단위 미확인'} · 수량 {item.qty ?? item.Qty ?? '—'}<br />
        원본 판매가 {item.salePrice ?? item.SalePrice ?? item.price ?? item.Price ?? '—'} · 현재 연결 {currentKey ? `${(item.prodName ?? item.ProdName) || `#${currentKey}`} (#${currentKey})` : '미연결'}
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 9 }}>
        <input value={query} onChange={event => { requestRef.current += 1; setQuery(event.target.value); setProducts([]); setHasSearched(false); setError(''); setSearching(false); }} onKeyDown={event => runShillaPnlSearchEnter(event, search)} disabled={saving} placeholder="전산 품목명 검색" style={{ flex: '1 1 auto', height: 28, border, borderRadius: 4, padding: '0 7px' }} />
        <button type="button" style={button} disabled={saving || searching || !query.trim()} onClick={() => search(query)}>{searching ? '검색 중…' : '검색'}</button>
      </div>
      {error ? <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 7 }}>{error}</div> : null}
      <div style={{ marginTop: 8, borderTop: border }}>
        {products.map(product => {
          const key = productKey(product);
          if (!key) return null;
          const details = [product.DisplayName, product.FlowerName, product.CounName, product.OutUnit].filter(value => String(value ?? '').trim());
          return <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '7px 2px', borderBottom: border }}>
            <span title={productName(product)}><b>{productName(product) || '이름 없음'}</b> <span style={{ color: '#64748b' }}>#{key}</span>{details.length ? <><br /><span style={{ color: '#64748b', fontSize: 10 }}>{details.join(' · ')}</span></> : null}</span>
            <button type="button" style={primary} disabled={saving} onClick={() => save(key)}>{saving ? '저장 중…' : (key === currentKey ? '선택됨' : '연결')}</button>
          </div>;
        })}
        {!searching && shillaPnlSearchEmptyMessage({ hasSearched, products, error }) ? <div style={{ padding: '9px 2px', color: '#64748b', fontSize: 12 }}>{shillaPnlSearchEmptyMessage({ hasSearched, products, error })}</div> : null}
        {!searching && !hasSearched && query ? <div style={{ padding: '9px 2px', color: '#64748b', fontSize: 12 }}>검색어를 입력하고 검색을 누르세요.</div> : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button type="button" style={{ ...button, color: '#b91c1c' }} disabled={saving || !currentKey} onClick={() => save(null)}>연결 해제</button>
        <button type="button" style={button} disabled={saving} onClick={onClose}>닫기</button>
      </div>
    </div>
  </div>;
}
