import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from './profitReportCalc.js';

export const TEMPLATE_DUTY_VERSION = '2026-11-06-china-v5';
export const dutyNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export const dutyName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const TARGETS = new Set(['태국','호주','중국','에콰도르']);
const APPROVED_FX_SOURCES=new Set(['freight_cost_snapshot','saved_official_week','excel_historical_snapshot','kcs_api','manual_input','manual','approved_customs_timing_estimate']);

// Additive explanations only: these functions never select a rule or change a verdict.
function dutySourceRef(line) {
  return {orderYear:line.orderYear,orderWeek:line.orderWeek,warehouseDetailKey:line.warehouseDetailKey,
    ...(line.awb?{awb:line.awb}:{}),
    ...(line.sourceCountry!==undefined?{productCountry:line.sourceCountry,reportCountry:line.country,
      inferredCurrency:line.currency,currencySource:'product_country_majority_inference'}:{})};
}
// Do not collapse 01B into 01 or 03A into 03. The actual subweek remains the key.
const numericSubweek = value => {
  const match=/^\d{1,2}-(\d{1,2})$/.exec(String(value||''));
  return match && Number(match[1])>=1 && Number(match[1])<=99 ? Number(match[1]) : null;
};
const sameReceiptWeek=(a,b)=>{
  const left=/^(\d{1,2})-(\d{1,2})$/.exec(String(a||''));
  const right=/^(\d{1,2})-(\d{1,2})$/.exec(String(b||''));
  return !!left&&!!right&&Number(left[1])===Number(right[1])&&Number(left[2])===Number(right[2]);
};
function revalueDiagnostic(basis,oldValue,newH,year,major,oldH) {
  const failed=[];
  if(basis?.method!=='category_average')failed.push(basis?.method==='product_cost'?'PRODUCT_COST_REQUIRES_ITEM_EVIDENCE':'VALUATION_METHOD_UNSUPPORTED');
  if(!(dutyNumber(basis?.average?.purchaseQty)>0))failed.push('PURCHASE_QUANTITY_UNCONFIRMED');
  if(String(basis?.year)!==String(year)||Number(basis?.major)!==Number(major))failed.push('VALUATION_PERIOD_MISMATCH');
  if(dutyNumber(basis?.quantity)==null)failed.push('INVENTORY_QUANTITY_UNCONFIRMED');
  if(dutyNumber(basis?.average?.customsCost)==null)failed.push('AVERAGE_CUSTOMS_UNCONFIRMED');
  if(dutyNumber(oldValue)==null)failed.push('ORIGINAL_VALUE_UNCONFIRMED');
  if(dutyNumber(newH)==null)failed.push('CUSTOMS_DEPENDENCY_UNCONFIRMED');
  if(dutyNumber(basis?.average?.totalCost)==null)failed.push('AVERAGE_COST_UNCONFIRMED');
  if(dutyNumber(oldH)==null)failed.push('ORIGINAL_CUSTOMS_UNCONFIRMED');
  if(dutyNumber(basis?.average?.customsCost)!=null && dutyNumber(oldH)!=null
    && Math.abs(Number(basis.average.customsCost)-oldH)>0.01)failed.push('CUSTOMS_BASIS_MISMATCH');
  if(dutyNumber(oldValue)!=null && dutyNumber(basis?.average?.totalCost)!=null && dutyNumber(basis?.quantity)!=null
    && dutyNumber(basis?.average?.purchaseQty)>0
    && Math.abs(oldValue-basis.average.totalCost*basis.quantity/basis.average.purchaseQty)>0.01)failed.push('VALUATION_FORMULA_MISMATCH');
  return {failed,year:String(year),major:String(major),method:basis?.method || null};
}

export function resolveTemplateDutyRule(line, policy, year) {
  if (String(year) !== '2026' || String(line.orderYear) !== String(year)) return null;
  const workbook=policy.workbook;
  if(workbook?.orderYear==='2026'){
    const exact=p=>Number(p.prodKey)===Number(line.prodKey)
      &&dutyName(p.country)===dutyName(line.country)&&dutyName(p.exactName)===dutyName(line.name);
    // A scoped source cell wins over a general product-form rule. Never collapse
    // suffixes or assume an AWB/certificate from a product's name.
    const scoped=(workbook.exceptions||[]).filter(p=>exact(p)
      &&sameReceiptWeek(p.orderWeek,line.orderWeek)&&(!p.awb||p.awb===line.awb));
    const defaults=(workbook.products||[]).filter(exact);
    const candidates=scoped.length?scoped:defaults;
    if(candidates.length){
      const rates=new Set(candidates.map(p=>p.rate));
      if(rates.size!==1||!candidates.every(p=>Number.isFinite(p.rate)&&p.rate>=0&&p.rate<=1))return null;
      const rule=candidates[0];
      return {prodKey:rule.prodKey,name:rule.exactName,country:rule.country,rate:rule.rate,
        ruleIds:[`WORKBOOK2026:${rule.prodKey}:${scoped.length?rule.orderWeek:'approved-form'}`],
        workbookEvidence:{source:rule.source,matchLevel:rule.matchLevel,
          ...(rule.sourceOrderWeek?{sourceOrderWeek:rule.sourceOrderWeek}:{}),
          ...(rule.condition?{condition:rule.condition}:{}),
          ...(rule.referenceProdKey?{referenceProdKey:rule.referenceProdKey}:{}),
          scope:scoped.length?'exact_receipt_week':'approved_exact_product',
          ...(scoped.length?{orderWeek:rule.orderWeek,...(rule.awb?{awb:rule.awb}:{})}:{}),
          actualDeclarationVerified:false,certificateOfOriginVerified:false}};
    }
  }
  const official=policy.official?.products?.find(p=>Number(p.prodKey)===Number(line.prodKey));
  if(official && dutyName(official.country)===dutyName(line.country)
    &&dutyName(official.exactName)===dutyName(line.name)
    &&policy.official.orderYear==='2026'&&official.effectiveFrom==='2026-01-01'&&official.effectiveTo==='2026-12-31'){
    return {prodKey:official.prodKey,name:official.exactName,country:official.country,rate:official.rate,
      ruleIds:[`KCS2026:${official.hs}:${official.rateType}`],officialEvidence:{
        hs:official.hs,rateType:official.rateType,sourceUrl:policy.official.sourceUrl,
        effectiveFrom:official.effectiveFrom,effectiveTo:official.effectiveTo,
        classificationStatus:official.matchLevel,condition:official.condition,
        ...(official.referenceProdKey?{referenceProdKey:official.referenceProdKey,referenceAwbs:official.referenceAwbs || [],newDeclarationVerified:false}:{}),
        shipmentQuantityMatchVerified:false,actualDeclarationVerified:false}};
  }
  const rule = policy.products.find(p => Number(p.prodKey) === Number(line.prodKey));
  if (!rule || dutyName(rule.country) !== dutyName(line.country) || dutyName(rule.name) !== dutyName(line.name)) {
    const recovery=policy.chinaRecovery;
    const exact=recovery?.orderYear==='2026'&&dutyName(line.country)==='중국'
      ? recovery.products.find(p=>Number(p.prodKey)===Number(line.prodKey)&&dutyName(p.country)===dutyName(line.country)&&dutyName(p.exactName)===dutyName(line.name)):null;
    if(!exact)return null;
    return {...exact,name:exact.exactName,ruleIds:[`CHINA_APPROVED_FORM:${exact.prodKey}:${exact.referenceProdKey}`],
      workbookEvidence:{source:exact.source,matchLevel:exact.matchLevel,referenceProdKey:exact.referenceProdKey,
        condition:exact.condition,scope:'approved_exact_product_form_reference',actualDeclarationVerified:false,certificateOfOriginVerified:false}};
  }
  return rule;
}

// Only the read-only historical fallback is corrected. A real SQL value,
// including zero, never enters this function and remains authoritative.
export function restoreHistoricalDutyBlank(historical,year,major,category){
  if(!historical||String(year)!=='2026'||Number(major)!==27||category!=='중국'
    ||historical.Customs2!==0)return historical;
  return {...historical,Customs2:null,historicalDutyBlank:{field:'Customs2',sheet:'그외통관비',cell:'J10',
    sourceSha256:'2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689',
    reason:'원본 빈칸을 기존 역사 추출기가 0으로 변환한 값; 납부 관세 0원 근거 아님'}};
}

export function calculateTemplateDuty({year,major,category,row,lines=[],customsRow,policy}) {
  if (String(year) !== '2026' || !TARGETS.has(category)) return {applies:false};
  const current = lines.filter(l => String(l.orderYear) === String(year) && Number(String(l.orderWeek).split('-')[0]) === Number(major) && l.category === category && l.active !== false);
  const missing=[],details=[];
  let total=0;
  const halves=[1,2,...new Set(current.map(l=>numericSubweek(l.orderWeek)).filter(n=>n>2))];
  // Customs1/2 contain no AWB/receipt linkage. A positive saved aggregate may
  // already include a later receipt; never add that receipt a second time.
  if(halves.some(h=>h>2)&&[1,2].some(h=>dutyNumber(customsRow?.[`Customs${h}`])>0))
    missing.push({reason:'저장 관세에 3차 이후 입고가 포함됐는지 범위 확인 필요',diagnostic:{failed:['LATER_SUBWEEK_DUTY_SCOPE_UNCONFIRMED']}});
  for (const half of halves) {
    // SQL country inputs only have Customs1/2. Later receipts are independent
    // line evidence, never folded into either saved amount.
    const actual=half<=2?dutyNumber(customsRow?.[`Customs${half}`]):null;
    if (actual != null) { total+=actual;details.push({half,amount:actual,source:'stored_or_historical'});continue; }
    for (const line of current.filter(l=>numericSubweek(l.orderWeek)===half)) {
      if(dutyNumber(line.approvedReceiptCost?.duty)!=null){const recorded=line.approvedReceiptCost;total+=recorded.duty;details.push({half,line:line.warehouseDetailKey,amount:recorded.duty,source:'approved_receipt_formula',evidence:recorded.evidence});continue;}
      if (dutyNumber(line.actualDuty)!=null) {total+=Number(line.actualDuty);details.push({half,line:line.warehouseDetailKey,amount:line.actualDuty,source:'freight_snapshot'});continue;}
      const rule=resolveTemplateDutyRule(line,policy,year);
      if (!rule) {missing.push({prodKey:line.prodKey,name:line.name,reason:'승인된 품목별 관세율 미확인',diagnostic:{
        failed:[policy.products.some(p=>Number(p.prodKey)===Number(line.prodKey))?'POLICY_FINGERPRINT_MISMATCH':'POLICY_KEY_MISSING'],sourceRef:dutySourceRef(line),actualDutyInput:'not_available_in_calculation'}});continue;}
      if (rule.rate===0) {details.push({half,line:line.warehouseDetailKey,amount:0,source:'approved_template',rate:0});continue;}
      const goods=dutyNumber(line.goodsForeign),freight=dutyNumber(line.freightForeign);
      const fx=dutyNumber(line.storedExchangeRate) ?? dutyNumber(row.calc?.R ?? row.manual?.R ?? row.auto?.R);
      const fxSource=dutyNumber(line.storedExchangeRate)>0?'freight_cost_snapshot':dutyNumber(row.manual?.R)>0?'manual_input':row.source?.R;
      if (goods==null || freight==null || !(fx>0) || line.currency!==row.currency || !APPROVED_FX_SOURCES.has(fxSource)) {
        const failed=[];
        if(goods==null)failed.push('GOODS_BASIS_UNCONFIRMED');
        if(freight==null)failed.push(line.freightAllocationEvidence?.conserved===false?'FREIGHT_ALLOCATION_NOT_CONSERVED':'FREIGHT_BASIS_UNCONFIRMED');
        if(!(fx>0))failed.push('FX_VALUE_UNCONFIRMED');
        if(line.currency!==row.currency)failed.push('CURRENCY_MISMATCH');
        if(!APPROVED_FX_SOURCES.has(fxSource))failed.push('FX_SOURCE_UNSUPPORTED');
        missing.push({prodKey:line.prodKey,name:line.name,reason:'같은 입고의 CNF·운임·통화·환율 근거 미확인',diagnostic:{failed,sourceRef:dutySourceRef(line),actualDutyInput:'not_available_in_calculation',
          ...(line.currency!==row.currency?{currency:{inferred:line.currency,report:row.currency,source:'product_country_majority_inference'}}:{}),
          ...(freight==null&&line.freightAllocationEvidence?{freight:line.freightAllocationEvidence}:{})}});continue;
      }
      const amount=(goods+freight)*fx*rule.rate;
      total+=amount;details.push({half,line:line.warehouseDetailKey,amount,source:'approved_template',rate:rule.rate,fx,fxSource,fxEstimated:fxSource==='approved_customs_timing_estimate',goods,freight,ruleIds:rule.ruleIds,awb:line.awb,
        ...(rule.workbookEvidence?{workbookEvidence:rule.workbookEvidence}:{}),
        ...(rule.officialEvidence?{officialEvidence:rule.officialEvidence}:{}),
        ...(line.freightAllocationEvidence?.correction?{freightAllocationEvidence:line.freightAllocationEvidence}:{})});
    }
  }
  for(const line of current.filter(l=>numericSubweek(l.orderWeek)==null))missing.push({prodKey:line.prodKey,name:line.name,reason:'관세 세부차수 형식 확인 필요',diagnostic:{failed:['UNSUPPORTED_SUBWEEK'],sourceRef:dutySourceRef(line)}});
  const oldDuty=dutyNumber(row.actualCostEvidence?.components?.customs)
    ?? (row.customsComponents ? (dutyNumber(row.customsComponents.Customs1)??0)+(dutyNumber(row.customsComponents.Customs2)??0) : null);
  const calcH=dutyNumber(row.calc?.H ?? row.auto?.H);
  const manual=dutyNumber(row.manual?.H);
  if(manual!=null || row.source?.H==='manual') return {applies:true,total,deltaH:0,H:manual??calcH,status:'manual_preserved',missing:[],details};
  if(!current.length && total===0) return {applies:true,total:0,deltaH:0,H:calcH,status:'no_inbound',missing:[],details};
  if(oldDuty==null || calcH==null) missing.push({reason:'저장본의 기존 관세·비관세 비용 구분 근거 없음',diagnostic:{failed:[...(oldDuty==null?['LEGACY_DUTY_SPLIT_UNCONFIRMED']:[]),...(calcH==null?['STORED_H_UNCONFIRMED']:[])]}});
  const explanation=[];
  if(details.some(d=>d.workbookEvidence))explanation.push('원가 양식의 직접 관세 수식과 승인된 정확 품목 기준을 적용했습니다. 차수별 원본 예외를 보존하며 원산지증명서 3.2%와 실제 납부 확정액으로 간주하지 않습니다.');
  if(details.some(d=>d.officialEvidence))explanation.push('관세청 2026년 세율표를 연결했습니다. 품목 분류는 신고서 품명 대조 추정이며 해당 입고의 특혜 자격·실제 납부세액 확정은 아닙니다.');
  if(customsRow?.historicalDutyBlank)explanation.push('27차 중국 원본 그외통관비 J10은 빈칸입니다. 과거 추출값 0을 면세 근거로 사용하지 않고 2차 입고를 별도 추정합니다.');
  for(const awb of new Set(details.filter(d=>d.freightAllocationEvidence?.correction).map(d=>d.awb))){
    const e=details.find(d=>d.awb===awb&&d.freightAllocationEvidence?.correction).freightAllocationEvidence;
    explanation.push(`AWB ${awb}: 관세 계산용 운임 ${e.allocatedTotal.toLocaleString()} ${row.currency}로 인보이스 총액을 보존했습니다. 기존 입고 원가 화면 배분합계 ${e.nativeTotal.toLocaleString()}와의 차이는 40cm 장미 중량 보정이며 입고 화면 원가는 변경하지 않았습니다.`);
  }
  return {applies:true,total:missing.length?null:total,knownTotal:total,oldDuty,
    ...(explanation.length?{explanation}:{}),
    ...(customsRow?.historicalDutyBlank?{historicalDutyBlank:customsRow.historicalDutyBlank}:{}),
    deltaH:missing.length?null:total-oldDuty,H:missing.length?null:calcH-oldDuty+total,
    status:missing.length?'input_required':details.some(d=>['approved_template','approved_receipt_formula'].includes(d.source))?'approved_estimate':'actual_preserved',missing,details};
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
    return {value:null,basis:{...basis,dutyReviewRequired:true,dutyDiagnostic:revalueDiagnostic(basis,oldValue,newH,year,major,oldH)},missing:true};
  const delta=newH-Number(basis.average.customsCost);
  const value=oldValue+delta*basis.quantity/basis.average.purchaseQty;
  return {value,basis:{...basis,value,estimated:true,average:{...basis.average,customsCost:newH,
    totalCost:basis.average.totalCost+delta,unitCost:basis.average.unitCost+delta/basis.average.purchaseQty}}};
}

export function applyTemplateDutyView(payload,{year,major,policy,lines,customsByWeek={},previousPayload,sourceFailure}={}) {
  if(String(year)!=='2026' || payload?.templateDuty?.version===TEMPLATE_DUTY_VERSION) return payload;
  // Stored/confirmed inputs are raw loadReportData results, never derived views.
  // An older derived response cannot safely be re-used: its valuation metadata
  // already includes duty. Fail closed instead of adding duty a second time.
  if(payload?.templateDuty || (payload?.rows||[]).some(row=>row.templateDuty)){
    const error=new Error('이전 버전으로 관세가 이미 적용된 자료입니다. 중복 가산을 막기 위해 계산을 중단했습니다. 원본 저장 보고서를 다시 조회하세요.');
    error.code='DUTY_DERIVED_VERSION_MISMATCH';error.statusCode=409;throw error;
  }
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
    const denominator=original.C;
    row.calc={...original,H:current.H,E:begin.value,F:end.value,I,J,K:J==null||!denominator?null:J/denominator};
  }
  const totals=computeProfitTotals(result.rows);
  for(const row of result.rows) row.calc={...row.calc,D:calcRevenueRatio(row.calc,totals),U:calcPurchaseRatio(row.calc,totals)};
  result.templateDuty={version:TEMPLATE_DUTY_VERSION,approvedEstimate:true,sourceYearsVerified:false,
    derivedFromConfirmed:!!payload.confirmed,originalTotals:payload.confirmedTotals||payload.totals||null,
    label:'저장본 기반 관세 계산 반영 · 적용기준 상세 확인 · 원본 확정본·DB 미변경'};
  const issues=(result.rows||[]).filter(r=>r.templateDuty?.missing?.length||r.templateDuty?.inventoryHeld).map(r=>({
    code:'TEMPLATE_DUTY_BASIS_MISSING',severity:'error',category:r.category,columns:['H','E','F','K'],
    message:`${r.category}: 관세 또는 재고 재평가 근거 확인 필요`,
    detail:{summary:[...(r.templateDuty.missing||[]).map(x=>`${x.name||''} ${x.reason}`),...(r.templateDuty.inventoryHeld?['기초·기말 평가에 필요한 동일 차수 평균식 근거 없음']:[]),...(r.templateDuty.explanation||[])].join('; '),sections:[]}}));
  const warnings=result.rows.filter(r=>r.templateDuty?.status==='approved_estimate').map(r=>({
    code:'TEMPLATE_DUTY_ESTIMATE',severity:'warning',category:r.category,columns:['H','E','F','K'],
    message:`${r.category}: 승인된 품목별 양식 관세를 추정 반영했습니다. 실제 납부 확정액이 아니며 원본 DB는 변경하지 않았습니다.`,
    detail:{summary:`관세 ${r.templateDuty.total?.toLocaleString()}원 · 기존 관세 대비 ${r.templateDuty.deltaH?.toLocaleString()}원${r.templateDuty.explanation?.length?`. ${r.templateDuty.explanation.join(' ')}`:''}`,sections:[]}}));
  const allIssues=[...(result.audit?.issues||[]).filter(i=>!(i.code==='APPROVED_CUSTOMS_ESTIMATE'&&result.rows.some(r=>r.category===i.category&&r.templateDuty))),...issues,...warnings];
  const errorCount=allIssues.filter(i=>i.severity==='error').length,warningCount=allIssues.filter(i=>i.severity==='warning').length;
  result.audit={...result.audit,status:errorCount?'needs_input':warningCount?'needs_review':'ready',issues:allIssues,errorCount,warningCount};
  result.effectiveViewTotals=totals;result.totals=totals;
  if(payload.confirmed){result.originalConfirmedTotals=payload.confirmedTotals;result.confirmedTotals=totals;}
  result.snapshot={...result.snapshot,templateDuty:result.templateDuty};
  return result;
}
