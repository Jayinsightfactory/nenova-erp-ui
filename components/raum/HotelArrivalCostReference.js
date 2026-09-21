import { useState } from 'react';
import { recalcArrivalCostWithFx } from '../../lib/arrivalCostFxPreview';

const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });

// Browser-only comparison. No save callback, mutation request or export payload.
export default function HotelArrivalCostReference({ item, error }) {
  const [open, setOpen] = useState(false);
  const [fx, setFx] = useState('');
  if (error) return <span role="status" style={{ color: '#b91c1c' }} title={error}>도착원가 조회 실패</span>;
  if (!(Number(item?.prodKey) > 0)) return <span style={{ color: '#b45309' }}>품목 연결 필요</span>;
  const refs = item?.arrivalReferences || [];
  if (!refs.length) return <span title="동일 연도·품목의 해당/이전 차수 현재본 원가가 없습니다. 업무드라이브 파일 보관만으로는 도착원가에 등록되지 않습니다." style={{ color: '#64748b' }}>해당·이전 차수 원가 미등록</span>;
  return <div style={{ minWidth: 160, fontSize: 11, textAlign: 'left' }}>
    {refs.map(ref => <div key={ref.week} title={`${ref.sourceFile || ''} / ${ref.sourceSheet || ''} ${ref.sourceRow || ''}행 · ${ref.farm || ''} · 원본 ${fmt(ref.rawCost)}원/${ref.rawUnit || '단위 미확인'}`}>
      <b style={{ color: '#0369a1' }}>{ref.week}</b> {ref.conversionError ? <span style={{ color: '#b45309' }}>{ref.conversionError} (원본 {fmt(ref.rawCost)}원/{ref.rawUnit || '?'})</span> : <b>{fmt(ref.cost)}원/{ref.unit}</b>}
      {ref.isFallback && <span style={{ color: '#c2410c' }}> · 이전 최신</span>}
    </div>)}
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ fontSize: 11, padding: '2px 6px', marginTop: 3 }}>환율로 원가 비교</button>
    {open && <div style={{ padding: 6, border: '1px solid #99f6e4', background: '#f0fdfa', maxWidth: 290, whiteSpace: 'normal' }}>
      <label>비교 환율 <input aria-label="도착원가 비교 환율" inputMode="decimal" value={fx} onChange={e => setFx(e.target.value)} style={{ width: 75 }} /> 원</label>
      {refs.map(ref => {
        const result = recalcArrivalCostWithFx({ ...ref, selectedArrivalCostKRW: ref.rawCost }, fx);
        const allowed = !ref.conversionError && ref.customsPerUnitKRW != null && ref.otherPerUnitKRW != null;
        const cost = result.ok && allowed ? result.cost * ref.cost / ref.rawCost : null;
        return <div key={ref.week} style={{ marginTop: 4 }}><b>{ref.week}</b> · 원본 환율 {ref.exchangeRate ? fmt(ref.exchangeRate) : '없음'}<br />
          {cost != null ? <>비교 추정 <b>{fmt(cost)}원/{ref.unit}</b> · 차이 {fmt(cost - ref.cost)}원</> : (allowed ? result.reason : '단위 또는 통관비 구성 정보 확인 필요')}
        </div>;
      })}
      <div style={{ color: '#64748b', marginTop: 5 }}>VAT 별도 · 원화 통관비 고정, 나머지 원가에 입력 환율을 적용한 비교 추정값입니다. 원본 수식 재계산이 아니며 저장·엑셀에는 반영하지 않습니다.</div>
    </div>}
  </div>;
}
