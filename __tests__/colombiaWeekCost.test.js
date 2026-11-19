import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateColombiaWeekCost as calculate} from '../lib/colombiaWeekCost.js';
const scope={country:'CO',orderYear:'2026',orderWeek:'46-02'};
function awb(number,warehouseKey,groupId='ROSE',freight=100){
 const lineId=`line-${warehouseKey}`,member={documentId:`native-${warehouseKey}`,warehouseKey,revision:1,sourceHash:'a'.repeat(64),...scope,country:'CO',currency:'USD',awb:number,farmName:`TEST_ONLY-${warehouseKey}`,invoiceNo:`TEST_ONLY-${warehouseKey}`,
  rows:[{lineId,prodKey:warehouseKey,actualQuantity:100,unit:'STEM',unitPrice:1,lineAmount:100,currency:'USD',boxQuantity:1,stemQuantity:100}],lineInputs:[{lineId,groupId,tariffRate:0,stemsPerBunch:10}]};
 return {manifest:{...scope,awb:number,currency:'USD',members:[{documentId:member.documentId,revision:1,sourceHash:member.sourceHash}]},members:[member],input:{gw:100,cw:120,freightCurrency:'USD',freightAmount:freight,exchangeRate:1400}};
}
function fixture(){return{scope,awbs:[awb('01441369974',1),awb('16017338005',2,'HYDRANGEA',200)],customsPools:[{sourceId:'TEST_ONLY shared bill',awbs:['01441369974','16017338005'],amountKRW:1000,confirmed:true}]};}
test('different AWB freight remains separate; shared customs once; general flowers and hydrangea included',()=>{
 const f=fixture(),before=JSON.stringify(f),r=calculate(f);assert.equal(r.status,'CALCULATED');assert.equal(r.lines.length,2);assert.equal(r.awbCount,2);
 assert.equal(r.lines[0].componentAmounts.freightNative,100);assert.equal(r.lines[1].componentAmounts.freightNative,200);
 assert.equal(r.totals.freightNative,300);assert.equal(r.totals.customsKRW,1000);assert.equal(r.weights.reduce((s,w)=>s+w.cw,0),240);assert.equal(JSON.stringify(f),before);
});
test('split/reordered input and repeated same customs source preserve calculation; equal distinct sources remain',()=>{
 const f=fixture(),r=calculate(f);f.awbs.reverse();f.customsPools.push(structuredClone(f.customsPools[0]));assert.deepEqual(calculate(f),r);
 f.customsPools.push({...f.customsPools[0],sourceId:'TEST_ONLY another actual bill'});assert.equal(calculate(f).totals.customsKRW,2000);
 f.customsPools[1].amountKRW=999;assert.throws(()=>calculate(f),e=>e.code==='CUSTOMS_SOURCE_CONFLICT');
});
test('same AWB must be one whole pool, never repeated CW/freight; same receipt/detail cannot cross AWBs',()=>{
 for(const change of [f=>f.awbs.push({...f.awbs[0],manifest:{...f.awbs[0].manifest,awb:'014-41369974'}}),f=>f.awbs[1].members[0].warehouseKey=1,f=>f.awbs[1].members[0].rows[0].lineId='line-1']){const f=fixture();change(f);assert.throws(()=>calculate(f));}
});
test('late hydrangea creates next version, prior input/result untouched and no receipt registration',()=>{
 const f=fixture();f.awbs.pop();f.customsPools[0].awbs.pop();const old=calculate(f),saved=JSON.stringify(old);
 f.awbs.push(awb('16017338005',2,'HYDRANGEA',200));f.customsPools[0].awbs.push('16017338005');const next=calculate(f);
 assert.equal(next.lines.length,2);assert.notEqual(next.versionHash,old.versionHash);assert.equal(JSON.stringify(old),saved);
});
test('cross-year/week/country, unknown customs and missing weights are not healthy zero',()=>{
 for(const change of [f=>f.scope={...scope,orderYear:'2025'},f=>f.awbs[0].manifest.orderWeek='46-01',f=>f.awbs[0].members[0].country='EC',f=>f.customsPools=[],f=>f.customsPools[0].amountKRW=null,f=>f.awbs[0].input.cw=null]){const f=fixture();change(f);assert.throws(()=>calculate(f));}
 const f=fixture();f.customsPools[0].amountKRW=0;assert.equal(calculate(f).totals.customsKRW,0);
});
