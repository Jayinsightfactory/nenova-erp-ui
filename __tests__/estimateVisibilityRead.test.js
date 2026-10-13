import assert from 'node:assert/strict';
import test from 'node:test';
import { readEstimateVisibility } from '../lib/estimateVisibilityRead.js';
const sql={NVarChar:'nvarchar',Int:'int'};
test('empty candidates return without querying views',async()=>{
  let calls=0;
  const r=await readEstimateVisibility(async()=>{calls++;return {recordset:[]};},sql,{year:'2026',weeks:['23-01'],q:'White'});
  assert.deepEqual(r,{recordset:[]});assert.equal(calls,1);
});
test('bounded numeric detail keys merge independently while preserving base order and native multiplicity',async()=>{
  const calls=[];
  const results=[
    [{SdetailKey:12,SmYear:'2026',CustKey:533,OrderWeek:'23-01'},{SdetailKey:11,SmYear:'2026',CustKey:534,OrderWeek:'23-01'}],
    [{SdetailKey:'11',InViewShipment:2},{SdetailKey:12,InViewShipment:1}],
    [{SdetailKey:12,InViewOrder:3},{SdetailKey:11,InViewOrder:1}],
    [{SdetailKey:11,VS_YW2:'20262301'},{SdetailKey:12,VS_YW2:'20262301'}],
    [{SdetailKey:12,InGetDetail:18},{SdetailKey:11,InGetDetail:6},{SdetailKey:99,InGetDetail:999}],
    [{SdetailKey:12,InGetDetailByCustProd:3}],
  ];
  const r=await readEstimateVisibility(async(text,params)=>{calls.push({text,params});return {recordset:results.shift()};},sql,
    {year:'2026',weeks:['23-01','23-02'],q:'Hydrangea White'});
  assert.deepEqual(r.recordset.map(row=>row.SdetailKey),[12,11]);
  assert.equal(r.recordset[0].InGetDetail,18);assert.equal(r.recordset[0].InGetDetailByCustProd,3);
  assert.equal(r.recordset[1].InGetDetailByCustProd,0);
  assert.equal(calls[0].params.yr.value,'2026');assert.equal(calls[0].params.w1.value,'23-02');
  for(const call of calls.slice(1))assert.deepEqual(Object.values(call.params).map(p=>p.value),[12,11]);
});
test('invalid or over-limit detail scope stops before diagnostic views',async()=>{
  for(const keys of [[0],[1.5],Array.from({length:401},(_,index)=>index+1)]) {
    let calls=0;
    await assert.rejects(readEstimateVisibility(async()=>{calls++;return {recordset:keys.map(SdetailKey=>({SdetailKey}))};},sql,
      {year:'2026',weeks:['23-01'],q:'White'}),/상세키/);
    assert.equal(calls,1);
  }
});
