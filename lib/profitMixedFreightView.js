import { computeColombiaRatios } from './customsForwardingCalc.js';
import { calcPurchaseRatio, displayedProfitRate, TOTALS_EXCLUDED_CATEGORIES } from './profitReportCalc.js';

const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.01;
const key=r=>`${r.orderYear}|${r.orderWeek}|${r.warehouseKey}|${r.warehouseDetailKey}`;
export function assertFreightConservationForCache(payload){
  const ledger=payload?.forwardingReconciliation;
  if(!ledger)return;
  const count=(ledger.unmatchedRows||[]).filter(r=>Math.abs(Number(r.amount)||0)>.000001).length;
  if(count||Math.abs(Number(ledger.classificationDelta)||0)>.01
    ||Object.values(ledger.totalsByCurrency||{}).some(x=>Math.abs(Number(x.delta)||0)>.01)){
    throw Object.assign(new Error(`SQL 운임 ${count}건의 귀속 또는 배분 합계가 일치하지 않아 저장하지 않았습니다. 원천 운임 전표를 확인하세요.`),
      {code:'PROFIT_FREIGHT_UNMAPPED',statusCode:409});
  }
}
// Recover only previously excluded, unchanged SQL rows. Never replace a manual
// cost, recalculate unrelated history, or persist this display projection.
export function mixedFreightDeltas(payload,ledger,{orderYear,major}) {
  if(String(payload?.orderYear)!==String(orderYear)||Number(payload?.major)!==Number(major))return {};
  const recovered=new Map((ledger?.classifiedRows||[]).filter(r=>r.category==='콜롬비아 4품목').map(r=>[key(r),r]));
  const usd={},seen=new Set();
  for(const old of payload.forwardingReconciliation?.unmatchedRows||[]){
    if(seen.has(key(old)))continue;seen.add(key(old));
    const now=recovered.get(key(old));
    if(!now||!close(old.amount,now.amount))continue;
    const allocation=payload.colombiaAllocationEvidence?.find(x=>x.orderWeek===old.orderWeek&&x.erpWeight?.sources?.some(s=>s.pooledWithHydrangea&&String(s.awb).replace(/\D/g,'')===String(old.awb).replace(/\D/g,'')));
    if(!allocation)continue;
    const {weightRatio,cbmRatio}=computeColombiaRatios(allocation.boxQty,allocation.allocationRates);
    const ratios=allocation.weightBasis==='GW'?weightRatio:allocation.weightBasis==='CBM'?cbmRatio:null;
    if(!ratios||!close(Object.values(ratios).reduce((a,v)=>a+v,0),1))continue;
    for(const [cat,ratio]of Object.entries(ratios))usd[cat]=(usd[cat]||0)+now.amount*ratio;
  }
  const result={};
  for(const row of payload.rows||[]){
    const ds=usd[row.category];if(!ds)continue;
    const c=row.calc,v=row.inventoryValuation?.end;
    if(row.manual?.S!=null||row.manual?.F!=null||v?.method!=='category_average'
      ||!close(c.S,row.auto?.S)||!close(c.G,(c.Q+c.S)*c.R)
      ||!close(c.F,v.value)||!close(c.F,v.average?.unitCost*v.quantity)
      ||!(c.R>0)||!(v.average?.purchaseQty>0))continue;
    const G=ds*c.R,F=G/v.average.purchaseQty*v.quantity;
    result[row.category]={S:ds,G,F,originalF:c.F,average:{...v.average,
      unitCost:v.average.unitCost+G/v.average.purchaseQty,
      totalCost:v.average.totalCost+G,forwardingForeign:v.average.forwardingForeign+ds},source:'sql_mixed_awb_recovery'};
  }
  return result;
}

export function applyMixedFreightView(payload,current,previous={},ledger=null){
  if(payload?.mixedFreightView)return payload;
  const out=structuredClone(payload),deltas={};let changed=false;
  for(const row of out.rows||[]){
    const d=current[row.category]||{S:0,G:0,F:0};
    const prev=previous[row.category];
    // Carry only when the saved opening is demonstrably the same prior closing.
    const E=prev&&row.manual?.E==null&&close(row.calc.E,row.inventoryValuation?.begin?.value)
      &&close(row.calc.E,prev.originalF)?prev.F:0;
    if(!d.S&&!E)continue;
    const before={...row.calc},c=row.calc;
    Object.assign(c,{S:c.S+d.S,T:c.T+d.G,G:c.G+d.G,F:c.F+d.F,E:c.E+E});
    const costDelta=E+d.G-d.F;
    c.I=before.I===null?null:before.I+costDelta;
    c.J=before.J===null?null:before.J-costDelta;c.K=displayedProfitRate(c);
    row.auto={...row.auto,S:c.S,E:c.E,F:c.F};
    if(d.F){row.stock={...row.stock,evidenceValue:c.F};const v=row.inventoryValuation.end;v.value=c.F;v.average.totalCost+=d.G;v.average.forwardingForeign+=d.S;v.average.unitCost=v.value/v.quantity;}
    if(E){row.beginStock={...row.beginStock,evidenceValue:c.E};row.inventoryValuation.begin.value=c.E;
      if(prev.average)row.inventoryValuation.begin.average={...prev.average};}
    row.mixedFreightView={originalCalc:before,deltaS:d.S,deltaG:d.G,deltaF:d.F,deltaE:E};
    if(!TOTALS_EXCLUDED_CATEGORIES.includes(row.category))for(const k of ['S','T','G','F','E','I','J'])deltas[k]=(deltas[k]||0)+c[k]-before[k];
    changed=true;
  }
  if(!changed)return payload;
  for(const [k,v]of Object.entries(deltas))if(Number.isFinite(out.totals[k]))out.totals[k]+=v;
  out.totals.K=displayedProfitRate(out.totals);
  for(const row of out.rows)row.calc.U=calcPurchaseRatio(row.calc,out.totals);
  if(out.effectiveViewTotals)out.effectiveViewTotals={...out.totals};
  if(out.confirmedTotals)out.confirmedTotals={...out.totals};
  out.mixedFreightView={version:1,changed:true,label:'SQL 혼적 운임 누락 보완 · 저장 원본 보존'};
  // Remove only a resolved original warning, and only if the entire source set
  // still matches. Do not hide a new or unrelated incomplete freight source.
  const oldRows=payload.forwardingReconciliation?.sourceRows||[];
  const nowRows=new Map((ledger?.sourceRows||[]).map(r=>[key(r),r]));
  if(oldRows.length&&oldRows.length===nowRows.size&&oldRows.every(r=>close(r.amount,nowRows.get(key(r))?.amount))
    &&ledger.unmatchedRows.length===0){
    out.mixedFreightView.originalForwardingReconciliation=out.forwardingReconciliation;
    out.mixedFreightView.originalColombiaAllocationEvidence=structuredClone(out.colombiaAllocationEvidence||[]);
    const classified=new Map(ledger.classifiedRows.map(r=>[key(r),r]));
    for(const week of out.colombiaAllocationEvidence||[]){
      const extra=(payload.forwardingReconciliation.unmatchedRows||[]).filter(r=>r.orderWeek===week.orderWeek
        &&classified.get(key(r))?.category==='콜롬비아 4품목'
        &&week.erpWeight?.sources?.some(s=>s.pooledWithHydrangea&&String(s.awb).replace(/\D/g,'')===String(r.awb).replace(/\D/g,'')))
        .reduce((sum,r)=>sum+r.amount,0);
      if(!extra)continue;
      const ratios=computeColombiaRatios(week.boxQty,week.allocationRates);
      const ratio=week.weightBasis==='GW'?ratios.weightRatio:ratios.cbmRatio;
      week.airTotal+=extra;
      for(const [cat,part]of Object.entries(week.allocation))part.S+=extra*(ratio[cat]||0);
    }
    out.forwardingReconciliation=structuredClone(ledger);
    out.audit={...out.audit,issues:(out.audit?.issues||[]).filter(i=>i.code!=='FORWARDING_UNCLASSIFIED')};
  }
  out.audit={...out.audit,issues:[...(out.audit?.issues||[]),{severity:'info',code:'MIXED_AWB_FREIGHT_RECOVERED',
    category:'콜롬비아',columns:['S','E','F'],message:'SQL에 입력된 혼적 운임을 연결하고 평균원가 재고평가·다음 차수 기초를 보완했습니다. DB 저장 원본은 변경하지 않았습니다.'}]};
  out.financialReadPolicy={...out.financialReadPolicy,label:out.mixedFreightView.label};
  return out;
}
