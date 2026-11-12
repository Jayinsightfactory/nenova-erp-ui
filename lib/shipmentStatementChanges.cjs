// 저장본과 현재 차수피벗 원본을 비교해 "무엇이 바뀌었는지"를 만들고,
// 바뀌지 않은 품목의 요일 배분은 그대로 이어 붙인다. 읽기 전용 계산이며 ERP/DB는 건드리지 않는다.
const {EPS,round}=require('./shipmentStatement.cjs');
const same=(a,b)=>a===b||(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=EPS);
const money=v=>v===null||v===undefined?'단가 없음':`${Number(v).toLocaleString('ko-KR')}원`;
const used=e=>Object.values(e??{}).reduce((s,v)=>round(s+Number(v||0)),0);
function reconcile(saved,source){
 const oldRows=saved?.source?.rows,oldDraft=saved?.draft??{},oldEntries=oldDraft.entries??{};
 if(!Array.isArray(oldRows))return {draft:{...oldDraft,entries:{}},changes:[{type:'reset',rowId:null,text:'저장본에 이전 원본 정보가 없어 요일 배분을 새로 입력해야 합니다.'}]};
 const changes=[],entries={},newRows=source.rows;
 const oldById=new Map(oldRows.map(r=>[r.id,r])),newById=new Map(newRows.map(r=>[r.id,r]));
 const carry=(oldRow,newRow)=>{
  const e=oldEntries[oldRow.id];if(!e||!Object.keys(e).length)return;
  if(used(e)<=newRow.qty+EPS)entries[newRow.id]=e;
  else changes.push({type:'reset',rowId:newRow.id,prodKey:newRow.prodKey,text:`${newRow.name}: 입력해 둔 요일 배분 합계(${used(e)})가 새 분배수량(${newRow.qty})보다 커서 이 품목만 배분을 비웠습니다. 요일 수량을 다시 입력하세요.`});
 };
 const info=(a,b)=>a.name!==b.name||a.category!==b.category;
 for(const row of newRows){
  const old=oldById.get(row.id);if(!old)continue;
  if(!same(old.qty,row.qty))changes.push({type:'qty',rowId:row.id,prodKey:row.prodKey,text:`${row.name}: 분배수량 ${old.qty} → ${row.qty}${row.qty>old.qty?` (늘어난 ${round(row.qty-old.qty)}은 기본 출고요일에 배정)`:''}`});
  if(info(old,row))changes.push({type:'info',rowId:row.id,prodKey:row.prodKey,text:`${row.name}: 품목명 또는 품목군이 바뀌었습니다.`});
  carry(old,row);
 }
 const gone=oldRows.filter(r=>!newById.has(r.id)),fresh=newRows.filter(r=>!oldById.has(r.id));
 const key=r=>`${r.prodKey}|${r.unit}`,goneBy=new Map(),freshBy=new Map();
 for(const r of gone)goneBy.set(key(r),[...(goneBy.get(key(r))??[]),r]);
 for(const r of fresh)freshBy.set(key(r),[...(freshBy.get(key(r))??[]),r]);
 for(const [k,olds] of goneBy){
  const news=freshBy.get(k)??[];
  if(olds.length===1&&news.length===1){
   const [o]=olds,[n]=news;
   changes.push({type:'cost',rowId:n.id,prodKey:n.prodKey,text:`${n.name}: 단가 ${money(o.cost)} → ${money(n.cost)}`});
   if(!same(o.qty,n.qty))changes.push({type:'qty',rowId:n.id,prodKey:n.prodKey,text:`${n.name}: 분배수량 ${o.qty} → ${n.qty}${n.qty>o.qty?` (늘어난 ${round(n.qty-o.qty)}은 기본 출고요일에 배정)`:''}`});
   carry(o,n);freshBy.delete(k);
  }else for(const o of olds)changes.push({type:'removed',rowId:null,prodKey:o.prodKey,text:`${o.name}: 출고 품목에서 빠졌습니다. (이전 수량 ${o.qty}, ${money(o.cost)})`});
 }
 for(const news of freshBy.values())for(const n of news)changes.push({type:'added',rowId:n.id,prodKey:n.prodKey,text:`${n.name}: 새로 추가됐습니다. (수량 ${n.qty}, ${money(n.cost)} · 기본 출고요일에 배정)`});
 const oc=saved.source.customer??{},nc=source.customer;
 if(oc.baseDay!==nc.baseDay)changes.push({type:'customer',rowId:null,text:`업체 기본 출고요일이 ${oc.baseDay} → ${nc.baseDay}로 바뀌었습니다. 이 작성본의 기본 출고요일(${oldDraft.defaultDay})은 그대로입니다.`});
 if(JSON.stringify(saved.source.calendar)!==JSON.stringify(source.calendar))changes.push({type:'calendar',rowId:null,text:'이 차수의 출고일(날짜) 달력이 바뀌었습니다.'});
 return {draft:{...oldDraft,entries},changes};
}
module.exports={reconcile};
