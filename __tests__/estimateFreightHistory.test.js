import test from 'node:test';
import assert from 'node:assert/strict';
import { previousFreightHistory, editFreightInput, freightInputTotal } from '../lib/estimateFreightHistory.js';
import { validateFreightDraft } from '../lib/estimateFreightDraft.js';

const scope = {year:2026,parentWeek:38,custKey:515};
const row = {OrderYear:'2026',OrderWeek:'37-01',CustKey:515,ProdKey:2262,ProdName:'현지상차운임',Quantity:1,Cost:181500,Amount:165000,Vat:16500,Unit:'박스',SdateKey:120725};
test('previous customer freight excludes current/future year-week, other customer and deductions',()=>{
  const result=previousFreightHistory([row,{...row,OrderYear:'2025'},{...row,CustKey:516},{...row,OrderWeek:'38-01'},{...row,OrderWeek:'39-01'},{...row,EstimateKey:42},{...row,Quantity:-1}],scope);
  assert.deepEqual(result.map(item=>item.week),['37']);
  assert.equal(result[0].rows.length,1);
  assert.equal(result[0].total,181500);
});
test('previous available parent week retains subweeks and persisted amount, no duplicate date totals',()=>{
  const result=previousFreightHistory([row,row,{...row,OrderWeek:'37-02',SdateKey:120726,Cost:88000,Amount:80000,Vat:8000},{...row,OrderWeek:'35-01',SdateKey:119000}],scope);
  assert.deepEqual(result.map(item=>item.week),['37','35']);
  assert.equal(result[0].total,269500);
  assert.deepEqual(result[0].rows.map(item=>item.OrderWeek),['37-01','37-02']);
  assert.equal(previousFreightHistory([{...row,Amount:0,Vat:0}],scope)[0].total,0);
  assert.equal(previousFreightHistory([{...row,Amount:undefined}],scope)[0].total,null);
  assert.deepEqual(previousFreightHistory([{...row,OrderWeek:'01-01'}],{...scope,parentWeek:1}),[]);
});
test('typing selects only that freight draft and preserves zero/empty for validation',()=>{
  for (const value of ['',0,'0',false,1500]) {
    const next=editFreightInput({qty:4,cost:3000,enabled:false},{cost:value});
    assert.equal(next.enabled,true);
    assert.equal(next.cost,value);
    assert.equal(next.qty,4);
  }
  assert.deepEqual(editFreightInput(undefined,{qty:'5'}),{qty:'5',enabled:true,manualQty:true});
  const draft={name:'현지상차운임',weekShort:'38-01',shipmentDate:'2026-09-17',prodKey:2262,qty:5,cost:2000};
  const options={...scope,products:[{ProdKey:2262,ProdName:'현지상차운임',OutUnit:'박스'}]};
  assert.equal(validateFreightDraft([editFreightInput(draft,{qty:6})],options)[0].qty,6);
  for(const value of ['',0,-1,'NaN']) assert.throws(()=>validateFreightDraft([editFreightInput(draft,{cost:value})],options));
});
test('input total follows ERP integer quantity rounding instead of showing a different billed amount',()=>{
  assert.equal(freightInputTotal(61,3000),183000);
  assert.equal(freightInputTotal(4.5,3000),15000);
  assert.equal(freightInputTotal(4.4,3000),12000);
  for(const value of [undefined,null,'',0,false,-1,Infinity,'NaN']) assert.equal(freightInputTotal(value,3000),null);
});
