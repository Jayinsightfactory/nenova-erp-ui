// Display-only interpretation of server scope: major completion or selected dates.
export function resolveWeekdayPrintReadiness(result) {
  const readiness=result?.printReadiness;
  if(!readiness) return result?.error ? {state:'ERROR',label:'견적 조회 실패',reason:String(result.error)} : null;
  const counts=['positiveCount','unfixedCount','invalidCount'];
  if(!['ALL_CUSTOMERS_MAJOR_WEEK','SELECTED_CUSTOMER_DATES'].includes(readiness.scope) || counts.some(key=>!Number.isSafeInteger(readiness[key]) || readiness[key]<0)
    || readiness.unfixedCount>readiness.positiveCount
    || !Array.isArray(readiness.reasons) || readiness.reasons.some(reason=>typeof reason!=='string')) {
    return {state:'ERROR',label:'견적 조회 실패',reason:'견적 출력 준비 상태의 조회 범위를 확인할 수 없습니다.'};
  }
  const common={...readiness,reason:readiness.reasons.join('\n')};
  if(readiness.invalidCount>0) return {...common,state:'INVALID',label:`선택 업체 견적 연결 확인 ${readiness.invalidCount}건`,
    action:'선택 업체의 연결·수량·금액을 확인한 뒤 다시 조회하세요.'};
  if(readiness.positiveCount===0) return {...common,state:'NO_SHIPMENT',label:'분배·확정 후 견적 출력 가능',
    action:'저장된 출고 없음 · 입력·분배 적용부터 진행'};
  if(readiness.unfixedCount>0) return {...common,state:'UNFIXED',label:`확정 대기 ${readiness.unfixedCount}건`,
    action:readiness.scope==='SELECTED_CUSTOMER_DATES'?'선택 업체·출고일 범위':'해당 연도·차수의 전체 업체 범위'};
  return {...common,state:'READY',label:'견적 출력 준비 완료',action:''};
}

export function isExpectedWeekdayPrintBlock(status,result) {
  return status===409 && ['NO_SHIPMENT','UNFIXED','INVALID'].includes(resolveWeekdayPrintReadiness(result)?.state);
}

export function selectedWeekdayPrintReason(rows,cycle,dates,custKey) {
  const selected=(rows || []).filter(row=>Number(row.year)===Number(cycle.year)
    && Number(row.custKey)===Number(custKey) && String(row.orderWeek).split('-')[0]===cycle.majorWeek
    && (row.shipmentDates || []).some(day=>dates.includes(String(day.date).slice(0,10))
      && (Number(day.shipmentQuantity)>0 || Number(day.estimateQuantity)>0)));
  if(selected.some(row=>row.fixed!==true)) return '선택 출고일의 미확정 품목을 먼저 확정하세요.';
  return '';
}
