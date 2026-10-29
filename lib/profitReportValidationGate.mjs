// Verification is a separate read-only view; never replace a stored financial figure.
export const VALIDATION_COLUMNS = ['N','L','O','Q','R','S','P','T','H','E','F','C','I','J','K'];
const finite = v => typeof v === 'number' && Number.isFinite(v);
const names={N:'순수매출',L:'불량차감',O:'기타매출',Q:'매입외화',R:'환율',S:'운임외화',P:'원화 매입원가',T:'원화 운임',H:'통관비',E:'기초재고액',F:'기말재고액',C:'매출액',I:'매출원가',J:'매출이익',K:'수익률'};
const label=k=>`${names[k] || k}(${k})`;
function sourceIssueMessage(issue) {
  const detail=issue.detail || {};
  const number=v=>Number(v).toLocaleString('ko-KR',{maximumFractionDigits:5});
  if(issue.code==='SOURCE_UNIT_CONFLICT')return `${issue.message} 입고 상세 #${detail.key}: 원문 ${number(detail.originalBunches)}단 / 현재 환산 ${number(detail.convertedBunches)}단 / 차이 ${number(detail.delta)}단.`;
  if(['SOURCE_PURCHASE_DIFF','SOURCE_FREIGHT_AMOUNT_DIFF'].includes(issue.code))return `${issue.message}${detail.key?` 상세 #${detail.key}`:''} SQL ${detail.raw==null?'미확정':number(detail.raw)} / 적용 ${detail.applied==null?'미확정':number(detail.applied)} / 차이 ${detail.delta==null?'미확정':number(detail.delta)}.`;
  return issue.message;
}
export function acceptsProfitValidationResponse({runKey,currentKey,displayKey,year,major,responseYear,responseMajor,aborted,dirty}) {
  return !aborted&&!dirty&&runKey===currentKey&&runKey===displayKey&&String(year)===String(responseYear)&&Number(major)===Number(responseMajor);
}
export function profitValidationDisplayKey(year, major, rows, totals, audit) {
  return JSON.stringify([String(year),String(major).padStart(2,'0'),(rows || []).map(r=>[r.category,...VALIDATION_COLUMNS.map(k=>r.calc?.[k] ?? null)]),VALIDATION_COLUMNS.map(k=>totals?.[k] ?? null),audit?.issues || []]);
}
export function buildProfitValidationGate({year,major,display,live,rawLive=live,formula,lineage,stock,sources,integrity,coverage={}}) {
  const issues=[];
  const add=(code,message,category=null,columns=[])=>issues.push({code,message,category,columns});
  if(String(live?.orderYear)!==String(year)||Number(live?.major)!==Number(major)) add('SCOPE','원천 보고서 연도·차수가 일치하지 않습니다.');
  if(integrity?.status!=='STABLE_OBSERVED') add('STALE','검증 중 SQL 원천이 변경되었거나 전산 재계산 정책을 확인하지 못했습니다.');
  if(formula?.status!=='MATCH'||formula?.inputWarnings?.length) add('FORMULA','독립 계산식 불일치 또는 필수 입력 누락이 있습니다.');
  if(lineage?.status!=='MATCH') add('SQL','매출·견적·매입 SQL 원행 대사가 완료되지 않았습니다.');
  if(stock?.status!=='MATCH'||stock?.negativeCount>0) add('STOCK','기초·기말 수량 이월 또는 음수재고 확인이 필요합니다.',null,['E','F']);
  for(const issue of sources?.issues || []) issues.push({...issue,message:sourceIssueMessage(issue)});
  const sameDutyPolicy=live?.templateDuty?.approvedEstimate===true&&live.templateDuty.version===display?.templateDuty?.version;
  for(const [origin,audit] of [['현재 SQL',rawLive?.audit],...(rawLive!==live?[['현재 정책',live?.audit]]:[]),['저장본',display?.audit]]) for(const issue of audit?.issues || []) {
    const applied=sameDutyPolicy&&live.rows?.some(r=>r.category===issue.category&&r.templateDuty?.status==='approved_estimate');
    // The superseded blanket estimate is not a raw receipt/FX error. Every other
    // source warning/error remains blocking, including genuine reconciliation gaps.
    if(applied&&issue.code==='APPROVED_CUSTOMS_ESTIMATE'&&issue.severity==='warning')continue;
    const nonBlocking=applied&&issue.code==='TEMPLATE_DUTY_ESTIMATE'&&issue.severity==='warning';
    if(issue.severity==='error'||issue.severity==='warning')issues.push({...issue,nonBlocking,message:`${origin}: ${issue.message}`});
  }
  if(sources?.status!=='matched') add('RECEIPT','입고·운임 원문 대사가 완료되지 않았습니다.');
  if(JSON.stringify((display?.rows||[]).map(r=>r.category).sort())!==JSON.stringify((live?.rows||[]).map(r=>r.category).sort()))add('CATEGORIES','저장본과 현재 SQL의 품종 목록이 다릅니다.');
  const verifiedCoverage={...sources?.coverage,...coverage};
  const missingCoverage=['Q','E','F','R','S','H','P','T'].filter(k=>verifiedCoverage[k]!==true);
  if(missingCoverage.length) add('COVERAGE',`${missingCoverage.map(label).join('·')} 원천 검증 미완료: 재고 평가·환율 적용시점·통관 실비·운임 배분은 숫자 존재나 산술 일치만으로 인증하지 않습니다.`,null,missingCoverage);
  for(const key of VALIDATION_COLUMNS.filter(k=>k!=='R')) {
    const saved=display?.totals?.[key],now=live?.totals?.[key];
    if(!finite(saved)||!finite(now)||Math.abs(saved-now)>(key==='K'?0.000001:0.01))add('TOTAL_DIFF',`합계 ${label(key)} 저장본과 현재 SQL 계산이 다르거나 미확정입니다.`,null,[key]);
  }
  const rows=(display?.rows || []).map(row=>{
    const current=live?.rows?.find(r=>r.category===row.category);
    const reasons=[];
    if(!current) reasons.push('현재 SQL 계산에 대응 품종이 없습니다.');
    for(const key of VALIDATION_COLUMNS) {
      const saved=row.calc?.[key],now=current?.calc?.[key];
      if(!finite(saved)||!finite(now)) { if(['E','F','H','R','P','T','I','J','K'].includes(key)) reasons.push(`${label(key)} 미확정`); }
      else if(Math.abs(saved-now)>(key==='K'?0.000001:0.01)) reasons.push(`${label(key)}: 저장 ${saved} / 현재 ${now}`);
    }
    const estimated=Boolean(current?.templateDuty?.status==='approved_estimate'||current?.rateEstimated||current?.actualCostEvidence?.source==='approved_estimate'||current?.actualCostEvidence?.estimated===true||current?.inventoryValuation?.begin?.estimated||current?.inventoryValuation?.end?.estimated);
    const related=issues.filter(i=>!i.category||i.category===row.category);
    const state=reasons.length||related.some(i=>!i.nonBlocking)?'held':estimated?'estimated':'verified';
    return {category:row.category,state,estimated,reasons:[...reasons,...related.map(i=>i.message),...(estimated?['추정 환율·이월 원가 등 추정 근거가 포함되어 있습니다.']:[])]};
  });
  if(!rows.length) add('EMPTY','검증할 보고서 행이 없습니다.');
  const state=issues.some(i=>!i.nonBlocking)||!rows.length||rows.some(r=>r.state==='held')?'held':rows.some(r=>r.state==='estimated')?'estimated':'verified';
  return {year:String(year),major:String(major).padStart(2,'0'),state,rows,issues,coverage:verifiedCoverage,displayKey:profitValidationDisplayKey(year,major,display?.rows,display?.totals,display?.audit),checkedAt:new Date().toISOString(),boundary:'읽기 전용 관측 시점 검증입니다. 저장·확정 숫자를 변경하지 않으며 DB의 이후 변경을 자동 인증하지 않습니다.'};
}
