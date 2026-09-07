import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildRaumPnlPurchaseCostMatrix } from '../../lib/raumPnlCostComparison';

const border = '1px solid #cbd5e1';
const btn = { height: 26, padding: '0 8px', border, borderRadius: 4, background: '#fff', color: '#1e293b', cursor: 'pointer', fontSize: 11 };
const primary = { ...btn, background: '#0f766e', borderColor: '#0f766e', color: '#fff', fontWeight: 700 };
const fmt = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });

function unchanged(raw, cell) {
  const text = String(raw ?? '').trim();
  if (!text) return !cell.values.length;
  const number = Number(text.replace(/,/g, ''));
  return cell.values.length === 1 && Number.isFinite(number) && number === Number(cell.values[0]);
}

function CostCell({ item, cell, draft, onChange, disabled }) {
  const value = draft ? draft.value : (cell.values.length === 1 ? String(cell.values[0]) : '');
  const text = String(value ?? '').trim();
  const cost = text ? Number(text.replace(/,/g, '')) : null;
  const invalid = !!text && (!Number.isFinite(cost) || cost < 0);
  const purchaseAmount = draft && !text ? null : text && !invalid ? cost * cell.qty : cell.purchaseAmount;
  return <div style={{ width: 180, flex: '0 0 180px', border, borderRadius: 4, padding: 4, background: draft ? '#fef3c7' : '#f8fffe' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}><b style={{ color: '#0f766e' }}>{cell.major}차</b><span style={{ color: '#64748b', fontSize: 10 }}>원본 차수</span></div>
    <input disabled={disabled} value={value} onChange={event => onChange(cell, event.target.value)} inputMode="decimal" placeholder={cell.values.length > 1 ? '원본 단가 다름' : '매입단가'} aria-label={`${item.name} ${cell.major}차 신라 매입단가`} style={{ width: '100%', height: 22, boxSizing: 'border-box', marginTop: 3, textAlign: 'right', border: invalid ? '1px solid #dc2626' : border, borderRadius: 3, color: invalid ? '#b91c1c' : '#1e293b' }} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 3, gap: '1px 5px', color: '#475569', fontSize: 10, lineHeight: 1.35 }}>
      <span>수량 {fmt(cell.qty)}</span><span style={{ textAlign: 'right' }}>판매가 {cell.salePrices.length ? cell.salePrices.map(fmt).join('/') : '—'}</span>
      <span>매입액 {invalid ? '확인' : fmt(purchaseAmount)}</span><span style={{ textAlign: 'right' }}>매출액 {fmt(cell.saleAmount)}</span>
    </div>
  </div>;
}

// 신라 원가는 독립 endpoint와 PnlKey snapshot을 사용한다. 상대 업체 행을 만들거나 합치지 않는다.
export default function ShillaPurchaseCosts({ orderYear }) {
  const seq = useRef(0);
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!/^\d{4}$/.test(String(orderYear))) return;
    const request = ++seq.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/raum/shilla-purchase-costs?year=${encodeURIComponent(orderYear)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '신라 매입단가를 불러오지 못했습니다.');
      if (request !== seq.current) return;
      setRows(Array.isArray(result.shillaRows) ? result.shillaRows : (Array.isArray(result.rows) ? result.rows : []));
      setDrafts({});
    } catch (e) {
      if (request !== seq.current) return;
      setRows([]); setError(e.message || '신라 매입단가를 불러오지 못했습니다.');
    } finally { if (request === seq.current) setLoading(false); }
  }, [orderYear]);
  useEffect(() => { load(); return () => { seq.current += 1; }; }, [load]);
  const matrix = useMemo(() => buildRaumPnlPurchaseCostMatrix(rows, { orderYear, partnerCode: 'shilla' }), [rows, orderYear]);
  const dirty = Object.values(drafts);
  const update = (cell, value) => {
    setDrafts(current => {
      const next = { ...current };
      if (unchanged(value, cell)) delete next[cell.key]; else next[cell.key] = { cell, value };
      return next;
    });
    setMessage('');
  };
  const save = async () => {
    if (!dirty.length) return;
    const invalid = dirty.some(({ value }) => {
      const text = String(value ?? '').trim(); const number = Number(text.replace(/,/g, ''));
      return text && (!Number.isFinite(number) || number < 0);
    });
    if (invalid) { setError('매입단가는 0 이상의 숫자만 입력할 수 있습니다.'); return; }
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/raum/shilla-purchase-costs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderYear, updates: dirty.map(({ cell, value }) => ({ pnlKey: cell.pnlKey, major: cell.major, identity: cell.identity, expected: cell.snapshot, costPrice: String(value ?? '').trim() ? Number(String(value).replace(/,/g, '')) : null })) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '신라 매입단가 저장에 실패했습니다.');
      setRows(Array.isArray(result.shillaRows) ? result.shillaRows : (Array.isArray(result.rows) ? result.rows : []));
      setDrafts({}); setMessage(`${result.changedCells || dirty.length}개 신라 원가를 저장했습니다.`);
    } catch (e) { setError(e.message || '신라 매입단가 저장에 실패했습니다.'); } finally { setSaving(false); }
  };
  return <section style={{ marginTop: 14, border: '1px solid #99f6e4', borderRadius: 6, padding: 8, background: '#f0fdfa' }} aria-label="신라호텔 차수별 매입단가">
    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
      <b style={{ fontSize: 13, color: '#115e59' }}>신라호텔 별도 매입단가 · {orderYear}년</b><span style={{ fontSize: 11, color: '#475569' }}>신라 원본 결산만 대상으로 하며 라움·초이문 공통 단가와 연결하지 않습니다.</span>
      <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={load} disabled={loading || saving}>↻ 새로고침</button><button type="button" style={{ ...primary, opacity: dirty.length && !saving ? 1 : .55 }} disabled={!dirty.length || saving} onClick={save}>{saving ? '저장 중…' : `신라 원가 저장 (${dirty.length})`}</button>
    </div>
    {error ? <div role="alert" style={{ color: '#b91c1c', fontSize: 11, marginBottom: 5 }}>{error}</div> : null}{message ? <div style={{ color: '#166534', fontSize: 11, marginBottom: 5 }}>{message}</div> : null}
    {!loading && !matrix.items.length ? <div style={{ color: '#64748b', fontSize: 11, padding: '4px 0' }}>저장된 신라 결산 품목이 없습니다.</div> : null}
    <div style={{ display: 'grid', gap: 4, overflowX: 'auto' }}>{matrix.items.map(item => <div key={item.identity} style={{ display: 'flex', gap: 5, alignItems: 'stretch', borderTop: '1px solid #ccfbf1', paddingTop: 4 }}><div style={{ width: 200, flex: '0 0 200px', alignSelf: 'center', fontSize: 11 }} title={item.name}><b>{item.name}</b><br /><span style={{ color: '#64748b' }}>{item.unit || '단위 미확인'}{item.isCustom ? ' · 수동' : ''}</span></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{item.cells.filter(Boolean).map(cell => <CostCell key={cell.key} item={item} cell={cell} draft={drafts[cell.key]} onChange={update} disabled={saving || loading} />)}</div></div>)}</div>
  </section>;
}
