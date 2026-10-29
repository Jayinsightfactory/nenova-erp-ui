import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from './profitReportCalc.js';

export const TEMPLATE_DUTY_VERSION = '2026-10-29-v1';
export const dutyNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export const dutyName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const TARGETS = new Set(['태국','호주','중국','에콰도르']);
const APPROVED_FX_SOURCES=new Set(['freight_cost_snapshot','saved_official_week','excel_historical_snapshot','kcs_api','manual_input','manual','approved_customs_timing_estimate']);

export function resolveTemplateDutyRule(line, policy, year) {
  if (String(year) !== '2026' || String(line.orderYear) !== String(year)) return null;
  const rule = policy.products.find(p => Number(p.prodKey) === Number(line.prodKey));
  if (!rule || dutyName(rule.country) !== dutyName(line.country) || dutyName(rule.name) !== dutyName(line.name)) return null;
  return rule;
}

export function calculateTemplateDuty({year,major,category,row,lines=[],customsRow,policy}) {
  if (String(year) !== '2026' || !TARGETS.has(category)) return {applies:false};
  const current = lines.filter(l => String(l.orderYear) === String(year) && Number(String(l.orderWeek).split('-')[0]) === Number(major) && l.category === category && l.active !== false);
  const missing=[],details=[];
  let total=0;
  for (const half of [1,2]) {
    const actual=dutyNumber(customsRow?.[`Customs${half}`]);
    if (actual != null) { total+=actual;details.push({half,amount:actual,source:'stored_or_historical'});continue; }
    for (const line of current.filter(l=>Number(String(l.orderWeek).split('-')[1])===half)) {
      if (dutyNumber(line.actualDuty)!=null) {total+=Number(line.actualDuty);details.push({half,line:line.warehouseDetailKey,amount:line.actualDuty,source:'freight_snapshot'});continue;}
      const rule=resolveTemplateDutyRule(line,policy,year);
      if (!rule) {missing.push({prodKey:line.prodKey,name:line.name,reason:'승인된 품목별 관세율 미확인'});continue;}
      if (rule.rate===0) {details.push({half,line:line.warehouseDetailKey,amount:0,source:'approved_template',rate:0});continue;}
      const goods=dutyNumber(line.goodsForeign),freight=dutyNumber(line.freightForeign);
      const fx=dutyNumber(line.storedExchangeRate) ?? dutyNumber(row.calc?.R ?? row.manual?.R ?? row.auto?.R);
      const fxSource=dutyNumber(line.storedExchangeRate)>0?'freight_cost_snapshot':dutyNumber(row.manual?.R)>0?'manual_input':row.source?.R;
      if (goods==null || freight==null || !(fx>0) || line.currency!==row.currency || !APPROVED_FX_SOURCES.has(fxSource)) {
        missing.push({prodKey:line.prodKey,name:line.name,reason:'같은 입고의 CNF·운임·통화·환율 근거 미확인'});continue;
      }
      const amount=(goods+freight)*fx*rule.rate;
      total+=amount;details.push({half,line:line.warehouseDetailKey,amount,source:'approved_template',rate:rule.rate,fx,fxSource,fxEstimated:fxSource==='approved_customs_timing_estimate',goods,freight,ruleIds:rule.ruleIds,awb:line.awb});
    }
  }
  if(current.some(l=>![1,2].includes(Number(String(l.orderWeek).split('-')[1])))) missing.push({reason:'관세 입력 반차수 범위 밖 입고'});
  const oldDuty=dutyNumber(row.actualCostEvidence?.components?.customs)
    ?? (row.customsComponents ? (dutyNumber(row.customsComponents.Customs1)??0)+(dutyNumber(row.customsComponents.Customs2)??0) : null);
  const calcH=dutyNumber(row.calc?.H ?? row.auto?.H);
  const manual=dutyNumber(row.manual?.H);
  if(manual!=null || row.source?.H==='manual') return {applies:true,total,deltaH:0,H:manual??calcH,status:'manual_preserved',missing:[],details};
  if(!current.length && total===0) return {applies:true,total:0,deltaH:0,H:calcH,status:'no_inbound',missing:[],details};
  if(oldDuty==null || calcH==null) missing.push({reason:'저장본의 기존 관세·비관세 비용 구분 근거 없음'});
  return {applies:true,total:missing.length?null:total,knownTotal:total,oldDuty,
    deltaH:missing.length?null:total-oldDuty,H:missing.length?null:calcH-oldDuty+total,
    status:missing.length?'input_required':details.some(d=>d.source==='approved_template')?'approved_estimate':'actual_preserved',missing,details};
}

function revalue(basis, oldValue, newH, affected, year, major, oldH) {
  if(!affected) return {value:oldValue,basis};
  if(basis?.method==='no_stock' && basis.quantity===0) return {value:0,basis};
  if(basis?.method!=='category_average' || !(dutyNumber(basis.average?.purchaseQty)>0)
    || String(basis.year)!==String(year) || Number(basis.major)!==Number(major)
    || dutyNumber(basis.quantity)==null || dutyNumber(basis.average?.customsCost)==null || dutyNumber(oldValue)==null || dutyNumber(newH)==null
    || dutyNumber(basis.average?.totalCost)==null
    || dutyNumber(oldH)==null || Math.abs(Number(basis.average?.customsCost)-oldH)>0.01
    || Math.abs(oldValue-basis.average.totalCost*basis.quantity/basis.average.purchaseQty)>0.01)
    return {value:null,basis:{...basis,dutyReviewRequired:true},missing:true};
  const delta=newH-Number(basis.average.customsCost);
  const value=oldValue+delta*basis.quantity/basis.average.purchaseQty;
  return {value,basis:{...basis,value,estimated:true,average:{...basis.average,customsCost:newH,
    totalCost:basis.average.totalCost+delta,unitCost:basis.average.unitCost+delta/basis.average.purchaseQty}}};
}

export function applyTemplateDutyView(payload,{year,major,policy,lines,customsByWeek={},previousPayload,sourceFailure}={}) {
  if(String(year)!=='2026' || payload?.templateDuty?.version===TEMPLATE_DUTY_VERSION) return payload;
  const result=structuredClone(payload),prevMajor=String(Number(major)-1).padStart(2,'0');
  for(const row of result.rows||[])row.calc=row.calc||computeProfitRow(row);
  const priorRows=previousPayload?.rows || [];
  for(const row of result.rows || []) {
    if(!TARGETS.has(row.category)) continue;
    const original=row.calc || computeProfitRow(row);
    row.calc=original;
    const current=calculateTemplateDuty({year,major,category:row.category,row,lines,policy,customsRow:customsByWeek[String(major).padStart(2,'0')]?.[row.category]});
    const prev=priorRows.find(r=>r.category===row.category);
    const previous=prev ? calculateTemplateDuty({year,major:prevMajor,category:row.category,row:prev,lines,policy,customsRow:customsByWeek[prevMajor]?.[row.category]}) : null;
    if(sourceFailure && current.status!=='manual_preserved') {current.H=null;current.deltaH=null;current.status='input_required';current.missing.push({reason:sourceFailure});}
    const end=revalue(row.inventoryValuation?.end,original.F,current.H,current.deltaH!==0,year,major,original.H);
    const beginAffected=Number(major)>1 && (previous ? previous.deltaH!==0 : row.inventoryValuation?.begin?.method!=='no_stock');
    const begin=revalue(row.inventoryValuation?.begin,original.E,previous?.H,beginAffected,year,prevMajor,prev?.calc?.H??prev?.auto?.H);
    const held=current.H==null || end.missing || begin.missing;
    row.templateDuty={...current,originalCalc:{...original},inventoryHeld:!!(end.missing||begin.missing)};
    row.calculationFrozen=true;
    row.auto={...row.auto,H:current.H,E:begin.value,F:end.value};
    row.stock={...row.stock,evidenceValue:end.value,priceEvidenceStatus:end.missing?'INPUT_REQUIRED':row.stock?.priceEvidenceStatus};
    row.beginStock={...row.beginStock,evidenceValue:begin.value};
    row.inventoryValuation={...row.inventoryValuation,begin:begin.basis,end:end.basis};
    row.source={...row.source,H:current.H==null?'actual_cost_missing':current.status==='manual_preserved'?'manual':current.status==='approved_estimate'?'approved_template_duty':row.source?.H};
    const noEnd=row.variant==='noEnding';
    const I=held||original.G==null||begin.value==null||(!noEnd&&end.value==null)?null:begin.value+original.G+current.H-(noEnd?0:end.value);
    const J=I==null||end.value==null?null:original.C-I+(noEnd?end.value:0)+(original.AJ??0);
    const denominator=original.C+(noEnd?(end.value??0):0);
    row.calc={...original,H:current.H,E:begin.value,F:end.value,I,J,K:J==null||!denominator?null:J/denominator};
  }
  const totals=computeProfitTotals(result.rows);
  for(const row of result.rows) row.calc={...row.calc,D:calcRevenueRatio(row.calc,totals),U:calcPurchaseRatio(row.calc,totals)};
  result.templateDuty={version:TEMPLATE_DUTY_VERSION,approvedEstimate:true,sourceYearsVerified:false,
    derivedFromConfirmed:!!payload.confirmed,originalTotals:payload.confirmedTotals||payload.totals||null,
    label:'저장본 기반 관세 보완(추정 포함) · 원본 확정본·DB 미변경'};
  const issues=(result.rows||[]).filter(r=>r.templateDuty?.missing?.length||r.templateDuty?.inventoryHeld).map(r=>({
    code:'TEMPLATE_DUTY_BASIS_MISSING',severity:'error',category:r.category,columns:['H','E','F','K'],
    message:`${r.category}: 관세 또는 재고 재평가 근거 확인 필요`,
    detail:{summary:[...(r.templateDuty.missing||[]).map(x=>`${x.name||''} ${x.reason}`),...(r.templateDuty.inventoryHeld?['기초·기말 평가에 필요한 동일 차수 평균식 근거 없음']:[])].join('; '),sections:[]}}));
  const warnings=result.rows.filter(r=>r.templateDuty?.status==='approved_estimate').map(r=>({
    code:'TEMPLATE_DUTY_ESTIMATE',severity:'warning',category:r.category,columns:['H','E','F','K'],
    message:`${r.category}: 승인된 품목별 양식 관세를 추정 반영했습니다. 실제 납부 확정액이 아니며 원본 DB는 변경하지 않았습니다.`,
    detail:{summary:`관세 ${r.templateDuty.total?.toLocaleString()}원 · 기존 관세 대비 ${r.templateDuty.deltaH?.toLocaleString()}원`,sections:[]}}));
  const allIssues=[...(result.audit?.issues||[]).filter(i=>!(i.code==='APPROVED_CUSTOMS_ESTIMATE'&&result.rows.some(r=>r.category===i.category&&r.templateDuty))),...issues,...warnings];
  const errorCount=allIssues.filter(i=>i.severity==='error').length,warningCount=allIssues.filter(i=>i.severity==='warning').length;
  result.audit={...result.audit,status:errorCount?'needs_input':warningCount?'needs_review':'ready',issues:allIssues,errorCount,warningCount};
  result.effectiveViewTotals=totals;result.totals=totals;
  if(payload.confirmed){result.originalConfirmedTotals=payload.confirmedTotals;result.confirmedTotals=totals;}
  result.snapshot={...result.snapshot,templateDuty:result.templateDuty};
  return result;
}
