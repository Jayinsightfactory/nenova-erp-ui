import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';

const finite = value => typeof value==='number' && Number.isFinite(value);
const array = value => Array.isArray(value)?value:[];
const same = (a,b) => finite(a) && finite(b) && Math.abs(a-b)<0.000001;

// Compare saved estimate quantities (EstUnit), never sum/convert OutUnit or browser proposals.
export function reconcileWeekdayQuote(block, prodKey, result) {
  if(!result || result.error) return {state:'조회 필요',error:result?.error,quantity:null,unit:null};
  if(Number(result.year)!==Number(block.cycle.year) || String(result.majorWeek)!==String(block.cycle.majorWeek))
    return {state:'범위 불일치',quantity:null,unit:null};
  const items=array(result.items).filter(row=>Number(row.ProdKey)===Number(prodKey));
  const normal=items.filter(row=>row.EstimateType==='정상출고');
  const units=block.productActuals.map(row=>normalizeWeekdayUnit(row.estUnit));
  const unitValues=[...new Set(units)];
  const unit=units.length && units.every(Boolean) && unitValues.length===1?unitValues[0]:null;
  if(items.some(row=>!finite(row.Quantity)||!finite(row.Amount)||!finite(row.Vat))) return {state:'수량·금액 확인 필요',quantity:null,unit};
  const quantity=normal.reduce((sum,row)=>sum+row.Quantity,0);
  const netQuantity=items.reduce((sum,row)=>sum+row.Quantity,0);
  const amount=items.reduce((sum,row)=>sum+row.Amount+row.Vat,0);
  const dates=block.productActuals.flatMap(row=>array(row.shipmentDates));
  const calendarDays=array(block.cycle.days);
  const dateKeys=new Set(calendarDays.map(row=>row.date));
  const calendarProblem=block.cycle.calendarState!=='FOUND' || calendarDays.length!==7
    || calendarDays.some(row=>row.calendarState!=='FOUND');
  const sourceReview=dates.some(row=>finite(row.estimateQuantity)&&row.estimateQuantity>0
    && (row.detailFixed!==true || !Number.isInteger(Number(row.weekDay)) || Number(row.weekDay)<1
      || Number(row.weekDay)>7 || !dateKeys.has(String(row.date??'').slice(0,10))));
  const undatedPositive=block.productActuals.some(row=>finite(row.shipmentOutQuantity)&&row.shipmentOutQuantity>0
    && !array(row.shipmentDates).length);
  const eligible=dates.filter(row=>row.detailFixed===true && Number(row.weekDay)>=1 && Number(row.weekDay)<=7 && finite(row.estimateQuantity)&&row.estimateQuantity>0);
  const unknown=dates.some(row=>typeof row.detailFixed!=='boolean' || !finite(row.estimateQuantity) || !finite(row.cost) || !finite(row.amount) || !finite(row.vat));
  const byCost=new Map();
  for(const row of eligible)byCost.set(row.cost,(byCost.get(row.cost)??0)+row.estimateQuantity);
  const expected=[...byCost.values()].reduce((sum,value)=>sum+Math.round(value),0);
  const normalAmount=normal.reduce((sum,row)=>sum+row.Amount+row.Vat,0);
  const expectedAmount=eligible.reduce((sum,row)=>sum+row.amount+row.vat,0);
  let state=!unit || unknown || calendarProblem || sourceReview || undatedPositive?'대조 확인 필요':!normal.length && !eligible.length?'견적 없음'
    :same(expected,quantity) && same(expectedAmount,normalAmount)?'견적 일치':'견적 불일치';
  const management=array(result.managementItems).filter(row=>Number(row.ProdKey)===Number(prodKey));
  const managementKnown=Array.isArray(result.managementItems) && !result.managementError
    && management.every(row=>finite(row.Quantity)&&finite(row.Amount)&&finite(row.Vat));
  const managementQuantity=managementKnown?management.reduce((sum,row)=>sum+row.Quantity,0):null;
  const managementAmount=managementKnown?management.reduce((sum,row)=>sum+row.Amount+row.Vat,0):null;
  const managementChecked=Array.isArray(result.managementItems) || Boolean(result.managementError);
  if(managementChecked && !managementKnown) state='관리 대조 확인 필요';
  else if(managementKnown && (!same(netQuantity,managementQuantity)||!same(amount,managementAmount))) state='견적 불일치';
  return {state,quantity,netQuantity,managementQuantity,managementAmount,unit,amount,expectedQuantity:unknown?null:expected,
    difference:unknown?null:Number((quantity-expected).toFixed(6)),normalAmount,expectedAmount,
    note:'관리 합계는 날짜별 상세와 차감·판매요청 포함. 인쇄 순수량은 단가별 반올림 합계. 분배 단위/초안과 별도; 반올림 또는 조회범위 차이는 불일치로 표시.'};
}
