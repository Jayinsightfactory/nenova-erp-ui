const labels={E:'기초재고',F:'기말재고',G:'매입·운임',H:'그외통관비',R:'환율'};
const period=value=>{const n=Number(value);return Number.isFinite(n)?`${Math.floor(n/1000000)}년 ${Math.floor(n%1000000/10000)}차`:String(value);};
const fmt=value=>value==null?'미확인':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:3});
const level=value=>({same_product:'같은 품목',same_product_purchase:'같은 품목 실제 매입',same_country_variety:'같은 국가·품종',same_country:'같은 국가',product_reference_period:'같은 품목 참고기간',variety_reference_period:'같은 품종 참고기간',country_reference_period:'같은 국가 참고기간',reference_conversion:'참고기간 환산'}[value]||value||'기존 원본');
function ItemBasis({evidence}){const entries=Object.entries(evidence).flatMap(([column,e])=>(e.details||e.items||[]).map(item=>({column,...item})));if(!entries.length)return null;
 return <details><summary>품목별 원가·환산 근거 {entries.length}건</summary><div style={{maxHeight:280,overflow:'auto'}}>{entries.slice(0,80).map((item,index)=><div key={index} style={{padding:'4px 0',borderBottom:'1px solid #e2e8f0'}}>
  {labels[item.column]||item.column} · {item.name||`품목 #${item.prodKey}`} · 적용 {item.physicalStemConversionApplied===false||item.nativeCustoms?`${fmt(item.rawQuantity??item.quantity)}${item.rawUnit??item.unit} (원래 단위 보존)`: `${fmt(item.stems)}송이`}
  {item.physicalStemConversionApplied===false||item.nativeCustoms?<div>송이 환산 없이 실제 입고·재고 단위로 계산한 승인 평균 보완입니다. FIFO·실제 납부 인증이 아닙니다. 상품 {fmt(item.goodsPerUnit)}원/단위 + 운임 {fmt(item.freightPerUnit)}원/단위 + 통관 {fmt(item.customsPerUnit)}원/단위 · 근거 {(item.sourcePeriods||item.nativeCustoms?.sourcePeriods||[]).map(period).join(', ')}</div>:<>
  <div>환산: {item.rawQuantity!=null?`${fmt(item.rawQuantity)}${item.rawUnit} → `:''}{item.conversion?.factor!=null?`${fmt(item.conversion.factor)}송이/단위 (${level(item.conversion.level)})`:'원입고 송이수'} · 당시 실포장 인증: {item.conversion?.historicalPackingVerified===false?'아님':'원천 기준'}</div>
  <div>송이당 상품 {fmt(item.purchase?.goodsPerStem??item.cost?.goodsPerStem)}원 + 운임 {fmt(item.cost?.freightPerStem)}원 + 통관 {fmt(item.cost?.customsPerStem)}원 · {level(item.cost?.level)}</div>
  <div>매입/비용 근거 {item.purchase?.sourceCount||item.cost?.sourceCount||0}건 · {(item.cost?.sourcePeriods||[]).map(period).join(', ')}{item.purchase?.rateReference?' · 매입 외화금액 유지, 같은 통화 참고기간 가중환율 적용':''}</div>
  </>}
 </div>)}{entries.length>80&&<div>상위 80건 표시 / 전체 근거는 보고서 계산 데이터에 보존됩니다.</div>}</div></details>;
}
export default function ProfitAverageEvidence({data}){
 const rows=(data?.rows||[]).filter(row=>row.averageFallback);
 if(!rows.length)return null;
 return <details style={{border:'1px solid #cbd5e1',borderRadius:6,padding:'8px 12px',margin:'8px 0',fontSize:12}}>
  <summary style={{cursor:'pointer'}}>계산 기준 · 원가·환산 보완 {rows.length}개 국가·품종{rows.filter(row=>row.inventoryValuation?.end?.valuationBasisChange).map(row=>{const b=row.inventoryValuation.end.valuationBasisChange;return <span key={row.category}> · {row.category} 현재 SQL 재고 {fmt(b.currentQuantity)}{b.currentUnit||'단위 미확인'} 기준 (저장 당시 {fmt(b.previousQuantity)}{b.previousUnit||'단위 미확인'}, 원본 보존)</span>;})}</summary>
  <p>확인된 매입금액·수기 입력은 유지하고 누락 성분만 같은 품목, 같은 품종, 같은 국가의 수량 가중평균으로 계산합니다. 평가시점 자료가 부족하면 표시된 참고기간 자료를 사용하며, 당시 실제 납부·포장을 인증하는 값은 아닙니다. DB와 확정 원본은 변경하지 않습니다.</p>
  <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>국가·품종</th><th>보완 항목·금액</th><th>적용 자료기간·남은 확인</th></tr></thead><tbody>
   {rows.map(row=>{const evidence=row.averageFallback.evidence||{},periods=new Set(),methods=new Set(),stockChanges=new Set();
    for(const e of Object.values(evidence)){if(e.timing)periods.add(e.timing.date);if(e.method==='approved_native_unit_acquisition')stockChanges.add(`현재 SQL 품목별 재고 ${fmt(e.quantity)}${e.unit||' (혼합단위)'} 기준 승인 평균 재평가 · 저장 당시 FIFO 원본 보존`);for(const item of [...(e.details||[]),...(e.items||[])]){for(const p of item.cost?.sourcePeriods||item.sourcePeriods||item.nativeCustoms?.sourcePeriods||[])periods.add(period(p));for(const p of item.purchase?.sourcePeriods||[])periods.add(period(p));if(item.cost?.level)methods.add(item.cost.level);const d=item.snapshotBasisChange;if(d)stockChanges.add(`${d.year}년 ${d.week} 재고 기준: 저장 당시 ${d.previousQuantity} → 현재 ${d.currentQuantity}${d.unit} (StockKey ${d.stockKey}, 원본 보존)`);}}
    return <tr key={row.category}><td>{row.category}</td><td>{Object.keys(evidence).map(k=>`${labels[k]||k}: ${row.calc?.[k]==null?'확인 필요':Number(row.calc[k]).toLocaleString('ko-KR',{maximumFractionDigits:2})}`).join(' / ')}<ItemBasis evidence={evidence}/></td><td>{[...periods].join(', ')||'동일 재고스냅샷·원본 입력 근거'}{methods.size>0&&<div>동일 품목·품종 우선, 적용 기간별 비용 합계 ÷ 송이수 합계</div>}{[...stockChanges].map(s=><div key={s}>{s}</div>)}{row.averageFallback.missing?.length>0&&<div>추가 확인: {row.averageFallback.missing.join(', ')}</div>}</td></tr>;
   })}
  </tbody></table>
 </details>;
}
