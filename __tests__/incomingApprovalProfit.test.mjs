import test from 'node:test';
import assert from 'node:assert/strict';
import {withErpReadContext,erpContextCache} from '../lib/erpReadContext.js';
import {query,getPool} from '../lib/db.js';
import {getKcsTaxableRate} from '../lib/kcsTaxableRate.js';
import {computeIncomingApprovalProfit,approvalProfitPolicyHash} from '../lib/incomingApprovalProfit.js';

test('report context serializes SQL and isolates concurrent transactions and phase caches',async()=>{
 const shared=new Map([['prior',1]]),seen=[];
 await Promise.all([1,2].map(id=>withErpReadContext({queryFn:async()=>{seen.push(id);await new Promise(r=>setTimeout(r,2));return {recordset:[{id}]};}},async()=>{
  const cache=erpContextCache('sample',shared);assert.equal(cache.size,0);cache.set('phase',id);
  const result=await Promise.all([query('SELECT 1'),query('SELECT 2')]);assert.deepEqual(result.map(r=>r.recordset[0].id),[id,id]);assert.equal(cache.get('phase'),id);
 })));
 assert.equal(shared.size,1);assert.equal(seen.length,4);
 await withErpReadContext({queryFn:async()=>({recordset:[]})},async()=>assert.equal(erpContextCache('sample',shared).size,0));
});
test('swallowed SQL failure, raw pool bypass and write attempt still fail the whole calculation',async()=>{
 for(const fn of [()=>query('SELECT 1').catch(()=>null),()=>getPool().catch(()=>null),()=>query('UPDATE Product SET Stock=0').catch(()=>null)]){
  await assert.rejects(()=>withErpReadContext({queryFn:async()=>{throw Error('source failure');}},fn),{code:'APPROVAL_REPORT_SOURCE_FAILED'});
 }
});
test('transaction KCS reads replay exact evidence and never make external requests',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};
 try{
  await assert.rejects(()=>withErpReadContext({queryFn:async()=>({recordset:[]})},()=>getKcsTaxableRate({currency:'EUR',declarationDate:'2026-10-01'})),e=>e.code==='APPROVAL_EXTERNAL_EVIDENCE_REQUIRED'&&e.evidenceKeys[0]==='EUR::2026-10-01');
  const result=await withErpReadContext({queryFn:async()=>({recordset:[]}),externalEvidence:{'EUR::2026-10-01':{available:true,rate:1500}}},()=>getKcsTaxableRate({currency:'EUR',declarationDate:'2026-10-01'}));assert.equal(result.rate,1500);
 }finally{globalThis.fetch=original;}
});
test('before and after use real formulas with a fresh source scope and preserve explicit zero',async()=>{
 const facts={policyHash:approvalProfitPolicyHash(),periods:[{orderYear:'2026',major:'41',confirm:{ConfirmKey:1,RevisionNo:1}}]};
 const compute=amount=>computeIncomingApprovalProfit({q:async()=>({recordset:[{amount}]}),facts,loadReportDataFn:async()=>({rows:[{category:'시험',manual:{},auto:{N:(await query('SELECT Amount')).recordset[0].amount,L:0,O:0,Q:10,R:1,H:0,S:0,E:0,F:0},stock:null}],stockWeeks:{},audit:{errorCount:0,status:'ready',issues:[]}})});
 const before=await compute(100),after=await compute(0);
 assert.equal(before.periods[0].payload.totals.C,100);assert.equal(after.periods[0].payload.totals.C,0);assert.notEqual(before.periods[0].semanticHash,after.periods[0].semanticHash);
});
