import { useState } from 'react';
import { arrivalHistoryWeeks, compareHotelArrival } from '../../lib/hotelArrivalDisplay';

const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const fmtRate = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });

// Browser-only comparison. No save callback, mutation request or export payload.
export default function HotelArrivalCostReference({ item, error, rates = {} }) {
  const [open, setOpen] = useState(false);
  const [fx, setFx] = useState('');
  const [selectedWeek,setSelectedWeek]=useState(null);
  if (error) return <span role="status" style={{ color: '#b91c1c' }} title={error}>도착원가 조회 실패</span>;
  if (!(Number(item?.prodKey) > 0)) return <span style={{ color: '#b45309' }}>품목 연결 필요</span>;
  const history = item?.arrivalHistory;
  const weeks = arrivalHistoryWeeks(history || []);
  const currentWeek = weeks.includes(selectedWeek) ? selectedWeek : weeks.at(-1);
  const position=weeks.indexOf(currentWeek);
  const refs = history ? history.filter(ref=>ref.week===currentWeek) : item?.arrivalReferences || [];
  if (!refs.length) return <span title="동일 연도·품목의 해당 차수·다음 1차 원가가 없으며 이전 최신 원가도 없습니다." style={{ color: '#64748b' }}>해당·다음 1차·이전 원가 미등록</span>;
  return <div style={{ minWidth: 200, fontSize: 11, textAlign: 'left' }}>
    {history && <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4,fontSize:13}}>
      <button type="button" aria-label="이전 차수 도착원가" disabled={position<=0} onClick={()=>setSelectedWeek(weeks[position-1])}>◀</button>
      <b>{currentWeek} {position===weeks.length-1?'최신 원가':'과거 원가'}</b>
      <button type="button" aria-label="다음 차수 도착원가" disabled={position>=weeks.length-1} onClick={()=>setSelectedWeek(weeks[position+1])}>▶</button>
      {position!==weeks.length-1 && <button type="button" onClick={()=>setSelectedWeek(null)}>최신</button>}
    </div>}
    <div style={{ color: '#475569', marginBottom: 3 }}>농장별 원가 · {refs.length}건</div>
    <div role="region" aria-label="농장별 도착원가" tabIndex={0}>
    {refs.map(ref => { const comparison=compareHotelArrival(ref,rates); return <div key={ref.referenceKey} style={{ padding: '3px 0', borderBottom: '1px solid #e2e8f0', whiteSpace: 'normal',fontSize:12 }} title={`${ref.sourceFile || ''} / ${ref.sourceSheet || ''} ${ref.sourceRow || ''}행 · ${ref.farm || ''} · 원본 ${fmt(ref.rawCost)}원/${ref.rawUnit || '단위 미확인'}${ref.sourceStemsPerBunch ? ` · 원본 단당 ${ref.sourceStemsPerBunch}송이` : ''}`}>
      <span style={{ fontWeight: 600 }}>{ref.farm || '농장 미기재'}</span>{' · '}
      <b style={{ color: '#0369a1' }}>{ref.week}</b> {ref.conversionError ? <span style={{ color: '#b45309' }}>{ref.conversionError} (원본 {fmt(ref.rawCost)}원/{ref.rawUnit || '?'})</span> : <b>{fmt(comparison.cost)}원/{ref.unit}</b>}
      {!history && ref.isFallback && <span style={{ color: '#c2410c' }}> · 이전 최신</span>}
      {!history && ref.isNextHotelWeek && <span style={{ color: '#0369a1' }}> · 호텔 다음 1차</span>}
      {ref.sourceKind==='INVOICE' && <span> · 인보이스 승인{ref.expenseBasis==='ESTIMATED'?' (비용 추정)':''}</span>}
      {comparison.applied && <div style={{color:'#047857'}}>환율 비교 {ref.currency} {fmtRate(rates[ref.currency])} · 원본 {fmt(ref.cost)}원</div>}
      {!comparison.applied && Object.values(rates).some(Boolean) && comparison.reason && <div style={{color:'#b45309'}}>{comparison.reason} · 원본 유지</div>}
      <div style={{ color: '#64748b', fontSize: 10 }}>{ref.sourceSheet || '시트 미기재'}{ref.sourceRow ? ` ${ref.sourceRow}행` : ''}</div>
    </div>;})}
    </div>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ fontSize: 11, padding: '2px 6px', marginTop: 3 }}>환율로 원가 비교</button>
    {open && <div style={{ padding: 6, border: '1px solid #99f6e4', background: '#f0fdfa', maxWidth: 290, maxHeight: 300, overflowY: 'auto', whiteSpace: 'normal' }}>
      <label>비교 환율 <input aria-label="도착원가 비교 환율" inputMode="decimal" value={fx} onChange={e => setFx(e.target.value)} style={{ width: 75 }} /> 원</label>
      {refs.map(ref => {
        const result = compareHotelArrival(ref,ref.currency ? {[ref.currency]:fx} : {});
        const cost = result.applied ? result.cost : null;
        return <div key={ref.referenceKey} style={{ marginTop: 4 }}><b>{ref.farm || '농장 미기재'} · {ref.week}</b> · {ref.currency || '통화 미확인'} 원본 환율 {ref.exchangeRate ? fmtRate(ref.exchangeRate) : '없음'}<br />
          {cost != null ? <>비교 추정 <b>{fmt(cost)}원/{ref.unit}</b> · 차이 {fmt(cost - ref.cost)}원</> : (result.reason || '비교 환율을 입력하세요.')}
        </div>;
      })}
      <div style={{ color: '#64748b', marginTop: 5 }}>VAT 별도 · 원화 통관비 고정, 나머지 원가에 입력 환율을 적용한 비교 추정값입니다. 원본 수식 재계산이 아니며 저장·엑셀에는 반영하지 않습니다.</div>
    </div>}
  </div>;
}
