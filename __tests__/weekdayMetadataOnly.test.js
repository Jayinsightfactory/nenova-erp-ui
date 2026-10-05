import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wilsonRecordKey, wilsonPendingAfterSave } from '../lib/weekdayWilsonClient.js';

const source=readFileSync(new URL('../components/WeekdayEstimateWorkspace.js',import.meta.url),'utf8');
function actualFunction(name,next,environment) {
  const start=source.indexOf(`  async function ${name}(`),end=source.indexOf(`  async function ${next}(`,start);
  assert.ok(start>=0&&end>start);
  return new Function('environment',`with(environment){return (${source.slice(start,end).trim()});}`)(environment);
}
const first={year:2026,majorWeek:'40',orderWeek:'40-01',custKey:533,prodKey:77,date:'2026-10-04',unit:'단',
  wilsonQuantity:20,expectedTotal:100,expectedRevision:0,scopeKey:'533|2026|40'};
const second={...first,prodKey:78};
let remaining=[],error='',posts=0,durable;
const retryEnvironment={wilsonPending:[first,second],wilsonLock:{current:false},applyLock:{current:false},
  setWilsonBusy(){},assertCurrentInputOwner:async()=>{},writeWilson:async record=>{posts++;if(record.prodKey===78)throw Error('fixture metadata POST failure');},
  setWilsonError(value){error=value;},setWilsonPending(value){remaining=value;},wilsonPendingRef:{current:[]},
  sessionStorage:{setItem(key,value){durable=JSON.parse(value);}},wilsonRecoveryKey:'fixture-owner'};
const retry=actualFunction('retryWilson','openWeekdayPrint',retryEnvironment);
assert.equal(await retry(),false,'partial metadata POST failure cannot report successful completion');
assert.equal(posts,2);assert.deepEqual(remaining,[second]);assert.deepEqual(durable,[second]);assert.match(error,/fixture metadata POST failure/);
posts=0;
retryEnvironment.assertCurrentInputOwner=async()=>{throw Error('different user');};
assert.equal(await retry(),false);assert.equal(posts,0,'switched account cannot issue any metadata POST');
assert.deepEqual(durable,[second],'owner failure preserves existing recovery bytes');

const submission={metadataOnly:true,inputUser:'owner',scopeKey:first.scopeKey,payload:{custKey:533,changes:[]},
  wilson:[first],metadataChanges:[{year:first.year,orderWeek:first.orderWeek,prodKey:first.prodKey,unit:first.unit,
    dates:[{date:first.date,quantity:100}],wilsonRecord:first}]};
let planClears=0,splitClears=0,pending,errorMessage;
const finishEnvironment={assertCurrentInputOwner:async owner=>assert.equal(owner,'owner'),wilsonPendingAfterSave,wilsonRecordKey,
  wilsonPendingRef:{current:[]},sessionStorage:{setItem(){},removeItem(){}},wilsonRecoveryKey:'fixture',
  setWilsonPending(){},applyLock:{current:true},retryWilson:async()=>false,
  setPendingApply(value){pending=value;},setApplyError(value){errorMessage=value;},
  setPlans(){planClears++;},setWilsonDrafts(){splitClears++;}};
const finish=actualFunction('finishMetadataOnlySave','confirmErpSave',finishEnvironment);
await finish(submission);
assert.equal(planClears,0);assert.equal(splitClears,0,'failed classification retains unchanged-total plans and split drafts');
assert.equal(pending,submission);assert.match(errorMessage,/입력 초안을 유지/);
assert.equal(finishEnvironment.applyLock.current,true);

let ownerGets=0;
const ownerEnvironment={inputUser:'owner',apiGet:async()=>{ownerGets++;return {success:true,user:{userId:'other'}};}};
const checkOwner=actualFunction('assertCurrentInputOwner','writeWilson',ownerEnvironment);
await assert.rejects(()=>checkOwner(),/로그인 사용자가 변경/);
await assert.rejects(()=>checkOwner('foreign-submission'),/입력의 사용자/);
assert.equal(ownerGets,1,'foreign recovery owner is rejected before auth lookup and before any write');
assert.ok(source.includes('if(submission.metadataOnly) await finishMetadataOnlySave(submission);'));
console.log('Metadata-only actual handlers: partial failure retention, durable retry, zero ERP replay and current owner guards passed');
