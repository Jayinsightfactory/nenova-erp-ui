import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFreightProgress,assertFreightCountReady,freightFailureAudit,persistFreightFailure} from '../lib/estimateFreightFeedback.js';
import {describeActionLog} from '../lib/actionLogOutcome.js';
test('manual count requires explicit quantities for every selected row and never bypasses scope',()=>{
  const unknown=[{boxes:null}], drafts=[{qty:5,manualQty:true},{qty:2,manualQty:true}];
  assert.doesNotThrow(()=>assertFreightCountReady(unknown,drafts,true));
  for(const confirmation of [undefined,false,0,'true']) assert.throws(()=>assertFreightCountReady(unknown,drafts,confirmation));
  assert.throws(()=>assertFreightCountReady(unknown,[...drafts,{qty:5}],true));
  assert.throws(()=>assertFreightCountReady(unknown,[{qty:'',manualQty:true}],true));
  assert.throws(()=>assertFreightCountReady([{boxes:null,scopeError:'2025'}],drafts,true));
  assert.doesNotThrow(()=>assertFreightCountReady([{boxes:5}], [{qty:5}],false));
});
test('progress accumulates and bounds history',()=>{
  const log=appendFreightProgress(appendFreightProgress('','사전 확인','10:00'),'저장 완료','10:01');
  assert.match(log,/사전 확인\n.*저장 완료/);
  assert.equal(appendFreightProgress(Array(130).fill('log').join('\n'),'last').split('\n').length,120);
});
test('failure audit distinguishes preview, rollback, ambiguous commit and busy; excludes guard secrets',()=>{
  const body={year:2026,parentWeek:'38',custKey:515,mode:'apply',operationId:'id',editGuard:{secret:'never'},rows:[{weekShort:'38-01',prodKey:1,qty:5,cost:3}]};
  for(const [code,committing,expected] of [['FREIGHT_VALIDATION',false,'ROLLED_BACK'],['ETIMEOUT',false,'UNKNOWN'],['STOCK_GATE_BUSY',false,'UNKNOWN'],['ERR',true,'UNKNOWN']]) {
    const failure=freightFailureAudit(body,{code,message:'reason'},committing);
    assert.equal(failure.audit.outcome,expected);
    assert.ok(!JSON.stringify(failure).includes('never'));
    const display=describeActionLog({ActionType:'ESTIMATE_FREIGHT_FAILURE',Payload:JSON.stringify(failure.audit)});
    assert.equal(display.storage,expected==='UNKNOWN'?'저장 여부 확인 필요':'이번 요청 전체 롤백');
  }
  assert.equal(freightFailureAudit({...body,mode:'preview'},{}).audit.outcome,'NOT_SAVED');
  assert.equal(freightFailureAudit({...body,year:2025},{}).audit.year,'2025');
});
test('failure logger writes only audit and survives logger failure',async()=>{
  const failure=freightFailureAudit({mode:'apply'}, {message:'bad'});
  const sql={NVarChar:()=>{},MAX:1};let calls=0;
  assert.equal(await persistFreightFailure(async(q,p)=>{calls++;assert.match(q,/INSERT INTO SystemActionLog/);assert.equal(p.result.value,'FAIL');},sql,'user',failure),true);
  assert.equal(calls,1);
  assert.equal(await persistFreightFailure(async()=>{throw Error('offline');},sql,'user',failure),false);
});
