import {normalizeOrderUnit} from './orderUtils.js';
import {hotelQty,hotelNameToken} from './hotelOrderWorkspace.js';
import {hotelBatchMatrix} from './hotelOrderReview.js';
export function roundHotelQuantity(value,mode) {
 if(value==='' || !Number.isFinite(Number(value)) || Number(value)<0)throw Error('0 이상의 수량을 입력하세요.');
 if(!['ceil','floor','round'].includes(mode))throw Error('수량 조절 방법을 확인하세요.');
 return Math[mode](Number(value));
}
const mappingKey=row=>`${hotelNameToken(row.inputName)}|${normalizeOrderUnit(row.originalUnit || row.unit)}`;
export function specialHotelLine(row,name) {
 const specialName=String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ');
 if(!specialName || specialName.length>100)throw Error('특수매칭 이름을 1~100자로 입력하세요.');
 return {...row,specialName,prodKey:null,prodName:specialName,displayName:specialName,matchWarning:'',matched:true};
}
export function rememberHotelSpecial(work,row,name) {
 const mappings={...work.specialMappings};if(name)mappings[mappingKey(row)]=specialHotelLine(row,name).specialName;else delete mappings[mappingKey(row)];
 return mappings;
}
export function applyHotelSpecialMappings(rows,mappings={}) {
 return rows.map(r=>mappings[mappingKey(r)]?specialHotelLine(r,mappings[mappingKey(r)]):r);
}
export function hotelFinalQuantities(work,products) {
 const request=hotelBatchMatrix(work,'request',products).rows,purchase=hotelBatchMatrix(work,'purchase',products).rows;
 const map=new Map(request.map(r=>[r.key,{...r,sourceQty:r.originalTotal,purchase:0}]));
 for(const r of purchase){if(!map.has(r.key))map.set(r.key,{...r,sourceQty:0,purchase:0});map.get(r.key).purchase=r.originalTotal;}
 return [...map.values()].map(r=>({...r,finalQty:work.orderTotals?.[r.key]?.qty ?? r.sourceQty,adjusted:work.orderTotals?.[r.key]!==undefined,registration:!r.special&&!r.excluded&&r.key.startsWith('p:')}));
}
export function setHotelFinalQuantity(work,row,value) {
 if(work.frozen)throw Error('등록을 시작한 작업은 수정할 수 없습니다.');
 if(!row.registration || row.error)throw Error('등록 가능한 품목을 확인하세요.');
 if(value==='' || !Number.isFinite(Number(value)) || Number(value)<0)throw Error('0 이상의 수량을 입력하세요.');
 return {...work,orderTotals:{...work.orderTotals,[row.key]:{qty:hotelQty(value),unit:row.unit}},allocations:{}};
}
export function omitHotelItem(work,key,excluded) {
 if(work.frozen)throw Error('등록을 시작한 작업은 수정할 수 없습니다.');
 return {...work,omitted:{...work.omitted,[key]:excluded===true},allocations:{}};
}
export function hotelRegistrationSnapshot(work,products,groups,time) {
 return {time,year:work.year,week:work.week,rows:hotelFinalQuantities(work,products).map(({key,name,unit,sourceQty,finalQty,purchase,excluded,special,registration})=>({key,name,unit,sourceQty,finalQty,purchase,excluded,special,registration:registration&&groups.some(g=>g.items.some(it=>`p:${it.prodKey}`===key&&it.qty>0))})),groups:JSON.parse(JSON.stringify(groups))};
}
