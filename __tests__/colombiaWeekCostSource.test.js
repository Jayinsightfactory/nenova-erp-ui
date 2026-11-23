import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareColombiaWeekCost,COLOMBIA_WEEK_SOURCE_SQL} from '../lib/colombiaWeekCostSource.js';
import {nativeLineId} from '../lib/nativeReceiptCost.js';
const request={country:'CO',orderYear:'2026',orderWeek:'46-02'},types={NVarChar:n=>`nvarchar(${n})`};
const row=(key,flower='장미',extra={})=>({WarehouseKey:key,OrderYear:'2026',OrderWeek:'46-02',OrderNo:'014-41369974',FarmName:'TEST_ONLY',InvoiceNo:`TEST_ONLY-${key}`,WdetailKey:key*10,ProdKey:key,ProdName:flower==='수국'?'HYDRANGEA Test':'ROSE Test',CounName:'콜롬비아',FlowerName:flower,OutUnit:'송이',BoxQuantity:1,BunchQuantity:10,SteamQuantity:100,OutQuantity:100,UPrice:1,TPrice:100,SteamOf1Bunch:10,SteamOf1Box:100,...extra});
const read=(rows,input=request)=>prepareColombiaWeekCost({request:input,types,queryFn:async(statement,params)=>{assert.equal(statement,COLOMBIA_WEEK_SOURCE_SQL);assert.equal(params.orderYear.value,input.orderYear);assert.equal(params.orderWeek.value,input.orderWeek);assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|EXEC)\b/);return{recordset:rows};}});
test('reads complete exact-year/week native goods, including hydrangea in same receipt; no forced main/hydrangea split',async()=>{
 const r=await read([row(1),row(1,'수국',{WdetailKey:11,ProdKey:2}),row(3,'장미',{OrderNo:'01441369974'}),row(3,'장미',{WdetailKey:31,ProdName:'AIR FREIGHT',TPrice:200})]);
 assert.equal(r.members.length,2);assert.equal(r.awbs.length,1);assert.equal(r.members[0].rows.length,2);assert.deepEqual(r.members[0].lineInputs.map(r=>r.groupId),['ROSE','HYDRANGEA']);assert.equal(r.excluded.length,1);assert.equal(r.status,'SOURCE_READY');
});
test('unrelated country excluded, but foreign/unknown goods sharing CO AWB require review and are not silently allocated',async()=>{
 const r=await read([row(1),row(2,'장미',{CounName:'에콰도르'}),row(3,'장미',{CounName:'태국',OrderNo:'other'})]);
 assert.equal(r.members.length,1);assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.issues[0].code,'AWB_FOREIGN_GOODS_REVIEW');assert.equal(r.issues[0].warehouseKey,2);
});
test('only ambiguous receipt AWB and product classification need explicit choices; valid native AWB cannot be overridden',async()=>{
 const a=row(1,'미확인',{OrderNo:'',ProdName:'Unknown'}),lineId=nativeLineId([1,10]);
 assert.equal((await read([a])).issues.length,2);
 const choices={...request,awbAssignments:[{warehouseKey:1,awb:'01441369974',sourceId:'TEST_ONLY original',confirmed:true}],lineInputs:[{lineId,groupId:'HYDRANGEA'}]};
 assert.equal((await read([a],choices)).status,'SOURCE_READY');
 await assert.rejects(read([row(1)],choices),e=>e.code==='WEEK_AWB_OVERRIDE_FORBIDDEN');
});
test('same week other year, duplicate detail and failed source cannot become healthy zero',async()=>{
 await assert.rejects(read([row(1,'장미',{OrderYear:'2025'})]),e=>e.code==='WEEK_SOURCE_SCOPE_MISMATCH');
 await assert.rejects(read([row(1),row(1)]),e=>e.code==='WEEK_SOURCE_DUPLICATE');
 await assert.rejects(prepareColombiaWeekCost({request,types,queryFn:async()=>({})}),e=>e.code==='WEEK_SOURCE_UNAVAILABLE');
});
