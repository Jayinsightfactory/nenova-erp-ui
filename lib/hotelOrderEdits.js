import {normalizeOrderUnit} from './orderUtils.js';
import {hotelQty,hotelNameToken,hotelBoxFactor} from './hotelOrderWorkspace.js';
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
 return [...map.values()].map(r=>{
   const product=products[Number(r.key.split(':')[1])] || {}, original=(work.request||[]).find(l=>!l.specialName&&`p:${l.prodKey}`===r.key);
   const displayUnit=normalizeOrderUnit(original?.originalUnit || original?.unit || product.EstUnit || r.unit);
   return {...r,product,displayUnit,adjustment:work.orderTotals?.[r.key]?.adjustment,finalQty:work.orderTotals?.[r.key]?.qty ?? r.sourceQty,adjusted:work.orderTotals?.[r.key]!==undefined,registration:!r.special&&!r.excluded&&r.key.startsWith('p:')};
 });
}
export const hotelAdjustmentLabel=method=>({ceil:'올림',round:'반올림',floor:'내림',manual:'직접 수정',reset:'원본 복원'}[method] || '수량 조절');
export function hotelQuantityLabel(qty,unit,product={},preferredUnit) {
 const n=Number(qty),u=normalizeOrderUnit(unit),fmt=x=>hotelQty(x).toLocaleString('ko-KR',{maximumFractionDigits:6});
 if(!Number.isFinite(n))return '확인 필요';
 let detail=u;
 if(u==='박스')detail=['단','송이'].includes(preferredUnit)?preferredUnit:Number(product.BunchOf1Box)>0?'단':'송이';
 if(!['단','송이'].includes(detail))return `${fmt(n)} ${u}`;
 const factor=hotelBoxFactor(detail,product);
 if(!(factor>0&&Number.isFinite(factor)))return u==='박스'?`${fmt(n)} 박스`:`${fmt(n)} ${u} / 박스 기준 없음`;
 return `${fmt(u==='박스'?n*factor:n)} ${detail} / ${fmt(u==='박스'?n:n/factor)} 박스`;
}
export function setHotelFinalQuantity(work,row,value,{method='manual',before=row.finalQty,time=new Date().toISOString()}={}) {
 if(work.frozen)throw Error('등록을 시작한 작업은 수정할 수 없습니다.');
 if(!row.registration || row.error)throw Error('등록 가능한 품목을 확인하세요.');
 if(value==='' || !Number.isFinite(Number(value)) || Number(value)<0)throw Error('0 이상의 수량을 입력하세요.');
 if(!['manual','ceil','floor','round','reset'].includes(method)||!Number.isFinite(Number(before))||Number(before)<0)throw Error('수량 조절 방법을 확인하세요.');
 if(['ceil','floor','round'].includes(method)&&roundHotelQuantity(before,method)!==Number(value))throw Error('조절 결과가 방법과 일치하지 않습니다.');
 const after=hotelQty(value),adjustment={method,before:Number(before),after,time};
 const entry={key:row.key,name:row.name,unit:row.unit,...adjustment};
 const orderTotals={...work.orderTotals,[row.key]:{qty:after,unit:row.unit,adjustment}};
 if(method==='reset')delete orderTotals[row.key];
 return {...work,orderTotals,quantityHistory:[...(work.quantityHistory||[]),entry],allocations:{}};
}

export function omitHotelItem(work,key,excluded) {
 if(work.frozen)throw Error('등록을 시작한 작업은 수정할 수 없습니다.');
 return {...work,omitted:{...work.omitted,[key]:excluded===true},allocations:{}};
}
export function hotelRegistrationSnapshot(work,products,groups,time) {
 return {time,year:work.year,week:work.week,rows:hotelFinalQuantities(work,products).map(({key,name,unit,sourceQty,finalQty,purchase,excluded,special,registration,adjustment})=>({key,name,unit,sourceQty,finalQty,purchase,excluded,special,adjustment:adjustment?{...adjustment}:undefined,registration:registration&&groups.some(g=>g.items.some(it=>`p:${it.prodKey}`===key&&it.qty>0))})),quantityHistory:JSON.parse(JSON.stringify(work.quantityHistory||[])),groups:JSON.parse(JSON.stringify(groups))};
}
