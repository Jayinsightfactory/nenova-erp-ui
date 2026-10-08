const assert=require('node:assert/strict');
const {analysisKey,usableAnalysis,usablePreparedAnalysis,createPreanalysisCache,analysisGroups,TTL_MS}=require('../lib/pasteInboxPreanalysis');
const data={success:true,orders:[{custName:'친구',custMatch:{CustKey:1,CustName:'친구플라워'},items:[{inputName:'돈셀',prodKey:2,prodName:'CARNATION Doncel',qty:1,unit:'박스',action:'취소'}]},{custName:'울산신화',custMatch:{CustKey:3,CustName:'울산신화'},items:[{inputName:'문라이트',prodKey:4,prodName:'CARNATION Moon Light',qty:1,unit:'박스',action:'추가'}]}]};
async function main(){
  let calls=0,time=100,active=0,maxActive=0;
  const cache=createPreanalysisCache({now:()=>time,fetcher:async()=>{calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return structuredClone(data);}});
  const [a,b]=await Promise.all([cache.read('원문','2026-39-02'),cache.read('원문','2026-39-02')]);
  assert.equal(calls,1,'same pending request shared');
  assert(usableAnalysis(a,'원문','2026-39-02',time));
  assert(!usableAnalysis(a,'원문','2025-39-02',time),'cross-year never reused');
  assert(!usableAnalysis(a,'원문 수정','2026-39-02',time));
  assert(!usableAnalysis(a,'원문','2026-39-02',time+TTL_MS));
  assert(usablePreparedAnalysis(a,'원문','2026-39-02',time),'fresh transient analysis can open');
  assert(!usablePreparedAnalysis(a,'원문','2026-39-02',time+TTL_MS),'transient analysis still expires');
  const persisted={...b,data:{...b.data,analysisStorage:{savedAt:time,cacheHit:true}}};
  const afterReentry=time+TTL_MS*100;
  assert(usablePreparedAnalysis(persisted,'원문','2026-39-02',afterReentry),'saved analysis remains visible and openable after memory TTL');
  assert(usablePreparedAnalysis({...persisted,data:{...persisted.data,analysisStorage:{savedAt:time,cacheHit:false}}},'원문','2026-39-02',afterReentry),'the first successfully saved analysis is also durable');
  assert(!usableAnalysis(persisted,'원문','2026-39-02',afterReentry),'memory cache still refreshes the saved disk result');
  assert(!usablePreparedAnalysis(persisted,'원문','2025-39-02',afterReentry),'saved result never crosses years');
  assert(!usablePreparedAnalysis(persisted,'원문','2026-39-01',afterReentry),'saved result never crosses subweeks');
  assert(!usablePreparedAnalysis(persisted,'수정 원문','2026-39-02',afterReentry),'saved result never crosses exact source text');
  for(const savedAt of [NaN,Infinity,-1,afterReentry+1,String(time),undefined]) {
    assert(!usablePreparedAnalysis({...persisted,data:{...persisted.data,analysisStorage:{savedAt}}},'원문','2026-39-02',afterReentry),'invalid/future saved time cannot extend validity');
  }
  assert(!usablePreparedAnalysis({...persisted,at:afterReentry+1},'원문','2026-39-02',afterReentry),'future receipt is rejected after a clock rollback');
  assert(!usablePreparedAnalysis({...persisted,data:{...persisted.data,analysisStorage:{savedAt:time+1}}},'원문','2026-39-02',time),'future saved metadata cannot fall back to fresh transient validity');
  assert(!usablePreparedAnalysis({...persisted,data:{...persisted.data,success:false}},'원문','2026-39-02',afterReentry),'failed response cannot become a durable analysis');
  assert(!usablePreparedAnalysis({...persisted,data:{...persisted.data,orders:null}},'원문','2026-39-02',afterReentry),'missing analysis rows are rejected');
  a.data.orders[0].items[0].qty=999;
  assert.equal(b.data.orders[0].items[0].qty,1,'simultaneous consumers receive independent drafts');
  const fresh=await cache.read('원문','2026-39-02');
  assert.equal(fresh.data.orders[0].items[0].qty,1,'editing draft cannot mutate cache');
  await Promise.all([cache.read('두번째','2026-39-02'),cache.read('세번째','2025-39-02')]);
  assert.equal(maxActive,1,'bounded sequential LLM calls');
  time+=TTL_MS;await cache.read('원문','2026-39-02');assert.equal(calls,4);
  await cache.read('원문','2026-39-02',{force:true});assert.equal(calls,5);
  await assert.rejects(cache.read('숨김','2026-39-02',{eligible:()=>false}),/화면 대기/);assert.equal(calls,5);
  const bounded=createPreanalysisCache({autoLimit:1,fetcher:async()=>data});
  await bounded.read('1','2026-39-02',{automatic:true});
  await assert.rejects(bounded.read('2','2026-39-02',{automatic:true}),/자동 분석/);
  await bounded.read('2','2026-39-02');
  let failedCalls=0;
  const failedBudget=createPreanalysisCache({autoLimit:1,fetcher:async()=>{failedCalls++;throw new Error('model unavailable');}});
  await assert.rejects(failedBudget.read('fail1','2026-39-02',{automatic:true}),/model unavailable/);
  await assert.rejects(failedBudget.read('fail2','2026-39-02',{automatic:true}),/자동 분석/);
  assert.equal(failedCalls,1,'failed automatic attempts must still consume the safety budget');
  let failures=0;const retry=createPreanalysisCache({fetcher:async()=>{if(!failures++)throw new Error('offline');return data;}});
  await assert.rejects(retry.read('x','2026-39-02'),/offline/);await retry.read('x','2026-39-02');
  assert.throws(()=>analysisKey('x','39-02'));
  const groups=analysisGroups(b.data);
  assert.deepEqual(groups.map(g=>g.customer),['친구플라워','울산신화']);
  assert.equal(groups[0].items[0].product,'CARNATION Doncel');assert.equal(groups[1].items[0].action,'+');
  assert.equal(groups[0].items[0].action,'−');assert(groups[1].items[0].matched);
  assert(!('applied' in groups[0].items[0]),'analysis is never committed ERP evidence');
  const mixed=structuredClone(data);Object.assign(mixed.orders[0].items[0],{qty:197,unit:'송이',quantitySource:'6박스 + 17스팀'});
  assert.equal(analysisGroups(mixed)[0].items[0].quantity,'6박스 + 17스팀');
  mixed.orders[0].items[0].mixedQuantityError='포장수 없음';assert(!analysisGroups(mixed)[0].items[0].matched);
  mixed.orders[0].custMatch=null;assert(!analysisGroups(mixed)[0].customerMatched);
  assert.deepEqual(analysisGroups({}),[]);

  // Persistent lookup is a read-only path: it ignores visibility and model
  // budget, and a miss never falls through to analysis.
  const lookupCalls=[];
  const stored = text => ({success:true,orders:[{items:[{qty:text.length}]}],analysisStorage:{savedAt:time,cacheHit:true}});
  const lookupCache=createPreanalysisCache({persistent:true,autoLimit:0,now:()=>time,fetcher:async(text,week,options)=>{
    lookupCalls.push({text,week,options});
    if(options.lookupOnly && text==='missing') return {analysisStorage:{cacheMiss:true}};
    if(options.lookupOnly) return stored(text);
    throw new Error('analysis must not run during lookup');
  }});
  let lookupStatus=[];
  const hit=await lookupCache.read('saved','2026-39-02',{lookupOnly:true,eligible:()=>false,automatic:true,onStatus:s=>lookupStatus.push(s)});
  assert.equal(hit.data.orders[0].items[0].qty,5,'saved lookup works when the view is ineligible and auto budget is zero');
  assert.deepEqual(lookupStatus,['restoring']);
  hit.data.orders[0].items[0].qty=900;
  const independent=await lookupCache.read('saved','2026-39-02',{lookupOnly:true});
  assert.equal(independent.data.orders[0].items[0].qty,5,'each lookup returns an independent draft');
  await lookupCache.read('saved','2025-39-02',{lookupOnly:true});
  await lookupCache.read('saved edited','2026-39-02',{lookupOnly:true});
  assert.equal(lookupCalls.length,3,'year and exact source text each have separate cache entries');
  const miss=await lookupCache.read('missing','2026-39-02',{lookupOnly:true,eligible:()=>false,automatic:true});
  assert.equal(miss,null);
  assert.equal(lookupCalls.length,4);
  assert(lookupCalls.every(call=>call.options.lookupOnly),'lookup misses never invoke the analysis fetch path');

  const statusEvents=[];
  let releaseAnalysis, analysisStarted;
  const analysisGate=new Promise(resolve=>{releaseAnalysis=resolve;});
  const analysisBegun=new Promise(resolve=>{analysisStarted=resolve;});
  let duplicateFetches=0;
  const statusCache=createPreanalysisCache({fetcher:async()=>{
    duplicateFetches++; analysisStarted(); await analysisGate; return data;
  }});
  const first=statusCache.read('status','2026-39-02',{onStatus:s=>statusEvents.push(`first:${s}`)});
  await analysisBegun;
  const second=statusCache.read('status','2026-39-02',{onStatus:s=>statusEvents.push(`second:${s}`)});
  releaseAnalysis();
  await Promise.all([first,second]);
  assert.equal(duplicateFetches,1,'duplicate pending reads share one analysis fetch');
  assert(statusEvents.includes('first:queued') && statusEvents.includes('first:analyzing'));
  assert(statusEvents.includes('second:analyzing'),'pending subscriber receives the current analyzing status');
  console.log('paste inbox preanalysis: scope, cache, queue, failures, mixed quantities, advisory display passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
