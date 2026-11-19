import {exeDateAmountVat} from './estimateDateQuantity.js';
import core from './estimateChangeHistoryCore.cjs';
const n=v=>Number(v),near=(a,b)=>Math.abs(n(a)-n(b))<0.000001;
const key=r=>`${r.custKey}:${r.key}`;
export function salesBaseline(raw,totals,observedAt){
 const rows=raw.map(r=>({key:r.RowKey||`${Number(r.RowSort)===0?'sdate':'est'}:${r.PhysicalKey}`,custKey:n(r.CustKey),prodKey:n(r.ProdKey),quantity:n(r.Quantity),cost:n(r.Cost),gross:n(r.Amount)}));
 const customers=Object.fromEntries(totals.map(r=>[r.CustKey,{name:r.CustName,gross:n(r.totalAmount)}]));
 const seen=new Set();let issue='';for(const r of rows){if(seen.has(key(r)))issue='동일 실제 행이 합계 조회에 중복되어 예상액을 계산할 수 없습니다.';seen.add(key(r));}
 for(const [id,c] of Object.entries(customers))if(!near(rows.filter(r=>r.custKey===Number(id)).reduce((s,r)=>s+r.gross,0),c.gross))issue='행별 금액과 견적 합계가 달라 예상액을 계산할 수 없습니다.';
 return {observedAt,taxBasis:'부가세 포함 · 전체 요일 · 견적서관리 저장 Amount+Vat',customers,total:Object.values(customers).reduce((s,c)=>s+c.gross,0),rows,issue};
}
export function historicalSales(body){
 const fields=['periodBefore','periodAfter','customerBefore','customerAfter'],v=Object.fromEntries(fields.map(k=>[k,core.number(body?.[k])]));
 for(const [a,b] of [['periodBefore','periodAfter'],['customerBefore','customerAfter']])if((v[a]===null)!==(v[b]===null))throw core.fail('당시 매출 합계는 전후를 한 쌍으로 입력하세요.');
 const source=core.text(body?.source,500),taxBasis=core.text(body?.taxBasis,100);if(fields.some(k=>v[k]!==null)&&(!source||taxBasis!=='부가세 포함'))throw core.fail('당시 합계 출처와 부가세 포함 기준을 확인하세요.');
 return {...v,source:source||null,taxBasis:taxBasis||null};
}
function line(before,after,label){return {label,before,delta:before===null||after===null?null:after-before,after};}
export function projectSales(entries,current=null){
 if(!entries.length)return {status:'unknown',reason:'매출 영향을 볼 변경 기록을 선택하세요.',lines:[]};
 const past=entries.filter(e=>e.sourceKind==='historical-manual');
 if(past.length){
  if(past.length!==entries.length)return {status:'unknown',reason:'과거 기록과 현재 변경안의 기준 시점이 달라 합산하지 않습니다.',lines:[]};
  const evidence=past.map(e=>e.historicalSales),first=evidence[0];
  const shared=first?.source&&evidence.every(x=>JSON.stringify(x)===JSON.stringify(first));
  if(!shared)return {status:'unknown',reason:'동일한 당시 전체 합계 증빙이 없습니다. 각 기록의 당시 합계만 확인하세요.',lines:[]};
  return {status:'historical',source:first.source,taxBasis:first.taxBasis,lines:[line(first.periodBefore,first.periodAfter,'선택차수 전체'),line(past.every(e=>e.customer.name===past[0].customer.name)?first.customerBefore:null,past.every(e=>e.customer.name===past[0].customer.name)?first.customerAfter:null,'당시 해당 업체 (동일 증빙)')]};
 }
 const sorted=[...entries].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),base=sorted[0].salesBaseline;
 if(!base||base.issue)return {status:'unknown',reason:base?.issue||'작성 당시 매출 기준이 기록되지 않았습니다.',lines:[]};
 const baseRows=new Map(base.rows.map(r=>[key(r),r])),targets=new Map(),names=new Map();
 for(const e of sorted){const r=e.row,id=r&&key(r),prior=targets.get(id)||baseRows.get(id);if(!prior||!e.proposedTarget)return {status:'unknown',reason:'선택 기록의 실제 행이 작성 기준 매출에 없습니다.',lines:[]};
  const start=e.currentAtRecord;if(!start||!near(start.quantity,prior.quantity)||!near(start.cost,prior.cost))return {status:'unknown',reason:'동일 행의 변경 전후가 이어지지 않거나 중복 변경안입니다. 적용할 순서의 기록만 선택하세요.',lines:[]};
  targets.set(id,{...prior,...e.proposedTarget});names.set(r.custKey,e.customer.name);
 }
 const deltas=new Map();for(const [id,target] of targets){const before=baseRows.get(id),gross=target.key.startsWith('sdate:')&&target.quantity<=0?0:exeDateAmountVat(target.cost,target.quantity).gross;target.gross=gross;deltas.set(target.custKey,(deltas.get(target.custKey)||0)+gross-before.gross);}
 const delta=[...deltas.values()].reduce((a,b)=>a+b,0),lines=[line(base.total,base.total+delta,'선택차수 전체'),...[...deltas].map(([c,d])=>line(base.customers[c]?.gross??0,(base.customers[c]?.gross??0)+d,`${names.get(c)} 업체`))];
 let measured=null;if(current&&!current.issue){const actualRows=new Map(current.rows.map(r=>[key(r),r]));let remaining=0,missing=false;for(const [id,t] of targets){const r=actualRows.get(id);if(!r){missing=true;continue;}remaining+=t.gross-r.gross;}measured={observedAt:current.observedAt,total:current.total,difference:current.total-lines[0].after,remaining:missing?null:remaining,afterRemaining:missing?null:current.total+remaining,customers:[...deltas].map(([c])=>({custKey:c,name:names.get(c),gross:current.customers[c]?.gross??0,difference:(current.customers[c]?.gross??0)-lines.find(l=>l.label===`${names.get(c)} 업체`).after}))};}
 return {status:'forecast',taxBasis:base.taxBasis,observedAt:base.observedAt,lines,physicalRows:targets.size,measured};
}
