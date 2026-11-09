import { calcRevenueRatio, displayedProfitRate, TOTALS_EXCLUDED_CATEGORIES, WORKBOOK_TAIL_CATEGORIES } from './profitReportCalc.js';

export const ESTIMATE_CALENDAR_VIEW_VERSION = 1;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (a,b) => finite(a) && finite(b) && Math.abs(a-b) < 0.01;

// This is a narrowly authorized display projection, NOT a snapshot refresh. Full
// raw L/O sources must reconcile before any covered off-time delta is certified.
export function applyProfitEstimateCalendarView(payload, evidence, {orderYear,major}) {
  if (payload?.estimateCalendarView) return payload;
  const result = structuredClone(payload);
  const diagnostics = [];
  const scopeMatches = String(evidence?.orderYear) === String(orderYear) && Number(evidence?.major) === Number(major)
    && (payload.orderYear == null || String(payload.orderYear) === String(orderYear))
    && (payload.major == null || Number(payload.major) === Number(major));
  let changed = false;
  let deltaC=0,deltaJ=0,deltaL=0,deltaO=0;
  for (const row of result.rows || []) {
    const source=scopeMatches ? evidence.byCategory?.[row.category] : null;
    if (!source?.offTimeCount && !source?.missingDateCount) continue;
    const detail={category:row.category,offTimeCount:source.offTimeCount,missingDateCount:source.missingDateCount};
    if (source.missingDateCount) diagnostics.push({...detail,status:'calendar_date_missing'});
    if (!source.offTimeCount) continue;
    if (result.confirmed || result.readMode==='confirmed') {
      diagnostics.push({...detail,status:'confirmed_preserved'});
      continue;
    }
    const certified=['C','L','O'].every(k=>finite(result.totals?.[k]))
      && (result.totals.J===null || finite(result.totals.J))
      && ['L','O'].every(k=>same(row.auto?.[k],source.raw?.[k]) && same(row.calc?.[k],row.auto?.[k])
      && finite(source.offTime?.[k]));
    if (!certified || !finite(row.calc?.C) || !(row.calc.J === null || finite(row.calc.J))) {
      diagnostics.push({...detail,status:'source_mismatch'});
      continue;
    }
    const dl=-source.offTime.L, dO=-source.offTime.O, dc=dl+dO;
    row.estimateCalendarView={version:ESTIMATE_CALENDAR_VIEW_VERSION,originalCalc:{...row.calc},originalSources:{L:row.auto.L,O:row.auto.O},deltaL:dl,deltaO:dO};
    row.auto={...row.auto,L:row.auto.L+dl,O:row.auto.O+dO};
    row.calc={...row.calc,L:row.calc.L+dl,O:row.calc.O+dO,C:row.calc.C+dc,J:row.calc.J===null?null:row.calc.J+dc};
    row.calc.K=displayedProfitRate(row.calc);
    row.calc.M=row.calc.C===0?null:-row.calc.L/row.calc.C;
    // All original cost and inventory cells, including I and U, stay unchanged.
    if (!TOTALS_EXCLUDED_CATEGORIES.includes(row.category)) {
      deltaC+=dc;if(row.calc.J!==null)deltaJ+=dc;
      if (!WORKBOOK_TAIL_CATEGORIES.includes(row.category)) {deltaL+=dl;deltaO+=dO;}
    }
    changed=true;
    diagnostics.push({...detail,status:'applied',deltaL:dl,deltaO:dO});
  }
  if (changed) {
    const totals={...result.totals};
    for (const [key,delta] of Object.entries({C:deltaC,J:deltaJ,L:deltaL,O:deltaO})) {
      if (finite(totals[key])) totals[key]+=delta;
    }
    totals.K=displayedProfitRate(totals);
    totals.M=totals.C===0?null:-totals.L/totals.C;
    totals.D=totals.C===0?null:1;
    result.totals=totals;
    // Older snapshots may carry derived-view totals; keep canonical consumers aligned.
    if (result.effectiveViewTotals) result.effectiveViewTotals={...totals};
    for (const row of result.rows) row.calc={...row.calc,D:calcRevenueRatio(row.calc,totals)};
    result.financialReadPolicy={...result.financialReadPolicy,label:'과거 저장 원가 고정 · EXE 달력 차감 표시 보완'};
  }
  if (!scopeMatches || evidence?.failed) diagnostics.push({status:evidence?.failed?'source_unavailable':'scope_mismatch'});
  if (!diagnostics.length) return payload;
  result.estimateCalendarView={version:ESTIMATE_CALENDAR_VIEW_VERSION,changed,diagnostics,
    label:changed?'EXE 달력 일치 차감 표시 보완 · 저장 원본 미변경':'EXE 달력 차감 확인 필요 · 저장 원본 보존'};
  const issues=diagnostics.filter(d=>d.status!=='applied').map(d=>({severity:'warning',category:d.category,
    code:'ESTIMATE_CALENDAR_REVIEW',columns:['L','O'],
    message:d.status==='confirmed_preserved'?'확정 원본 차감은 보존했습니다. EXE 달력 일치 범위를 별도로 확인하세요.'
      :d.status==='calendar_date_missing'?'차감 일자의 달력 근거가 없어 과거 저장 금액은 보존했습니다.'
      :'차감 원천을 과거 저장본과 대조할 수 없어 금액은 보존했습니다.'}));
  if (changed) issues.push({severity:'warning',code:'ESTIMATE_CALENDAR_VIEW',columns:['L','O'],
    message:'EXE 달력 날짜의 시각 불일치 차감을 표시에서 제외했습니다. 다른 원가·재고와 저장 원본은 변경하지 않았습니다.'});
  result.audit={...result.audit,issues:[...(result.audit?.issues||[]),...issues]};
  return result;
}
