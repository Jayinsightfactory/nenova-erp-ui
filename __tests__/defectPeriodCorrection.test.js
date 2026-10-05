import assert from 'node:assert/strict';
import { validatePeriodCorrection, assertCorrectableDraft } from '../lib/defectPeriodCorrection.js';
const input={year:2026,week:42,targetYear:2026,targetWeek:40,reason:'차수 오입력',user:{authority:1},rows:[{deductionKey:721,expectedRowVersionNo:1}]};
validatePeriodCorrection(input);
validatePeriodCorrection({...input,targetYear:2027});
assert.throws(()=>validatePeriodCorrection({...input,user:{authority:6}}));
for(const patch of [{targetWeek:0},{targetYear:1999},{targetYear:2026,targetWeek:42},{rows:[]},{reason:''},{rows:[...input.rows,...input.rows]}]) assert.throws(()=>validatePeriodCorrection({...input,...patch}));
const row={orderYear:2026,orderWeek:'42',rowVersionNo:1,status:'DRAFT'};
assertCorrectableDraft(row,input.rows[0],2026,42);
for(const patch of [{orderYear:2025},{orderWeek:'40'},{rowVersionNo:2},{status:'REGISTERED'},{estimateKey:1},{importConfirmed:true},{isDeleted:true},{isCarryoverLedger:true},{appliedOrderYear:2026}]) assert.throws(()=>assertCorrectableDraft({...row,...patch},input.rows[0],2026,42));
console.log('defect period correction policy tests passed');
import { correctDraftPeriod } from '../lib/salesDefectDeductions.js';
async function runFixture({ secondBad=false, closed=false, historyFails=false }={}) {
 const data=new Map([721,722].map(k=>[k,{...row,deductionKey:k,custKey:503,prodKey:467,quantity:15,managerName:'담당자'}]));
 let history=[]; let committed=false;
 const transaction=async fn=>{ const original=structuredClone(data); try {const out=await fn(async (sql,params={})=>{
   if(sql.startsWith('SELECT DeductionKey')) return {recordset:closed?[{DeductionKey:100}]:[]};
   if(sql.startsWith('SELECT ApplicationKey')) return {recordset:[]};
   if(sql.startsWith('UPDATE')) {const r=data.get(params.key.value);r.orderYear=params.targetYear.value;r.orderWeek=params.targetWeek.value;r.rowVersionNo++;return {rowsAffected:[1]};}
   if(sql.startsWith('INSERT INTO WebSalesDefectDeductionHistory')) {if(historyFails) throw Error('history failed');history.push(params); return {rowsAffected:[1]};}
   throw Error('unexpected SQL');
 });committed=true;return out;} catch(e){ data.clear();for(const [k,v] of original)data.set(k,v);history=[];throw e;}};
 const readSnapshot=async(q,k)=>({...data.get(k),...(secondBad&&k===722?{rowVersionNo:7}:{})});
 let error;try{await correctDraftPeriod({...input,rows:[...input.rows,{deductionKey:722,expectedRowVersionNo:1}]},{transaction,ensure:async()=>{},readSnapshot});}catch(e){error=e;}
 return {data,history,committed,error};
}
const ok=await runFixture();assert.equal(ok.committed,true);assert.equal(ok.history.length,2);assert.equal(ok.data.get(721).orderWeek,'40');assert.equal(ok.data.get(721).quantity,15);
for(const flags of [{secondBad:true},{closed:true},{historyFails:true}]) {const f=await runFixture(flags);assert.ok(f.error);assert.equal(f.committed,false);assert.equal(f.data.get(721).orderWeek,'42');assert.equal(f.history.length,0);}
console.log('transaction rollback and preservation fixtures passed');
