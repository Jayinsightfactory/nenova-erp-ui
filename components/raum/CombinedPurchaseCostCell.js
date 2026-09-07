import ShillaPurchaseCostInput from './ShillaPurchaseCosts';

const border = '1px solid #cbd5e1';

function fmt(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function PartnerDetails({ label, detail, draftText, invalid }) {
  if (!detail) return <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{label} 자료 없음</div>;
  const draftNumber = draftText ? Number(String(draftText).replace(/,/g, '')) : null;
  const purchaseAmount = draftText != null ? (draftText && !invalid ? draftNumber * detail.qty : null) : detail.purchaseAmount;
  return <div style={{ borderTop: '1px dashed #e2e8f0', marginTop: 3, paddingTop: 2, fontSize: 9, color: '#64748b' }}>
    <b style={{ color: '#475569' }}>{label}</b><br />수량 {fmt(detail.qty)} · 판매가 {detail.salePrices?.length ? detail.salePrices.map(fmt).join('/') : '—'}<br />매입액 {invalid ? '확인' : fmt(purchaseAmount)} · 매출액 {fmt(detail.saleAmount)}
  </div>;
}

function StoredCostDifference({ partners }) {
  const rows = [['라움', partners?.raum], ['초이문', partners?.choimun]].map(([label, detail]) => ({
    label,
    value: detail?.costPrices?.length ? detail.costPrices.map(fmt).join(' / ') : '미입력',
  }));
  return <div style={{ marginTop: 3, padding: '3px 4px', border: '1px solid #fdba74', borderRadius: 3, background: '#fff', fontSize: 9, lineHeight: 1.35 }} aria-label={`저장 단가 비교: ${rows.map(row => `${row.label} ${row.value}`).join(', ')}`}>
    {rows.map(row => <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 4, color: '#9a3412' }}><b>{row.label}</b><span style={{ fontWeight: 700 }}>{row.value}</span></div>)}
  </div>;
}

function SharedPurchaseCostInput({ item, cell, draft, onChange, disabled, unavailable }) {
  if (!cell) return <div style={{ color: unavailable ? '#b91c1c' : '#94a3b8', fontSize: 10 }}>{unavailable ? '공통 조회 실패' : '공통 자료 없음'}</div>;
  const value = draft ? draft.value : (cell.state === 'match' || cell.state === 'partial' ? String(cell.singleValue) : '');
  const text = String(value ?? '').trim();
  const number = text ? Number(text.replace(/,/g, '')) : null;
  const invalid = !!text && (!Number.isFinite(number) || number < 0);
  const label = { missing: '미입력', mismatch: '단가 다름', partial: '맞추기 필요' }[cell.state];
  return <div style={{ minWidth: 165, flex: '1 1 165px', padding: 4, background: draft ? '#fef3c7' : '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}><b style={{ color: '#1d4ed8', fontSize: 10 }}>라움·초이문 공통</b>{label ? <span style={{ color: '#a16207', fontSize: 9 }}>{label}</span> : null}</div>
    <input value={value} disabled={disabled} onChange={event => onChange(cell, event.target.value)} inputMode="decimal" aria-label={`${item.name} ${cell.major}차 공통 매입단가`} placeholder={label || '매입단가'} style={{ width: '100%', height: 22, boxSizing: 'border-box', marginTop: 3, textAlign: 'right', border: invalid ? '1px solid #dc2626' : border, borderRadius: 3, color: invalid ? '#b91c1c' : '#1e293b' }} />
    {cell.state === 'partial' && !draft ? <button type="button" disabled={disabled} onClick={() => onChange(cell, String(cell.singleValue))} style={{ marginTop: 2, padding: '0 4px', border: '1px solid #a16207', borderRadius: 3, background: '#fff', color: '#a16207', fontSize: 9 }}>동일 적용</button> : null}
    {cell.state === 'mismatch' && !draft ? <StoredCostDifference partners={cell.partners} /> : null}
    <PartnerDetails label="라움" detail={cell.partners?.raum} draftText={draft ? text : null} invalid={invalid} />
    <PartnerDetails label="초이문" detail={cell.partners?.choimun} draftText={draft ? text : null} invalid={invalid} />
  </div>;
}

// 같은 제품·단위·차수에 공통 원가와 신라 원가를 나란히 보여 주되 저장 경계는 섞지 않는다.
export default function CombinedPurchaseCostCell({ item, cell, sharedDraft, shillaDraft, onSharedChange, onShillaChange, disabled, sharedUnavailable, shillaUnavailable, shillaUnavailableMessage }) {
  return <div style={{ width: 355, flex: '0 0 355px', padding: 4, border, borderRadius: 5, background: '#fff' }}>
    <b style={{ display: 'block', marginBottom: 3, color: '#334155', fontSize: 11 }}>{cell.major}차</b>
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
      <SharedPurchaseCostInput item={item} cell={cell.shared} draft={sharedDraft} onChange={onSharedChange} disabled={disabled} unavailable={sharedUnavailable} />
      <ShillaPurchaseCostInput item={item} cell={cell.shilla} draft={shillaDraft} onChange={onShillaChange} disabled={disabled} unavailable={shillaUnavailable} unavailableMessage={shillaUnavailableMessage} />
    </div>
  </div>;
}
