import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSharedAwbCost as calculate } from '../lib/invoiceSharedAwbCost.js';

function fixture() {
  const members = Array.from({length:13},(_,i) => ({documentId:`doc-${i}`,revision:1,sourceHash:'a'.repeat(64),
    orderYear:'2026',orderWeek:'45-01',country:'CO',currency:'USD',awb:'160-17338005',farmName:`farm-${i}`,invoiceNo:`invoice-${i}`,
    rows:[{lineId:`line-${i}`,prodKey:i+1,actualQuantity:300,unit:'STEM',unitPrice:1,lineAmount:300,currency:'USD',boxQuantity:10,stemQuantity:300}],
    lineInputs:[{lineId:`line-${i}`,groupId:'HYDRANGEA',tariffRate:0}]}));
  return {manifest:{orderYear:'2026',orderWeek:'45-01',awb:'16017338005',currency:'USD',members:members.map(({documentId,revision,sourceHash})=>({documentId,revision,sourceHash}))},
    members,input:{gw:3483,cw:4307,freightCurrency:'USD',freightAmount:4307*2.95+72,exchangeRate:1400,customsTotalKRW:1000}};
}
test('13 farms share the AWB freight exactly once without invented farm CW',()=>{
  const f=fixture(),before=JSON.stringify(f),r=calculate(f);
  assert.equal(r.status,'CALCULATED'); assert.deepEqual(r.issues,[]);
  assert.equal(r.lines.length,13);assert.equal(r.farms.length,13);
  assert.equal(r.totals.freightNative,12777.65);assert.equal(r.totals.customsKRW,1000);
  assert.equal(r.costGroups[0].grossWeightKg,3483);assert.equal(r.costGroups[0].volumeWeightKg,4307);
  assert.equal(r.measuredFarmCwAvailable,false);assert.equal(JSON.stringify(f),before);
  assert.ok(Math.abs(r.lines[0].componentAmounts.freightNative-12777.65/13)<.000001);
});
test('zero costs are explicit valid values; missing costs block',()=>{
  const f=fixture();f.input.freightAmount=0;f.input.customsTotalKRW=0;
  assert.equal(calculate(f).status,'CALCULATED');
  for(const value of [undefined,null,'',false]) { f.input.customsTotalKRW=value;assert.equal(calculate(f).status,'BLOCKED'); }
});
test('missing, duplicated, stale, different-year and wrong-AWB members are rejected',()=>{
  for(const mutate of [f=>f.members.pop(),f=>f.members[1]=f.members[0],f=>f.members[0].revision++,
    f=>f.members[0].orderYear='2025',f=>f.members[0].orderWeek='44-01',f=>f.members[0].awb='160-99999999',
    f=>f.members[0].currency='EUR',f=>f.members[0].country='EC',f=>f.manifest.members[1]=f.manifest.members[0],
    f=>f.members[1].rows[0].lineId=f.members[0].rows[0].lineId]) {
    const f=fixture();mutate(f);assert.throws(()=>calculate(f));
  }
});
test('mixed groups reproduce reference weight versus volume branches',()=>{
  const f=fixture();f.members=f.members.slice(0,2);f.manifest.members=f.manifest.members.slice(0,2);
  f.members[0].lineInputs[0].groupId='ROSE';f.members[1].lineInputs[0].groupId='CARNATION';
  assert.throws(()=>calculate(f),error=>error.code==='AWB_FULL_BOX_COUNTS_REQUIRED');
  f.input.fullBoxCounts={ROSE:10,CARNATION:10};
  f.input.freightAmount=190;f.input.customsTotalKRW=190;
  let r=calculate(f);assert.equal(r.status,'CALCULATED');
  assert.equal(r.lines[0].componentAmounts.freightNative,100);
  assert.equal(r.lines[0].componentAmounts.customsKRW,80);
  f.input.cw=f.input.gw;r=calculate(f);assert.equal(r.lines[0].componentAmounts.freightNative,80);
});
test('stale farm allocation weights are replaced by whole-AWB proportions without mutating source',()=>{
  const f=fixture();Object.assign(f.members[0].lineInputs[0],{grossWeightKg:999,volumeWeightKg:999,allocationShare:0});
  assert.equal(calculate(f).status,'CALCULATED');assert.equal(f.members[0].lineInputs[0].grossWeightKg,999);
});
