import test from 'node:test';
import assert from 'node:assert/strict';
import {specialHotelLine,rememberHotelSpecial,applyHotelSpecialMappings,roundHotelQuantity,hotelFinalQuantities,setHotelFinalQuantity,omitHotelItem,hotelRegistrationSnapshot,hotelQuantityLabel,hotelAdjustmentLabel} from '../lib/hotelOrderEdits.js';
import {buildHotelOrderRows,hotelRegistrationPlan} from '../lib/hotelOrderWorkspace.js';
import {commitHotelReview,hotelBatchMatrix,editHotelBatchQuantity} from '../lib/hotelOrderReview.js';
const products={10:{ProdKey:10,DisplayName:'Rose',OutUnit:'단',BunchOf1Box:10}},customers=[{CustKey:1,CustName:'A'},{CustKey:2,CustName:'B'},{CustKey:3,CustName:'C'}];
const empty=year=>({year,week:'45-01',request:[],purchase:[],allocations:{},pinned:[],receipts:[],history:[],frozen:false,raum:1,surplus:2});
const row=(id,qty=1)=>({id,inputName:'Original',prodKey:10,unit:'단',qty,originalQty:qty,originalUnit:'단'});
const save=(w,id,rows)=>commitHotelReview({...w,pending:{request:{id,rows}}},'request','now');
test('special mapping is direct, persistent, scoped by original name/unit; three batches sum without ERP product',()=>{
 for(const year of ['2025','2026']){
  let w=empty(year),r=specialHotelLine(row('a',1.5),'  특수  꽃 ');assert.equal(r.prodKey,null);assert.equal(r.originalQty,1.5);
  w.specialMappings=rememberHotelSpecial(w,r,r.specialName);
  const later=applyHotelSpecialMappings([row('b',2.5)],w.specialMappings)[0];assert.equal(later.specialName,'특수 꽃');
  assert.equal(applyHotelSpecialMappings([{...row('c'),unit:'송이',originalUnit:'송이'}],w.specialMappings)[0].specialName,undefined);
  w=save(w,'one',[r]);w=save(w,'two',[later]);w=save(w,'three',[specialHotelLine(row('c',3),'특수 꽃')]);
  let matrix=hotelBatchMatrix(w,'request',products);assert.equal(matrix.rows.length,1);assert.equal(matrix.rows[0].total,7);
  w=editHotelBatchQuantity(w,'request','one',matrix.rows[0].key,4,products);matrix=hotelBatchMatrix(w,'request',products);assert.equal(matrix.rows[0].total,9.5);assert.equal(w.request[0].originalQty,1.5);
  assert.deepEqual(buildHotelOrderRows(w.request,[],products).rows,[]);assert.equal(w.year,year);assert.deepEqual(rememberHotelSpecial(w,r,null),{});
 }
 for(const name of ['', ' ', 'x'.repeat(101)])assert.throws(()=>specialHotelLine(row('a'),name));
});
test('all batch totals drive final adjusted classification and ADD groups; snapshot conserves evidence',()=>{
 for(const year of ['2025','2026']){
  let w=save(save(save(empty(year),'a',[row('a',2.5)]),'b',[row('b',3.5)]),'c',[row('c',4.5)]);
  const final=hotelFinalQuantities(w,products)[0];assert.equal(final.sourceQty,10.5);
  w=setHotelFinalQuantity(w,final,roundHotelQuantity(final.finalQty,'ceil'));
  w.purchase=[row('purchase',1)];let model=buildHotelOrderRows(w.request,w.purchase,products,w.allocations,w);
  assert.equal(model.rows[0].request,11);assert.equal(model.rows[0].originalRequest,10.5);assert.equal(model.rows[0].surplus,10);
  const groups=hotelRegistrationPlan(model,{...w,customers});assert.deepEqual(groups.map(g=>[g.custKey,g.items[0].qty]),[[1,1],[2,10]]);assert.ok(groups.every(g=>g.year===year&&g.week==='45-01'));
  const snapshot=hotelRegistrationSnapshot(w,products,groups,'now');assert.equal(snapshot.rows[0].sourceQty,10.5);assert.equal(snapshot.rows[0].finalQty,11);groups[0].items[0].qty=999;assert.equal(snapshot.groups[0].items[0].qty,1);
  const edited=editHotelBatchQuantity(w,'request','b','p:10',5,products);assert.deepEqual(edited.orderTotals,{});assert.equal(hotelFinalQuantities(edited,products)[0].finalQty,12);
 }
});
test('omissions retain source rows, exclude totals and invalid mappings, and restore explicitly',()=>{
 let w=save(empty('2026'),'a',[row('a',10),{...row('bad',5),prodKey:null},specialHotelLine(row('s',3),'Special')]);
 w=omitHotelItem(w,'r:bad',true);w=omitHotelItem(w,'s:special:단',true);
 assert.equal(w.request.length,3);assert.equal(hotelBatchMatrix(w,'request',products).rows.find(r=>r.key==='r:bad').total,0);
 let model=buildHotelOrderRows(w.request,[],products,w.allocations,w);assert.deepEqual(model.errors,[]);assert.equal(hotelRegistrationPlan(model,{...w,customers})[0].items[0].qty,10);
 w=omitHotelItem(w,'r:bad',false);assert.ok(buildHotelOrderRows(w.request,[],products,w.allocations,w).errors.length>0);
 w=omitHotelItem(w,'p:10',true);assert.equal(hotelFinalQuantities(w,products)[0].registration,false);assert.equal(hotelFinalQuantities(w,products)[0].sourceQty,10);
});
test('explicit zero, invalid, stale units, frozen state and rounding boundaries are guarded',()=>{
 const w=save(empty('2026'),'a',[row('a',1.5)]),r=hotelFinalQuantities(w,products)[0];
 const zero=setHotelFinalQuantity(w,r,0);assert.equal(zero.orderTotals['p:10'].qty,0);assert.equal(hotelRegistrationSnapshot(zero,products,[],'now').rows[0].registration,false);
 for(const v of ['',-1,NaN,Infinity]){assert.throws(()=>setHotelFinalQuantity(w,r,v));assert.throws(()=>roundHotelQuantity(v,'ceil'));}
 for(const mode of ['ceil','round','floor'])assert.equal(roundHotelQuantity(0,mode),0);
 assert.deepEqual(['ceil','round','floor'].map(m=>roundHotelQuantity(2.49,m)),[3,2,2]);assert.equal(roundHotelQuantity(2.5,'round'),3);assert.equal(roundHotelQuantity(2,'ceil'),2);assert.throws(()=>roundHotelQuantity(2,'bad'));
 assert.throws(()=>setHotelFinalQuantity({...w,frozen:true},r,3));assert.throws(()=>omitHotelItem({...w,frozen:true},r.key,true));
 const changed=setHotelFinalQuantity(w,r,2);assert.ok(buildHotelOrderRows(w.request,[],{10:{...products[10],OutUnit:'송이',SteamOf1Box:100,SteamOf1Bunch:10}},w.allocations,changed).errors.some(e=>e.includes('최종수량')));
});


test('direct rounding and reset persist accurate history and immutable registration evidence across years',()=>{
 for(const year of ['2025','2026']){
  let w=save(empty(year),'one',[row('a',23.2)]);
  for(const [method,before,after] of [['ceil',23.2,24],['round',23.5,24],['floor',23.8,23]]){
   w=setHotelFinalQuantity(w,hotelFinalQuantities(w,products)[0],after,{method,before,time:'2026-10-29T00:00:00Z'});
   const current=hotelFinalQuantities(w,products)[0];assert.equal(current.adjustment.method,method);
   assert.deepEqual(w.quantityHistory.at(-1),{key:'p:10',name:'Rose',unit:'단',method,before,after,time:'2026-10-29T00:00:00Z'});
  }
  const snap=hotelRegistrationSnapshot(w,products,[],'now');assert.equal(snap.rows[0].adjustment.method,'floor');assert.equal(snap.quantityHistory.length,3);
  w.quantityHistory[0].after=99;assert.equal(snap.quantityHistory[0].after,24);
  w=setHotelFinalQuantity(w,hotelFinalQuantities(w,products)[0],23.2,{method:'reset'});assert.equal(w.orderTotals['p:10'],undefined);assert.equal(w.quantityHistory.at(-1).method,'reset');assert.equal(w.year,year);
  assert.throws(()=>setHotelFinalQuantity(w,hotelFinalQuantities(w,products)[0],23,{method:'ceil',before:23.2}));
 }
});
test('dual quantity labels use actual factors without changing quantities or inventing missing ratios',()=>{
 assert.equal(hotelAdjustmentLabel(undefined),'수량 조절');
 assert.equal(hotelQuantityLabel(23.2,'박스',{SteamOf1Box:30},'송이'),'696 송이 / 23.2 박스');
 assert.equal(hotelQuantityLabel(38,'단',{BunchOf1Box:10}),'38 단 / 3.8 박스');
 assert.equal(hotelQuantityLabel(24,'박스',{BunchOf1Box:10},'단'),'240 단 / 24 박스');
 assert.equal(hotelQuantityLabel(6,'송이',{}),'6 송이 / 박스 기준 없음');
 assert.equal(hotelQuantityLabel(6,'송이',{SteamOf1Box:0}),'6 송이 / 박스 기준 없음');
 assert.equal(hotelQuantityLabel(2,'박스',{}),'2 박스');
 assert.equal(hotelQuantityLabel(0,'단',{BunchOf1Box:10}),'0 단 / 0 박스');
});
