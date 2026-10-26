import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {startWeekdayAutoRefresh,weekdayAutoRefreshFailures} from '../lib/weekdayAutoRefresh.js';
test('30 second schedule, tab return, busy skipping, no overlap and disposal',async()=>{
  let tick,visible=true,allowed=true,finish,calls=0,cleared=false;
  const scheduler=startWeekdayAutoRefresh({run:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},
    canRun:()=>allowed,isVisible:()=>visible,setIntervalFn:(fn,ms)=>{assert.equal(ms,30000);tick=fn;return 7;},clearIntervalFn:id=>{assert.equal(id,7);cleared=true;}});
  visible=false;await scheduler.trigger();assert.equal(calls,0);
  visible=true;allowed=false;await scheduler.trigger();assert.equal(calls,0);
  allowed=true;tick();assert.equal(calls,1);await scheduler.trigger();assert.equal(calls,1);
  finish();await Promise.resolve();const next=scheduler.trigger();assert.equal(calls,2);finish();await next;
  scheduler.dispose();assert.equal(cleared,true);await scheduler.trigger();assert.equal(calls,2);
});

function workspaceHarness({failWilson=false,failPrint=false,gate=null,quantityFocused=false,baselineCode=null}={}) {
  const source=readFileSync(new URL('../components/WeekdayEstimateWorkspace.js',import.meta.url),'utf8');
  const start=source.indexOf('  async function refreshErp('),end=source.indexOf('\n  function shiftCenter',start);
  const body=source.slice(start,end),writes={},ref=current=>({current});
  const plans=[{year:2026,orderWeek:'42-01',prodKey:389,date:'2026-10-16',quantity:3}],wilsonDrafts=[{quantity:1,expectedTotal:13}];
  const env={document:{activeElement:{matches:()=>quantityFocused}},customer:{CustKey:533},scopeKey:'533|2026|42',year:2026,majorWeek:'42',cycles:[{offset:0,year:2026,majorWeek:'42',calendarState:'FOUND',days:[{orderWeek:'42-01'}]}],
    autoRefreshBlocked:ref(false),backgroundRequest:ref(null),applyLock:ref(false),pendingOperation:ref(null),wilsonLock:ref(false),baselineLock:ref(false),noteLock:ref(false),carryoverLock:ref(false),deleteLock:ref(false),
    comparisonRequest:ref(0),currentScope:ref('533|2026|42'),freshEarly:ref({old:true}),freshCompareRows:ref([{old:true}]),activePlans:plans,
    addedProductScope:ref({scope:'',keys:[]}),wilsonPendingRef:ref([]),weekdayAutoRefreshFailures,
    resolveEarlyShipmentRecords:records=>({records}),validateWeekdayDistributionCompareResponse(){},validateWeekdayConfirmationResponse:(scope,result)=>result,
    validateWeekdaySavedHistoryScope(){},isExpectedWeekdayPrintBlock:()=>false,refreshCarryover:async()=>({}),
    apiGet:async path=>{
      if(path.endsWith('weekday-products'))return {products:[{ProdKey:389}],scope:{orderWeeks:['42-01']}};
      if(path.endsWith('weekday-baseline'))return {baselines:baselineCode?[]:[{year:2026,orderWeek:'42-01',custKey:533,rows:[]}]};
      if(path.endsWith('weekday-early-shipment'))return {success:true,readOnly:true,records:[],nextCycle:{year:2026,majorWeek:'43'}};
      if(path.endsWith('weekday-wilson')){if(failWilson)throw Error('Wilson failed');return {success:true,records:[{revision:4}]};}
      if(path.endsWith('weekday-confirmation'))return {state:'FIXED'};
      if(path.endsWith('weekday-changes'))return {changes:[]};
      if(path.endsWith('weekday-note'))return {notes:[]};
      if(path.endsWith('weekday-carryover'))return {success:true,readOnly:true,records:[],context:{custKey:533,cycles:[],inputs:[]}};
      return {items:[]};
    },fetch:async path=>{
      if(path.endsWith('weekday-baseline'))return {ok:false,json:async()=>({success:false,code:baselineCode,error:'baseline unavailable'})};
      if(path.endsWith('weekday-print')){if(gate)await gate;if(failPrint)throw Error('Print failed');return {ok:true,json:async()=>({success:true,items:[]})};}
      return {ok:true,json:async()=>({success:true,rows:[{quantity:13}],sourceLots:[],history:[]})};
    }};
  for(const name of [...body.matchAll(/\b(set[A-Z]\w*)\(/g)].map(match=>match[1]))env[name]=value=>{writes[name]=typeof value==='function'?value(writes[name] ?? {}):value;};
  const run=new Function(...Object.keys(env),`${body};return refreshErp;`)(...Object.values(env));
  return {run,writes,env,plans,wilsonDrafts};
}
test('actual Workspace background refresh publishes complete read set and preserves drafts without locking',async()=>{
  const h=workspaceHarness({failPrint:true}),before=JSON.stringify([h.plans,h.wilsonDrafts]);
  assert.equal(await h.run([],{background:true}),true);
  assert.deepEqual(h.writes.setCompareRows,[{quantity:13}]);
  assert.equal(h.writes.setBusy,undefined);assert.equal(h.writes.setPlans,undefined);assert.equal(h.writes.setWilsonDrafts,undefined);
  assert.equal(JSON.stringify([h.plans,h.wilsonDrafts]),before);
  assert.match(h.writes.setQuoteResults[0].error,/Print failed/);
});
test('actual Workspace critical failure retains old snapshot; superseded request cannot overwrite',async()=>{
  const failed=workspaceHarness({failWilson:true});
  assert.equal((await failed.run([],{background:true})).success,false);
  assert.equal(failed.writes.setCompareRows,undefined);assert.deepEqual(failed.env.freshCompareRows.current,[{old:true}]);
  assert.match(failed.writes.setAutoRefresh.error,/Wilson failed/);
  let release;const h=workspaceHarness({gate:new Promise(resolve=>{release=resolve;})});
  const pending=h.run([],{background:true});h.env.comparisonRequest.current+=1;release();
  assert.equal(await pending,false);assert.equal(h.writes.setCompareRows,undefined);
});
test('an uncommitted focused quantity and active write lock defer background refresh',async()=>{
  const focused=workspaceHarness({quantityFocused:true});
  assert.equal(await focused.run([],{background:true}),false);assert.deepEqual(focused.writes,{});
  const locked=workspaceHarness();locked.env.applyLock.current=true;
  assert.equal(await locked.run([],{background:true}),false);assert.deepEqual(locked.writes,{});
});
test('failed ancillary refresh cannot publish partial safety snapshot; expected print block is accepted',()=>{
  const carry={context:{},records:[]};
  assert.deepEqual(weekdayAutoRefreshFailures([{candidates:[]}],[{quote:{printReadiness:{state:'UNFIXED'}}}],carry),[]);
  assert.deepEqual(weekdayAutoRefreshFailures([],[{changeError:'history unavailable',quote:{error:'print unavailable'}}],carry),[],'independent print/history failures do not block valid quantity refresh');
  for(const key of ['confirmationFailure','wilsonFailure','earlyFailure'])
    assert.deepEqual(weekdayAutoRefreshFailures([],[{[key]:'network failure'}],carry),['network failure']);
  assert.deepEqual(weekdayAutoRefreshFailures([{candidates:[{error:'baseline failure'}]}],[{quote:{error:'print failure'}}],null),
    ['baseline failure','이월 조회 응답을 확인할 수 없습니다.']);
});


test('legacy baseline rejection does not suppress latest quantities or erase drafts',async()=>{
  const h=workspaceHarness({baselineCode:'INVALID_ERP_DATES'}),before=JSON.stringify([h.plans,h.wilsonDrafts]);
  assert.equal(await h.run([],{background:true}),true);
  assert.deepEqual(h.writes.setCompareRows,[{quantity:13}]);
  assert.equal(h.writes.setBaselineCandidates[0].errorCode,'INVALID_ERP_DATES');
  assert.deepEqual(h.writes.setBaselineCandidates[0].rows,[]);
  assert.equal(h.writes.setAutoRefresh.error,'');assert.ok(h.writes.setAutoRefresh.lastSuccess);
  assert.equal(JSON.stringify([h.plans,h.wilsonDrafts]),before);
  const failed=workspaceHarness({baselineCode:'BASELINE_READ_FAILED'});
  assert.equal((await failed.run([],{background:true})).success,false);
  assert.equal(failed.writes.setCompareRows,undefined);
});
