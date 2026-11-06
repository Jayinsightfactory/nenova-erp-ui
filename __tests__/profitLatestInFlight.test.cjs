const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../lib/profitLatestInFlight.mjs'),import('../lib/erpReadContext.js')]);
const registry=()=>globalThis[Symbol.for('nenova.profit.coherent-live.inflight.v1')];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('same in-flight scope across module copies shares one fenced read, clones each caller and evicts immediately',async()=>{
 const [{shareLatestProfitRead:read}]=await modules;
 const {shareLatestProfitRead:other}=await import('../lib/profitLatestInFlight.mjs?other-bundle');let calls=0;const gate=deferred(),raw={rows:[{calc:{C:0,J:0}}]};
 const load=async()=>{calls++;await gate.promise;return raw;};
 const first=read('2026','44',load),second=other('2026','44',load);await Promise.resolve();assert.equal(calls,1);assert.equal(registry().size,1);
 gate.resolve();const [a,b]=await Promise.all([first,second]);assert.equal(registry().size,0);assert.notEqual(a,raw);assert.notEqual(a,b);a.rows[0].calc.C=99;assert.equal(b.rows[0].calc.C,0);assert.equal(raw.rows[0].calc.C,0);
 await read('2026','44',load);assert.equal(calls,2,'settled value never reused');
});
test('year/week separation, invalid0/false bypass, rejection eviction and retry do not alias',async()=>{
 const [{shareLatestProfitRead:read}]=await modules;let calls=0;const gate=deferred(),load=async()=>{calls++;await gate.promise;return {value:0};};
 const pending=[read('2025','44',load),read('2026','44',load),read('2026','43',load),read('2026',0,load),read('2026',false,load)];await Promise.resolve();assert.equal(calls,5);assert.equal(registry().size,3);gate.resolve();await Promise.all(pending);assert.equal(registry().size,0);
 const error=Error('fixture'),failure=deferred();let failures=0;const fail=()=>{failures++;return failure.promise;};
 const a=read('2026','44',fail),b=read('2026','44',fail);failure.reject(error);
 await assert.rejects(a,e=>e===error);await assert.rejects(b,e=>e===error);assert.equal(failures,1);assert.equal(registry().size,0);
 assert.deepEqual(await read('2026','44',async()=>({fixed:true})),{fixed:true});
});
test('transaction/replay contexts bypass join and registration',async()=>{
 const [{shareLatestProfitRead:read},{withErpReadContext:scope}]=await modules;
 let standalone=0,scoped=0;const gate=deferred();
 const owner=read('2026','44',async()=>{standalone++;await gate.promise;return {value:7};});
 const waiter=read('2026','44',async()=>assert.fail('must join'));
 await scope({queryFn:async()=>({})},async()=>{
  const value=await read('2026','44',async()=>{scoped++;return {value:0};});assert.equal(value.value,0);assert.equal(registry().size,1);
 });
 gate.resolve();assert.deepEqual(await owner,{value:7});assert.deepEqual(await waiter,{value:7});assert.equal(standalone,1);assert.equal(scoped,1);assert.equal(registry().size,0);
});
test('production callers retain independent policy and fences before the live-only shared reader',()=>{
 const fs=require('node:fs'),source=fs.readFileSync(require('node:path').join(__dirname,'../pages/api/sales/profit-report.js'),'utf8');
 assert.match(source,/if\(currentErpReadContext\(\)\)return work\(\);\s*return shareLatestProfitRead\(orderYear,major/);
 const loader=source.slice(source.indexOf('export async function loadWeeklyReportPayload'));
 assert.ok(loader.indexOf('getActiveConfirm')<loader.indexOf('loadCoherentLatestReport'));
 assert.match(source,/before!==await signature\(\)/);
 for(const name of ['profit-report-week-check.js','profit-stock-adjustment-notes.js','profit-report-output.js']){
  const route=fs.readFileSync(require('node:path').join(__dirname,'../pages/api/sales',name),'utf8');assert.match(route,/loadWeeklyReportPayload/);
 }
});
