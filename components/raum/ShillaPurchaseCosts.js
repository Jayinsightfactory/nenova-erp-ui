const border = '1px solid #cbd5e1';

function fmt(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

// 신라 셀은 화면에서만 제어한다. 조회/저장은 공통 매입단가 화면이 별도 endpoint로 맡는다.
export function isShillaPurchaseCostDraftUnchanged(raw, cell = {}) {
  const text = String(raw ?? '').trim();
  if (!text) return !Array.isArray(cell.values) || !cell.values.length;
  const value = Number(text.replace(/,/g, ''));
  return Array.isArray(cell.values) && cell.values.length === 1 && Number.isFinite(value) && value === Number(cell.values[0]);
}

export default function ShillaPurchaseCostInput({ item, cell, draft, onChange, disabled, unavailable, unavailableMessage }) {
  if (!cell) return <div style={{ minWidth: 165, flex: '1 1 165px', padding: 4, color: unavailable ? '#b91c1c' : '#94a3b8', fontSize: 10 }}>{unavailable ? (unavailableMessage || '신라 조회 실패') : '신라 자료 없음'}</div>;
  const value = draft ? draft.value : (cell.values.length === 1 ? String(cell.values[0]) : '');
  const text = String(value ?? '').trim();
  const cost = text ? Number(text.replace(/,/g, '')) : null;
  const invalid = !!text && (!Number.isFinite(cost) || cost < 0);
  const purchaseAmount = draft ? (text && !invalid ? cost * cell.qty : null) : cell.purchaseAmount;
  const storedValues = cell.values.length > 1 ? cell.values.map(fmt).join(' / ') : '';
  return <div style={{ minWidth: 165, flex: '1 1 165px', padding: 4, background: draft ? '#fef3c7' : '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 4 }}>
    <b style={{ color: '#0f766e', fontSize: 10 }}>신라 별도</b>
    <input disabled={disabled} value={value} onChange={event => onChange(cell, event.target.value)} inputMode="decimal" placeholder={cell.values.length > 1 ? '원본 단가 다름' : '매입단가'} aria-label={`${item.name} ${cell.major}차 신라 매입단가`} style={{ width: '100%', height: 22, boxSizing: 'border-box', marginTop: 3, textAlign: 'right', border: invalid ? '1px solid #dc2626' : border, borderRadius: 3, color: invalid ? '#b91c1c' : '#1e293b' }} />
    {storedValues ? <div style={{ marginTop: 2, color: '#9a3412', fontSize: 9 }}>저장 원본 단가 {storedValues}</div> : null}
    <div style={{ marginTop: 3, color: '#475569', fontSize: 9, lineHeight: 1.45 }}>
      수량 {fmt(cell.qty)} · 판매가 {cell.salePrices.length ? cell.salePrices.map(fmt).join('/') : '—'}<br />
      매입액 {invalid ? '확인' : fmt(purchaseAmount)} · 매출액 {fmt(cell.saleAmount)}
    </div>
  </div>;
}
