// Independent raw-line reconciliation. Matching Q/freight inputs is not certification of FX or customs.
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const keyOf = r => String(r.WdetailKey ?? r.warehouseDetailKey ?? '');
export function reconcileProfitReportSources({ year, major, report, receiptRows, adjustmentRows = [] } = {}) {
  const issues = [], purchaseComparisons = [], freightComparisons = [];
  const issue = (code, category, columns, message, detail = {}) => issues.push({ severity: 'error', code, category, columns, message, detail });
  if (!/^\d{4}$/.test(String(year)) || !/^\d{1,2}$/.test(String(major)) || Number(major)<1 || Number(major)>53) throw new Error('INVALID_REPORT_SCOPE');
  if (!report || String(report.orderYear)!==String(year) || Number(report.major)!==Number(major) || !Array.isArray(receiptRows)) {
    issue('SOURCE_SCOPE_MISSING', null, ['Q','S'], '원문 대사 대상 연도·차수 또는 원문 조회 결과가 없습니다.');
    return {status:'incomplete',issues,purchaseComparisons,freightComparisons,coverage:{Q:false,sourceFreightRows:false,currency:false,S:false,P:false,T:false,R:false,H:false}};
  }
  const unique = new Map(), totals = new Map(), freight = new Map();
  for (const r of receiptRows) {
    const key=keyOf(r), category=r.Category || null;
    if(String(r.OrderYear)!==String(year) || !new RegExp(`^0?${Number(major)}-\\d{2}$`).test(String(r.OrderWeek))) {
      issue('SOURCE_CROSS_SCOPE',category,['Q','S'],'다른 연도·차수의 입고 원문이 섞였습니다.',{key});continue;
    }
    if(!/^\d+$/.test(key)||Number(key)<=0||unique.has(key)) { issue('SOURCE_DUPLICATE_KEY',category,['Q','S'],'입고 원문 식별키가 없거나 중복됩니다.',{key});continue; }
    unique.set(key,r);
    if(r.IsWeight) continue;
    if(!finite(r.TPrice)) {issue('SOURCE_AMOUNT_MISSING',category,['Q','S'],'입고 원문 금액이 누락되었습니다. 0원으로 대체하지 않습니다.',{key});continue;}
    if(r.IsFreight) freight.set(key,r);
    if(r.IsStockable) {
      if(r.OutUnit==='박스' && finite(r.OutQuantity) && Number(r.BunchOf1Box)>0 && Number(r.BunchQuantity)>0) {
        const converted=Number(r.OutQuantity)*Number(r.BunchOf1Box),delta=converted-Number(r.BunchQuantity);
        if(Math.abs(delta)>0.00001)issue('SOURCE_UNIT_CONFLICT',category,['E','F','K'],'입고 당시 단수와 현재 품목 박스 환산 단수가 달라 재고 평가 확인이 필요합니다.',{key,originalBunches:Number(r.BunchQuantity),convertedBunches:converted,delta});
      }
      if(!category) issue('SOURCE_CATEGORY_MISSING',null,['Q'],'매입 원문의 분류가 없습니다.',{key});
      else totals.set(category,(totals.get(category)||0)+Number(r.TPrice));
    }
  }
  const positiveCategories=new Set();
  for(const r of adjustmentRows) {
    if(!finite(r.Quantity)){issue('SOURCE_ADJUSTMENT_AMOUNT_MISSING',r.Category||null,['E','F','K'],'재고조정 수량이 누락되어 0으로 취급하지 않습니다.');continue;}
    if(String(r.OrderYear)!==String(year)||!new RegExp(`^0?${Number(major)}-\\d{2}$`).test(String(r.OrderWeek))) {issue('SOURCE_CROSS_SCOPE',r.Category||null,['E','F','K'],'재고조정 대사 연도·차수가 다릅니다.');continue;}
    if(Number(r.Quantity)>0)positiveCategories.add(r.Category||null);
  }
  for(const category of positiveCategories)issue('SOURCE_POSITIVE_ADJUSTMENT_COST_UNVERIFIED',category,['E','F','K'],'양수 재고조정이 있어 취득원가 반영 여부 확인이 필요합니다. 실제 판매마진으로 확정하지 않습니다.');
  const reportRows=new Map();
  for(const r of report.rows||[]) {
    if(reportRows.has(r.category))issue('SOURCE_REPORT_DUPLICATE_CATEGORY',r.category,['Q'],'보고서 분류가 중복됩니다.');
    reportRows.set(r.category,r);
  }
  for(const category of new Set([...totals.keys(),...reportRows.keys()])) {
    const raw=totals.get(category)||0,r=reportRows.get(category),applied=r?.calc?.Q;
    // Categories absent in the report are acceptable only when no value was received.
    if(!r && raw===0)continue;
    const delta=finite(applied)?Number(applied)-raw:null;
    purchaseComparisons.push({category,raw,applied:finite(applied)?Number(applied):null,delta});
    if(delta===null || Math.abs(delta)>0.00001)issue('SOURCE_PURCHASE_DIFF',category,['Q','P','G','K'],'매입 원문 합계와 보고서 매입금액이 다릅니다.',{raw,applied,delta});
  }
  const ledger=report.forwardingReconciliation;
  const seen=new Set();
  if(!Array.isArray(ledger?.sourceRows))issue('SOURCE_FREIGHT_EVIDENCE_MISSING',null,['S','T','K'],'보고서에 운임 원문 행 근거가 없습니다.');
  for(const r of ledger?.sourceRows||[]) {
    const key=keyOf(r),raw=freight.get(key);
    if(seen.has(key)){issue('SOURCE_FREIGHT_DUPLICATE',null,['S','T','K'],'운임 원문이 보고서에 중복 연결되었습니다.',{key});continue;}seen.add(key);
    if(!raw || String(r.orderYear)!==String(year) || String(r.orderWeek)!==String(raw.OrderWeek) || Number(r.warehouseKey)!==Number(raw.WarehouseKey)) {
      issue('SOURCE_FREIGHT_SCOPE_DIFF',null,['S','T','K'],'운임 원문 키·연도·차수가 현재 SQL과 다릅니다.',{key});continue;
    }
    const delta=finite(r.amount)?Number(r.amount)-Number(raw.TPrice):null;
    freightComparisons.push({key,raw:Number(raw.TPrice),applied:finite(r.amount)?Number(r.amount):null,delta});
    if(delta===null||Math.abs(delta)>0.00001)issue('SOURCE_FREIGHT_AMOUNT_DIFF',null,['S','T','K'],'운임 원문 금액과 보고서 연결 금액이 다릅니다.',{key,delta});
  }
  for(const [key]of freight)if(!seen.has(key))issue('SOURCE_FREIGHT_ROW_MISSING',null,['S','T','K'],'현재 SQL의 운임 원문이 보고서에서 누락되었습니다.',{key});
  for(const r of ledger?.unmatchedRows||[])issue('SOURCE_FREIGHT_UNCLASSIFIED',null,['S','T','K'],'운임 원문 분류를 확인할 수 없습니다.',{key:keyOf(r)});
  for(const r of ledger?.missingExpectedScopes||[])issue('SOURCE_FREIGHT_EXPECTED_MISSING',r.category,['S','T','K'],'매입이 있지만 대응 운임 원문이 없습니다.',{orderWeek:r.orderWeek});
  if(freight.size && !Object.keys(ledger?.totalsByCurrency||{}).length)issue('SOURCE_FREIGHT_CURRENCY_MISSING',null,['S','T','K'],'운임 통화별 근거가 없습니다.');
  for(const [currency,v]of Object.entries(ledger?.totalsByCurrency||{}))if(currency==='UNKNOWN'||!finite(v.delta)||Math.abs(Number(v.delta))>0.00001)issue('SOURCE_FREIGHT_CURRENCY_DIFF',null,['S','T','K'],'통화별 운임 원문 합계가 일치하지 않거나 통화를 확인할 수 없습니다.',{currency});
  return {status:issues.length?'incomplete':'matched',issues,purchaseComparisons,freightComparisons,sourceRowCount:unique.size,coverage:{Q:!issues.some(i=>i.columns.includes('Q')),sourceFreightRows:!issues.some(i=>i.columns.includes('S')),currency:false,S:false,P:false,T:false,R:false,H:false},boundary:'SQL 입고원장 Q 및 운임 행 대사만 수행. 원본 첨부문서·통화·환율 적용시점·통관 실비·운임 배분 정확성은 별도 검증 필요.'};
}
