// One financial basis per report. Calendar adjacency, never an assumed 52-week year.
export function profitFinancialReadPolicy(orderYear, major, current, previous, {confirmed=false, liveAudit=false}={}) {
  const key=scope=>`${scope.orderYear}:${String(Number(scope.major)).padStart(2,'0')}`;
  const selected=key({orderYear:String(orderYear),major});
  if(confirmed)return {basis:'confirmed',frozen:true,label:'확정 원본 금액 고정 · 현재 원가 미반영'};
  if(!current||!previous)throw Object.assign(new Error('보고서 업무 달력의 현재·직전 차수가 필요합니다.'),{code:'PROFIT_CALENDAR_INVALID'});
  const recent=selected===key(current)||selected===key(previous);
  const future=Number(orderYear)*100+Number(major)>Number(current.orderYear)*100+Number(current.major);
  return recent||future||liveAudit
    ?{basis:'live',frozen:false,label:liveAudit?'명시 최신 원천 검산':future?'진행·예정 차수 · 전체 최신 원천 조회':'최근 업무차수 · 전체 최신 원천 조회',current,previous}
    :{basis:'stored',frozen:true,label:'과거 저장 원본 금액 고정 · 현재 원가 미반영',current,previous};
}
export const preservesProfitMoney=payload=>Boolean(payload?.financialReadPolicy?.frozen||payload?.confirmed||['stored','confirmed'].includes(payload?.readMode));
