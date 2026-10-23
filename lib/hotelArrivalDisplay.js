import { recalcArrivalCostWithFx } from './arrivalCostFxPreview.js';

export function arrivalHistoryWeeks(refs) {
  return [...new Set(refs.map(ref => ref.week).filter(week => /^\d+-\d+$/.test(week)))].sort((a,b) => {
    const [am,as]=a.split('-').map(Number),[bm,bs]=b.split('-').map(Number);
    return am-bm || as-bs;
  });
}

export function compareHotelArrival(ref, rates = {}) {
  const value = rates[ref.currency];
  if (value == null || value === '') return {cost:ref.cost, applied:false, reason:ref.currency ? '' : '원문 통화 확인 필요'};
  const fx=Number(value), original=Number(ref.exchangeRate);
  if (!Number.isFinite(fx) || fx<=0) return {cost:ref.cost,applied:false,reason:'환율은 0보다 큰 숫자로 입력하세요.'};
  if (ref.conversionError || !(original>0) || !(ref.rawCost>0) || !(ref.cost>0)) return {cost:ref.cost,applied:false,reason:'원본 환율 또는 단위 확인 필요'};
  let cost;
  if (ref.sourceKind==='INVOICE') {
    if (ref.fixedPerUnitKRW == null || !Number.isFinite(ref.fixedPerUnitKRW)) return {cost:ref.cost,applied:false,reason:'승인 원가의 비용 구성 확인 필요'};
    cost=((ref.rawCost-ref.fixedPerUnitKRW)*fx/original+ref.fixedPerUnitKRW)*ref.cost/ref.rawCost;
  } else {
    if (!(ref.fxExpenseFactor>0) || ref.customsPerUnitKRW==null || ref.otherPerUnitKRW==null) return {cost:ref.cost,applied:false,reason:'원화 고정비 단위 확인 필요'};
    const result=recalcArrivalCostWithFx({...ref,selectedArrivalCostKRW:ref.rawCost,
      customsPerUnitKRW:ref.customsPerUnitKRW*ref.fxExpenseFactor,otherPerUnitKRW:ref.otherPerUnitKRW*ref.fxExpenseFactor},fx);
    cost=result.ok ? result.cost*ref.cost/ref.rawCost : NaN;
  }
  return Number.isFinite(cost) ? {cost,applied:true,reason:''} : {cost:ref.cost,applied:false,reason:'환율 비교 계산 불가'};
}
