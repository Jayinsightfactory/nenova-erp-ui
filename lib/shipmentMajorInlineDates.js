import {inlineDateModel} from './shipmentInlineDates.js';
import {datePackingSignature} from './shipmentDateDisplayUnits.js';
// The row axis belongs to the whole selected major week, not a single customer/product.
export function majorInlineWeekScope(facts,year,week){
 if(!Array.isArray(facts))return {weeks:null,error:'메인차수 분배 조회 중…'};
 const selected=String(week).slice(-5),major=selected.slice(0,2);
 if(!/^\d{4}$/.test(String(year))||!/^(0[1-9]|[1-4]\d|5[0-2])-0[1-4]$/.test(selected)||facts.some(r=>String(r.OrderYear)!==String(year)||!new RegExp(`^${major}-0[1-4]$`).test(r.OrderWeek)))return {weeks:null,error:'메인차수 조회 범위를 확인하세요.'};
 return {weeks:[...new Set(facts.map(r=>r.OrderWeek))].sort(),error:''};
}
// Missing rows here are presentation only. Never pass them to a date writer.
export function majorInlineDisplayRows(major,weeks){
 if(major.error||!Array.isArray(weeks))return [];
 return weeks.map(week=>major.rows.find(r=>r.week===week)??{week,absent:true,facts:[],model:{out:0,baseline:{},dates:[]}});
}
export function majorInlineDateModel(calendar,facts,year,week,custKey,prodKey){
 const selected=String(week).slice(-5),major=selected.slice(0,2),groups=new Map();
 const fail=error=>({rows:[],total:null,dayTotals:{},error});
 if(!Array.isArray(facts))return fail('메인차수 분배 조회 중…');
 if(!/^\d{4}$/.test(String(year))||!/^(0[1-9]|[1-4]\d|5[0-2])-0[1-4]$/.test(selected))return fail('선택 연도와 차수를 확인하세요.');
 if(inlineDateModel(calendar,[],year,week,true).days.length!==7)return fail('해당 차수의 전산 달력 7일을 확인할 수 없습니다.');
 for(const r of facts){
  if(String(r.OrderYear)!==String(year)||!new RegExp(`^${major}-0[1-4]$`).test(r.OrderWeek)||Number(r.CustKey)!==Number(custKey)||Number(r.ProdKey)!==Number(prodKey))return fail('메인차수 연도·업체·품목 범위가 다릅니다. 다시 조회하세요.');
  if(!groups.has(r.OrderWeek))groups.set(r.OrderWeek,[]);groups.get(r.OrderWeek).push(r);
  if(r.OutQuantity===null||r.OutQuantity===undefined||typeof r.OutQuantity==='boolean'||(r.Timestamp&&(r.ShipmentQuantity===null||r.ShipmentQuantity===undefined||typeof r.ShipmentQuantity==='boolean')))return fail('출고 수량이 누락되어 메인 합계를 확인할 수 없습니다.');
  if(Number(r.OutQuantity)!==Number(groups.get(r.OrderWeek)[0].OutQuantity)||datePackingSignature(r)!==datePackingSignature(facts[0]))return fail('출고 수량·단위 정보가 변경되었습니다. 다시 조회하세요.');
 }
 const rows=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([orderWeek,items])=>({week:orderWeek,model:inlineDateModel(calendar,items,year,orderWeek,true),facts:items}));
 if(rows.some(r=>r.model.error))return fail('세부차수 출고일·수량이 불일치합니다. 메인 합계를 확인할 수 없습니다.');
 const dayTotals={};for(const row of rows)for(const date of row.model.days)dayTotals[date.Timestamp]=(dayTotals[date.Timestamp]??0)+(row.model.baseline[date.Timestamp]??0);
 return {rows,total:rows.reduce((sum,r)=>sum+r.model.out,0),dayTotals,error:''};
}
