import test from 'node:test';
import assert from 'node:assert/strict';
import {readCountryOrderEvidence,COUNTRY_ORDER_DETAILS_SQL,COUNTRY_ORDER_EVENTS_SQL} from '../lib/countryOrderEvidenceApi.js';
const types={NVarChar:n=>`nvarchar(${n})`};
test('explicit exact country/year/week binds details and native history, preserves units and IDs',async()=>{
  const calls=[];
  const result=await readCountryOrderEvidence({scope:{country:'China',year:2026,orderWeek:'47-02'},types,queryFn:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('OffsetMinutes'))return{recordset:[{OffsetMinutes:540}]};
    if(sql===COUNTRY_ORDER_DETAILS_SQL)return{recordset:[{OrderDetailKey:9,CustKey:3,ProdKey:4,OutUnit:'단',OutQuantity:120}]};
    return{recordset:[{OrderHistoryKey:8,OrderDetailKey:9,CustKey:3,ProdKey:4,OutUnit:'단',BeforeValue:100,AfterValue:120,At:'2026-11-19T15:11:51.017+09:00'}]};
  }});
  for(const call of calls.slice(1)){assert.equal(call.params.orderYear.value,'2026');assert.equal(call.params.orderWeek.value,'47-02');assert.equal(call.params.counName.value,'중국');assert.match(call.sql,/SELECT/);assert.doesNotMatch(call.sql,/\b(?:INSERT|UPDATE|DELETE|EXEC)\b/);}
  assert.equal(result.details[0].unit,'bunches');assert.equal(result.events[0].id,'history:8');assert.equal(result.events[0].orderDetailKey,9);assert.equal(result.events[0].kind,'increase');
  assert.match(COUNTRY_ORDER_EVENTS_SQL,/oh.ColumName=N'주문수량'/);
});
test('unknown server timezone fails before detail/history queries',async()=>{
  let calls=0;await assert.rejects(readCountryOrderEvidence({scope:{country:'China',year:2025,orderWeek:'47-02'},types,queryFn:async()=>{calls++;return{recordset:[{OffsetMinutes:0}]};}}),/시각 기준/);assert.equal(calls,1);
});
