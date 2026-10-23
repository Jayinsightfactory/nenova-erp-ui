import { latestReferenceKey } from '../lib/useLatestArrivalReferences.js';

export default function LatestArrivalReference({state,item}) {
  if(state.error) return <span role="status" style={{color:'#a33'}}>{state.error}</span>;
  if(state.loading) return <span>원가 조회 중…</span>;
  const refs=state.references[latestReferenceKey(item)] || [];
  if(!refs.length) return <span style={{color:'#64748b'}}>연결된 최신 원가 없음</span>;
  return <div style={{fontSize:12,lineHeight:1.5,whiteSpace:'normal',minWidth:160}}>{refs.map((ref,i)=><div key={`${ref.referenceKey}-${i}`} title={`${ref.sourceFile} · ${ref.sourceSheet}`}>
    <strong>{ref.conversionError || `${Number(ref.cost).toLocaleString('ko-KR',{maximumFractionDigits:2})}원/${ref.unit}`}</strong>
    <div>{ref.orderYear}/{ref.week} · {ref.farm || '농장 미기재'} · {ref.sourceKind==='INVOICE'?'승인 인보이스':'현재 엑셀'}</div>
  </div>)}</div>;
}
