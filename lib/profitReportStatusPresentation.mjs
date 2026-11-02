// Presentation only. Never change a calculation or promote a server-held verdict.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const names = {C:'매출액',E:'기초재고액',F:'기말재고액',G:'매입·운임 원가',H:'그외통관비',I:'매출원가',J:'매출이익',K:'수익률',P:'원화 매입원가',T:'원화 운임',R:'환율'};
const required = ['C','E','F','G','H','I','J','P','T'];
const zeroAmounts = [...required,'N','L','O','Q','S'];
const estimateCodes = new Set(['APPROVED_CUSTOMS_TIMING_ESTIMATE','INVENTORY_CUSTOMS_TIMING_ESTIMATE','APPROVED_CUSTOMS_ESTIMATE','TEMPLATE_DUTY_ESTIMATE']);
const unique = values => [...new Set(values.filter(Boolean))];
const dedupe = issues => [...new Map(issues.map(issue => [JSON.stringify(issue),issue])).values()];
const rootMissing = calc => ['C','E','F','G','H','P','T'].filter(key=>!finite(calc[key])).concat((calc.Q!==0 || calc.S!==0) && !finite(calc.R) ? ['R'] : []);
const denominatorIsZero = row => row?.variant==='noEnding'
  ? finite(row.calc?.C) && finite(row.calc?.F) && row.calc.C+row.calc.F===0 : row?.calc?.C===0;
export const PROFIT_STATUS_LABELS = Object.freeze({unavailable:'계산 불가',verified:'사용 가능',estimated:'추정 포함',review:'확인 필요',unchecked:'원천 대조 전',notApplicable:'수익률 해당없음'});
const diagnosticLabels={
 POLICY_KEY_MISSING:'승인 관세 규칙에 이 품목 키가 없음',POLICY_FINGERPRINT_MISMATCH:'관세 규칙의 품목명·국가가 현재 품목과 불일치',
 GOODS_BASIS_UNCONFIRMED:'상품 매입액 연결 미확인',FREIGHT_ALLOCATION_NOT_CONSERVED:'입고 운임 배분 대사 미통과(운임 DB가 없다는 뜻 아님)',
 FREIGHT_BASIS_UNCONFIRMED:'입고 운임 산출 근거 미확인',FX_VALUE_UNCONFIRMED:'적용 환율 값 미확인',FX_SOURCE_UNSUPPORTED:'환율 출처가 해당 차수 적용 조건을 충족하지 않음',
 CURRENCY_MISMATCH:'입고 통화와 보고서 통화 불일치',UNSUPPORTED_SUBWEEK:'관세 계산이 지원하는 1·2차 외 세부차수 입고',
 LEGACY_DUTY_SPLIT_UNCONFIRMED:'저장 통관비의 관세·비관세 구분 미확인',STORED_H_UNCONFIRMED:'저장본 통관비 금액 미확인',
 VALUATION_METHOD_UNSUPPORTED:'현재 품목별 평가 방식은 관세 재평가 적용 조건과 다름',PURCHASE_QUANTITY_UNCONFIRMED:'평가 기준 매입수량 미확인',
 VALUATION_PERIOD_MISMATCH:'재고 평가 근거 연도·차수 불일치',INVENTORY_QUANTITY_UNCONFIRMED:'평가 메타의 재고수량 미확인',
 AVERAGE_CUSTOMS_UNCONFIRMED:'평균원가에 포함된 기존 통관비 미확인',ORIGINAL_VALUE_UNCONFIRMED:'저장 재고평가액 미확인',
 CUSTOMS_DEPENDENCY_UNCONFIRMED:'평가 차수의 그외통관비 미확정 → 재고 재평가 중단',AVERAGE_COST_UNCONFIRMED:'저장 평균원가 총액 미확인',
 ORIGINAL_CUSTOMS_UNCONFIRMED:'기존 통관비 비교값 미확인',CUSTOMS_BASIS_MISMATCH:'저장 평균식의 통관비와 원래 통관비 불일치',
 VALUATION_FORMULA_MISMATCH:'원래 재고평가액과 저장 평균식 대사 불일치',
};
export const profitDiagnosticText=code=>diagnosticLabels[code] || `추가 원천 확인 필요 (${code})`;

export function profitIssueImpact(issue) {
  const impact = issue?.detail?.impact;
  if (finite(impact?.amount) && (impact.currency === 'KRW' || impact.unit === '원')) return `근거에 표시된 영향액 ${impact.amount.toLocaleString('ko-KR',{maximumFractionDigits:0})}원${impact.text ? ` · ${impact.text}` : ''}`;
  if (impact?.text) return impact.text;
  if (issue?.code === 'SOURCE_UNIT_CONFLICT' && finite(issue.detail?.delta)) return `수량 차이 ${issue.detail.delta.toLocaleString('ko-KR')}단 · 손익 영향액 미확정`;
  // Purchase/freight deltas may be foreign currency. Do not append a KRW unit.
  return '영향액 미확정';
}

export function profitSourceGuidance(row, column) {
  const basis=column==='E'?row?.inventoryValuation?.begin:column==='F'?row?.inventoryValuation?.end:null;
  if(basis?.dutyReviewRequired) return {
    status:'웹 재평가 조건 미충족 · 재고 DB 부재라는 뜻 아님',
    shortLocation:'재고관리 ProductStock.Stock / 저장 보고서 평가메타',
    location:row.confirmed?'확정 당시 재고 평가근거 / 재고관리 ProductStock.Stock':'계산본 WebProfitReportSnapshot.PayloadJson의 inventoryValuation / 재고관리 ProductStock.Stock',
  };
  if(column==='H' && row?.templateDuty?.missing?.length) {
    const ruleMissing=row.templateDuty.missing.some(item=>item.reason==='승인된 품목별 관세율 미확인');
    const allocationFailed=row.templateDuty.missing.some(item=>item.diagnostic?.failed?.includes('FREIGHT_ALLOCATION_NOT_CONSERVED'));
    return {status:allocationFailed?'웹 운임 배분 대사 미통과 · 운임 DB 부재와 다름':ruleMissing?'웹 관세율 연결 미완료 · 실제 SQL 관세 부재는 미확정':'관세 산출 연결·대사 조건 미충족 · SQL 누락 여부는 별도 확인',
      shortLocation:allocationFailed?'입고관리 WarehouseDetail.TPrice·WarehouseMaster.OrderNo':ruleMissing?'웹 관세 규칙 products / 그외통관비 WebCustomsWeekly.Customs1·Customs2':'입고관리·그외통관비·도착원가 근거',
      location:ruleMissing?'웹 관세 규칙 data/profit-template-duty-2026.json의 products(ProdKey·country·name) / 실제 관세: 그외통관비 WebCustomsWeekly.Customs1·Customs2(분할합계) / 도착원가 FreightCostDetail.TariffKRW·SteamQty'
        :'입고관리 WarehouseDetail.TPrice, WarehouseMaster.OrderNo(AWB) / 도착원가 FreightCost·FreightCostDetail.TariffKRW·SteamQty / 그외통관비 WebCustomsWeekly.Customs1·Customs2(분할합계)'};
  }
  if(column==='E'||column==='F')return {status:'현재 계산의 평가근거 미확인 · SQL 값 부재는 아직 단정하지 않음',location:'재고관리 ProductStock.Stock / 입고관리 WarehouseDetail.TPrice / 저장 보고서의 재고 평가근거'};
  if(column==='H')return {status:'현재 계산의 통관비 근거 미확인 · SQL 대조 필요',location:'그외통관비 WebCustomsWeekly / 도착원가 FreightCostDetail.TariffKRW·SteamQty'};
  if(column==='R')return {status:'해당 차수 환율 연결 미확인 · SQL 대조 필요',location:'도착원가 FreightCost.ExchangeRate / 과세환율 WebTaxableExchangeRate'};
  return null;
}

// Explain a blank at its actual cell, not only at the rate badge or in a tooltip.
export function profitMissingCell({row, column, issues = [], rows, totals} = {}) {
  if (!names[column]) return null;
  const calc = row?.calc || totals || {};
  if (finite(calc[column])) return null;
  if (column === 'R' && (!row || (calc.Q === 0 && calc.S === 0))) return null;
  if (!row) {
    const totalDenominatorZero=column==='K' && ['C','F','J'].every(key=>finite(calc[key])) && calc.C+calc.F===0;
    const affected = (rows || []).filter(item=>item.category !== '기타(미분류)' && (column==='K'
      ? ['C','F','J'].some(key=>!finite(item.calc?.[key])) : !finite(item.calc?.[column]))).map(item=>{
      const roots=['I','J','K'].includes(column)?rootMissing(item.calc || {}):[];
      const fields=column==='K' && !roots.length?['C','F','J'].filter(key=>!finite(item.calc?.[key])):roots;
      return `${item.category}: ${fields.length?fields.map(key=>names[key]).join('·'):names[column]} 확인 필요`;
    });
    const zeroTotal = column === 'K' && calc.C === 0 && calc.J === 0 && (rows || []).length
      && rows.every(item=>zeroDenominatorEvidence(item,issues.filter(issue=>issue.category===item.category)));
    return zeroTotal ? {label:'수익률 해당없음',reason:'매출·원가 0원 / 수익률 분모 없음'}
      : totalDenominatorZero ? {label:'수익률 확인 필요',reason:'합계 수익률 분모(C+F)가 0입니다. 매출액·기말재고액·매출이익은 유한하며, 원천 누락이라는 뜻은 아닙니다.'}
      : {label:'합계 미완성',reason:affected.length?affected.join(' / '):`${names[column]} 계산 근거 확인 필요`};
  }
  const direct = issues.filter(issue=>issue.category === row.category);
  const roots = rootMissing(calc);
  if (column === 'K' && denominatorIsZero(row) && roots.length === 0) return zeroDenominatorEvidence(row,direct)
    ? {label:'수익률 해당없음',reason:'매출·원가 0원 / 수익률 분모 없음. 0원 이동 부재 인증 아님'}
    : {label:'수익률 확인 필요',reason:'수익률 분모가 0입니다. 재고·원가 근거와 함께 확인하세요.'};
  const relevant = direct.filter(issue=>issue.columns?.includes(column));
  const basis = column==='E'?row.inventoryValuation?.begin:column==='F'?row.inventoryValuation?.end:null;
  const basisReasons = {missing_snapshot:'해당 차수 재고 스냅샷 미확인',missing_value:'재고 평가에 필요한 원가 근거 미확인',conversion_missing:'재고 수량 단위 환산 근거 미확인',unit_mismatch:'매입·재고 수량 단위가 서로 다름',metadata_missing:'상세 평가 근거 미확인',confirmed_legacy:'확정 당시 상세 평가 근거 미보관',average_unavailable:'평균 도착원가의 매입·환율 등 근거 미확인'};
  const label = ['E','F'].includes(column)?'평가액 근거 미확인':column==='H'?'통관비 근거 미확인':column==='R'?'환율 근거 미확인':'계산 불가';
  const dutyReasons = column==='H' ? (row.templateDuty?.missing || []).flatMap(item=>item.diagnostic?.failed?.length?item.diagnostic.failed.map(profitDiagnosticText):[item.reason]) : [];
  const dutyInventoryReason=basis?.dutyReviewRequired ? basis.method==='product_cost'
    ? '품목별 재고 평가에 관세를 반영하는 웹 재평가 조건 미충족'
    : column==='F' && !finite(calc.H) ? '그외통관비 미확정 → 기말재고 관세 재평가 중단'
    : '관세 반영 재고 재평가 근거 미확인 — 기초 평가차수의 통관비·평가 조건 확인 필요' : null;
  const diagnosticFailures=basis?.dutyDiagnostic?.failed || [];
  const preciseInventory=diagnosticFailures.length ? `${basis.dutyDiagnostic.year}년 ${Number(basis.dutyDiagnostic.major)}차 평가: ${diagnosticFailures.includes('VALUATION_METHOD_UNSUPPORTED')
    ? `${profitDiagnosticText('VALUATION_METHOD_UNSUPPORTED')} · 평균식 전용 메타는 이 평가 방식에서 생성되지 않습니다.${diagnosticFailures.includes('CUSTOMS_DEPENDENCY_UNCONFIRMED')?' 해당 평가 차수의 통관비도 미확정입니다.':''}`
    : diagnosticFailures.map(profitDiagnosticText).join(' · ')}` : null;
  const reason = ['I','J','K'].includes(column) && roots.length ? `${roots.map(key=>names[key]).join('·')} 확인 필요`
    : unique([preciseInventory || dutyInventoryReason || basisReasons[basis?.reason],...dutyReasons,...relevant.map(issue=>issue.message)]).join(' · ') || `${names[column]} 산출에 필요한 원천을 확인하세요.`;
  return {label,reason,source:profitSourceGuidance(row,column)};
}

function explicitEstimate(row, issues, checked) {
  return checked?.estimated === true || row?.templateDuty?.status === 'approved_estimate'
    || row?.rateEstimated === true || row?.actualCostEvidence?.estimated === true
    || row?.actualCostEvidence?.source === 'approved_estimate'
    || row?.inventoryValuation?.begin?.estimated === true || row?.inventoryValuation?.end?.estimated === true
    || issues.some(i => estimateCodes.has(i.code) && i.severity !== 'error');
}
function zeroDenominatorEvidence(row, issues) {
  return !issues.some(i => !estimateCodes.has(i.code))
    && zeroAmounts.every(key => row?.calc?.[key] === 0)
    && [row.beginStock,row.stock].every(stock => stock?.snapshotConfirmed === true && stock.endQty === 0
      && !stock.unitMismatch && !stock.conversionMissingCount && !stock.missingPriceCount);
}

export function buildProfitStatusPresentation({rows = [], totals = {}, validation = {}} = {}) {
  const result = !validation.dirty && !validation.error && !validation.busy
    && validation.currentDisplayKey && validation.result?.displayKey === validation.currentDisplayKey ? validation.result : null;
  const issues = dedupe([...(validation.knownIssues || []),...(result?.issues || [])]);
  const globalIssues = issues.filter(i => !i.category);
  const globalMessages = new Set(globalIssues.map(i => i.message));
  const common = validation.dirty ? '화면 또는 선택 차수 변경 · 다시 조회·저장 후 대조하세요.'
    : validation.error ? `원천 대조 실패: ${validation.error}`
    : validation.busy ? '원천 대조 진행 중 · 결과를 기다려 주세요.'
    : !result ? `원천 대조 전 · 오류라는 뜻은 아닙니다.${globalIssues.length?' 공통 확인사항 있음.':''}`
    : globalIssues.some(i=>!i.nonBlocking) ? '공통 원천 검증 미완료 · 위의 공통 확인사항을 확인하세요.' : '';
  const items = rows.map(row => {
    const directIssues = issues.filter(i=>i.category === row.category);
    const checked = result?.rows?.find(item=>item.category === row.category);
    const issueMessages = new Set(issues.map(i=>i.message));
    let ownReasons = (checked?.reasons || []).filter(reason => !globalMessages.has(reason)
      && !issueMessages.has(reason) && reason !== '추정 환율·이월 원가 등 추정 근거가 포함되어 있습니다.');
    const estimated = explicitEstimate(row,directIssues,checked);
    const blockingIssues = directIssues.filter(i=>i.severity === 'error' || (!i.nonBlocking && !estimateCodes.has(i.code)));
    const absent = required.filter(key=>!finite(row.calc?.[key]));
    if ((row.calc?.Q !== 0 || row.calc?.S !== 0) && !finite(row.calc?.R)) absent.push('R');
    const notApplicable = row.calc?.K == null && zeroDenominatorEvidence(row,directIssues);
    if(notApplicable)ownReasons=ownReasons.filter(reason=>reason!=='수익률(K) 미확정');
    const zeroDenominator = row.calc?.K == null && denominatorIsZero(row) && absent.length === 0;
    if (!finite(row.calc?.K) && !notApplicable && !zeroDenominator) absent.push('K');
    let state = absent.length ? 'unavailable' : blockingIssues.length || ownReasons.length ? 'review'
      : notApplicable ? 'notApplicable' : zeroDenominator ? 'review'
      : estimated ? 'estimated' : checked?.state === 'verified' && !globalIssues.some(i=>!i.nonBlocking) ? 'verified'
      : checked?.state === 'held' ? 'review' : 'unchecked';
    // A stale/unknown result is not a usable observation, even if its values exist.
    if (state === 'verified' && !result) state = 'unchecked';
    const reasons = unique([
      ...(absent.length ? [`${absent.map(key=>names[key]).join('·')} 미확정 — 해당 원천 입력과 연결을 확인하세요.`] : []),
      ...directIssues.map(i=>i.message),...ownReasons,
      ...(notApplicable ? ['매출·원가 0원 / 수익률 분모 없음. 0원 입출고까지 없다는 뜻은 아닙니다.'] : zeroDenominator ? ['수익률 분모가 0이므로 수익률을 계산할 수 없습니다. 재고·원가 금액은 그대로 표시합니다.'] : []),
      ...(checked?.state==='held' && !blockingIssues.length && !ownReasons.length && !globalIssues.length ? ['서버 원천 검증이 완료되지 않았습니다.'] : []),
    ]);
    return {category:row.category,state,label:PROFIT_STATUS_LABELS[state],estimated,reasons,issues:directIssues,missingEvidence:row.templateDuty?.missing || [],
      secondary: common || (state==='verified' ? '관측 시점 검증 · 이후 원천 변경은 재대조 필요' : checked?.state==='held' ? '원천 검증 미완료' : estimated ? '실제 비용 확정 인증 아님' : ''),
      serverState:checked?.state || null};
  });
  const counts = Object.fromEntries(Object.keys(PROFIT_STATUS_LABELS).map(state=>[state,items.filter(i=>i.state===state).length]));
  const totalItems=items.filter(item=>item.category!=='기타(미분류)');
  const totalCounts=Object.fromEntries(Object.keys(PROFIT_STATUS_LABELS).map(state=>[state,totalItems.filter(i=>i.state===state).length]));
  const missingTotal = required.some(key=>!finite(totals?.[key])) || (!finite(totals?.K) && !(finite(totals.C)&&finite(totals.F)&&totals.C+totals.F===0));
  const totalState = missingTotal || totalCounts.unavailable ? 'unavailable'
    : totalCounts.review ? 'review' : totalCounts.estimated ? 'estimated'
    : !totalItems.length || totalCounts.unchecked || !result ? 'unchecked'
    : totalItems.every(item=>item.state==='notApplicable') ? 'notApplicable'
    : result.state==='verified' && totalItems.every(item=>['verified','notApplicable'].includes(item.state)) ? 'verified' : 'review';
  return {items,counts,globalIssues,result,common,total:{state:totalState,label:PROFIT_STATUS_LABELS[totalState],
    secondary:missingTotal || totalCounts.unavailable ? '일부 금액 미확정 · 완전한 합계가 아닙니다.' : common || '품종별 상태와 공통 검증 제약을 함께 확인하세요.',
    reasons:[],issues:[],estimated:items.some(item=>item.estimated)}};
}
