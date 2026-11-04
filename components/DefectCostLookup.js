import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/useApi';
import { resolutionDescriptor } from '../lib/defectResolution.js';

export default function DefectCostLookup({ row, year, week, disabled, onBusy, onSaved }) {
  const [data, setData] = useState(null), [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const endpoint = '/api/sales/defect-deductions';
  const read = async (keyword = '') => {
    setBusy(true); setError(''); setData(null);
    try {
      const result = await apiGet(endpoint, { view: 'cost-candidates', year, week, custKey: row.custKey, prodKey: row.prodKey, q: keyword });
      setData(result); if (!keyword) setSearch(result.keyword || '');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { read(); }, [year, week, row.custKey, row.prodKey]);
  const selectProduct = async product => {
    if (!window.confirm(`현재 연결 품목을 변경합니다.\n${row.matchedProductDbName || row.productDbName || row.productName} (#${row.prodKey})\n→ ${product.productName} (#${product.prodKey})\n규격과 단위를 확인하세요. 수량은 ${row.quantity}${row.sourceUnit} 그대로이며, 저장 후 출고단가를 다시 조회합니다.`)) return;
    setBusy(true); onBusy?.(true); setError('');
    try {
      const payload = { action: 'manage-edit', year, week, rows: [resolutionDescriptor(row)], changes: { prodKey: product.prodKey, productName: product.productName } };
      await apiPost(endpoint, { ...payload, preview: true });
      await apiPost(endpoint, { ...payload, preview: false });
      await onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); onBusy?.(false); }
  };
  return <section className="cost-lookup" aria-label="최근 출고단가 후보" onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target.tagName !== 'BUTTON') return;
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(event.target);
    if (index >= 0 && buttons.length) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
  }}>
    <strong>최근 출고단가 · 같은 연도 직전 5차수</strong>
    <p>현재 연결된 품목번호의 단가를 자동 조회합니다. 같은 업체를 우선하고 없으면 다른 업체의 동일 품목 단가를 사용합니다.</p>
    <div className="search"><label>출고 품목 검색 <input aria-label="출고단가 품목 검색" value={search} disabled={disabled || busy} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); read(search); } }} /></label><button type="button" disabled={disabled || busy} onClick={() => read(search)}>출고단가 조회</button></div>
    {busy && <p role="status">출고단가 조회·검사 중…</p>}
    {error && <p role="alert">조회·저장 실패: {error} 다시 조회하세요.</p>}
    {(data?.products || []).map(product => <div className="product" key={product.prodKey}>
      <b>{product.current ? '현재 연결 품목' : '다른 품목번호 · 규격 확인 필요'}: {product.productName} (#{product.prodKey})</b>
      <p>{product.country} · 견적단위 {product.unit}</p>
      {product.costs?.length ? <><ul>{product.costs.map((c, i) => <li key={i}>{c.customerName || `업체 #${c.custKey}`} · {c.year}년 {c.week}차 · <b>{Number(c.cost).toLocaleString()}원/{product.unit}</b>{i === 0 ? ' · 매칭 후 자동 선택 기준' : ''}</li>)}</ul>
        {!product.current && <button type="button" disabled={disabled || busy} onClick={() => selectProduct(product)}>이 출고 품목으로 매칭하고 재검사</button>}
        {product.current && <button type="button" disabled={disabled || busy} onClick={onSaved}>이 단가로 등록 가능 여부 재검사</button>}
      </> : <p>이 품목번호의 최근 출고단가가 없습니다. 아래 다른 규격의 출고 품목을 확인하거나 검색하세요.</p>}
    </div>)}
    <style jsx>{`.cost-lookup{padding:12px;border:1px solid #a8bfdc;background:#f4f8ff;margin:10px 0;font-size:13px}.search{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.product{border-top:1px solid #cbd5e1;padding:10px 0}p{margin:6px 0;overflow-wrap:anywhere}ul{margin:6px 0;padding-left:20px}button,input{font:inherit;padding:6px;max-width:100%}button{cursor:pointer}button:disabled{cursor:default}:is(button,input):focus-visible{outline:3px solid #2563eb;outline-offset:2px}`}</style>
  </section>;
}
