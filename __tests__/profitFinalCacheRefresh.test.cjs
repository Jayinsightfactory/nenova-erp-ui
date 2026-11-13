const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../scripts/refresh-profit-final-cache.mjs');
test('dry-run cannot connect; scope excludes other years/weeks and unknown flags',async()=>{
 const m=await api,o=m.parseRefreshArgs(['--from=36','--to=46']);assert.equal((await m.refreshFinalCaches(o,{fetchFn:()=>{throw Error('network forbidden')}})).requests,0);
 for(const args of [['--from=35','--to=46'],['--from=36','--to=47'],['--from=46','--to=36'],['--from=36','--to=46','--year=2025'],['--from=36','--to=46','--apply']])assert.throws(()=>m.parseRefreshArgs(args));
 let connected=false;await assert.rejects(m.refreshFinalCaches({...o,apply:true,from:35},{token:'TEST_ONLY',fetchFn:()=>{connected=true}}));assert.equal(connected,false);
});
test('same production POST only, explicit year, sequential saves and metadata without body/token',async()=>{
 const m=await api,seen=[];const o=m.parseRefreshArgs(['--from=36','--to=37','--apply','--report=private.json']);
 const r=await m.refreshFinalCaches(o,{token:'TEST_ONLY',fetchFn:async(url,opts)=>{assert.equal(url,'https://nenovaweb.com/api/sales/profit-report');assert.equal(opts.method,'POST');assert.equal(opts.headers.Authorization,'Bearer TEST_ONLY');const b=JSON.parse(opts.body);assert.deepEqual(Object.keys(b).sort(),['action','week','year']);assert.equal(b.year,'2026');assert.equal(b.action,'snapshotRefresh');seen.push(b.week);return{ok:true,json:async()=>({success:true,orderYear:'2026',major:b.week,cacheFinalizationVersion:1,financialReadPolicy:{frozen:true},snapshot:{servedFrom:'snapshot',versionNo:2,snapKey:100}})};}});
 assert.equal(r.failed,false);assert.deepEqual(seen,['36','37']);assert(!JSON.stringify(r).includes('TEST_ONLY'));assert(!JSON.stringify(r).includes('rows'));
});
test('HTML/error/network/unconfirmed response stops without automatic retry',async()=>{
 const m=await api,o=m.parseRefreshArgs(['--from=36','--to=46','--apply','--report=private.json']);
 for(const fetchFn of [async()=>({ok:false,status:502}),async()=>{throw Error('private credential details')},async()=>({ok:true,json:async()=>{throw Error('HTML')}}),async()=>({ok:true,json:async()=>({success:true,orderYear:'2025',major:'36'})})]){
  let count=0;const r=await m.refreshFinalCaches(o,{token:'TEST_ONLY',fetchFn:async(...args)=>{count++;return fetchFn(...args)}});assert.equal(count,1);assert.equal(r.failed,true);assert.equal(r.results[0].status,'outcome_unknown');assert(!JSON.stringify(r).includes('private credential'));
 }
 let called=false;await assert.rejects(m.refreshFinalCaches(o,{fetchFn:()=>{called=true}}));assert.equal(called,false);
});
