import { normalizeCycleRequest, dateKey } from './weekdayEstimateCycle.js';

export function normalizeWeekdayPrintRequest(body={}) {
  const scope=normalizeCycleRequest(body);
  const custKey=Number(body.custKey);
  if(!Number.isInteger(custKey)||custKey<=0) throw new Error('출력 거래처를 확인하세요.');
  if(!['dates','major'].includes(body.mode)) throw new Error('날짜 또는 대차수 출력 방식을 지정하세요.');
  const dates=body.mode==='major' ? [] : [...new Set((Array.isArray(body.dates)?body.dates:[]).map(dateKey))].sort();
  if(body.mode==='dates' && (!dates.length||dates.length>7)) throw new Error('같은 업무 주기의 출력 날짜를 1~7개 선택하세요.');
  return {...scope,custKey,mode:body.mode,dates};
}

export function validateWeekdayPrintDates(scope,cycles) {
  if(scope.mode==='major') return scope;
  const cycle=cycles.find(row=>row.offset===0 && row.year===scope.year && row.majorWeek===scope.majorWeek);
  if(!cycle || cycle.calendarState!=='FOUND' || scope.dates.some(date=>!cycle.days.some(day=>day.date===date&&day.calendarState==='FOUND'))) {
    throw new Error('선택 날짜가 해당 차수의 확인된 목~수 전산 달력에 없습니다.');
  }
  return scope;
}

export function mapWeekdayPrintRow(row) {
  return {ProdKey:row.ProdKey,ProdName:row.ProdName,Quantity:Number(row.EstQuantity)||0,
    Cost:Number(row.Cost)||0,Amount:Number(row.Amount)||0,Vat:Number(row.Vat)||0,
    Descr:row.Descr||'',EstimateType:Number(row.Sort)===0?'정상출고':row.EstimateTypeRaw||'',
    UnitQuantity:row.UnitQuantity,RowNum:row.RowNum,OrderNo:row.OrderNo,GroupNo:row.GroupNo,GroupName:row.GroupName,
    _exeParity:true,_exePrint:true};
}
