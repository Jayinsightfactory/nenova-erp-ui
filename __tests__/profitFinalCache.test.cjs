const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const raw=()=>({orderYear:'2026',major:'36',rows:[{category:'태국',variant:'normal',auto:{N:1000,L:0,O:0,Q:2,S:0,E:0,F:0,H:0,R:100},manual:{},stock:{evidenceValue:0}}]});
async function fixtures(){return {F:await import('../lib/profitReportFinalCache.mjs'),C:await import('../lib/profitReportStoredCalculation.js'),P:await import('../lib/profitReportCalc.js')};}
async function finalFixture(){const{F,P}=await fixtures();return F.finalizeProfitCachePayload(raw(),{orderYear:'2026',major:'36',finalize:async p=>{
 const r=p.rows[0];r.calc={...r.calc,E:10,F:30,G:210,H:20,I:210,J:790,K:.79};p.totals=P.computeProfitTotals(p.rows);return p;
}});}
test('final duty/average cells and original raw donor are both retained',async()=>{
 const{F,C}=await fixtures(),p=await finalFixture();assert.equal(p.rows[0].calc.J,790);assert.equal(p.rows[0].calc.H,20);
 assert.equal(F.profitCacheSourcePayload(p).rows[0].calc.H,0);assert.equal(p.financialReadPolicy.frozen,true);
 assert.equal(C.profitDisplayCalculation(p).rows[0].calc.J,790);assert.equal(C.isMaterializedProfitPayload(p),true);
});
test('legacy raw donors remain unchanged; final donors unwrap before tariff computation',async()=>{
 const{F}=await fixtures(),p=await finalFixture(),legacy=raw();assert.equal(F.profitCacheSourcePayload(legacy),legacy);
 assert.equal(F.profitCacheSourcePayload(p).rows[0].calc.G,200);assert.equal(p.rows[0].calc.G,210);
 const adapter=fs.readFileSync(path.join(root,'lib/profitTemplateDutyData.js'),'utf8');assert.match(adapter,/payload:profitCacheSourcePayload\(value.payload\)/);
});
test('cross-year, cross-week, missing and nested donor evidence fail closed',async()=>{
 const{F}=await fixtures(),p=await finalFixture();for(const source of [null,{...p.cacheSourcePayload,orderYear:'2025'},{...p.cacheSourcePayload,major:'37'},{...p.cacheSourcePayload,cacheFinalizationVersion:1}])
 assert.throws(()=>F.profitCacheSourcePayload({...p,cacheSourcePayload:source}),e=>e.code==='PROFIT_FINAL_CACHE_INVALID');
 assert.throws(()=>F.profitCacheSourcePayload({...p,cacheFinalizationVersion:2}),e=>e.code==='PROFIT_FINAL_CACHE_INVALID');
});
test('finalization rejects mismatched scope and never retries a failed source',async()=>{
 const{F}=await fixtures();let count=0;
 for(const source of [{...raw(),orderYear:'2025'},{...raw(),major:'37'}])await assert.rejects(F.finalizeProfitCachePayload(source,{orderYear:'2026',major:'36',finalize:()=>count++}));
 assert.equal(count,0);
 await assert.rejects(F.finalizeProfitCachePayload(raw(),{orderYear:'2026',major:'36',finalize:async()=>{count++;throw Error('source unavailable')}}),/source unavailable/);assert.equal(count,1);
 await assert.rejects(F.finalizeProfitCachePayload(await finalFixture(),{orderYear:'2026',major:'36',finalize:()=>{count++}}));assert.equal(count,1);
});
test('unavailable fallback/invalid final shape is not persisted as a successful refresh',async()=>{
 const{F}=await fixtures();for(const mutate of [p=>({...p,averageFallback:{available:false}}),p=>({...p,orderYear:'2025'}),p=>({...p,rows:[]})])
 await assert.rejects(F.finalizeProfitCachePayload(raw(),{orderYear:'2026',major:'36',finalize:async p=>mutate(p)}),e=>e.code==='PROFIT_FINAL_CACHE_INVALID');
});
test('explicit manual zero and a non-2026 same week retain their own basis',async()=>{
 const{F}=await fixtures();const source=raw();source.rows[0].manual.H=0;source.orderYear='2025';
 const p=await F.finalizeProfitCachePayload(source,{orderYear:'2025',major:'36',finalize:async p=>p});assert.equal(p.rows[0].calc.H,0);assert.equal(p.orderYear,'2025');
 assert.equal(F.profitCacheSourcePayload(p).rows[0].manual.H,0);
});
test('production snapshot transaction preserves completed cells, original version and year scope',async()=>{
 const{C}=await fixtures(),payload=await finalFixture(),sql={NVarChar:()=>{},MAX:-1,Bit:'bit',Int:'int'};
 let inserted,computed=0;const original=JSON.stringify(payload.cacheSourcePayload);
 const query=async(text,params)=>{
  if(text.includes('OBJECT_ID'))return{recordset:[{id:1}]};
  assert.equal(params.y.value,'2026');assert.equal(params.m.value,'36');
  if(text.includes('sp_getapplock'))return{recordset:[{LockResult:0}]};
  if(text.includes('WebProfitReportConfirm'))return{recordset:[]};
  if(text.includes('SELECT TOP 1 *'))return{recordset:[]};
  if(text.includes('INSERT INTO dbo.WebProfitReportSnapshot')){inserted=params;return{recordset:[{SnapKey:99,VersionNo:2,CreatedAt:'2026-11-13'}]};}
  throw Error('Unexpected SQL');
 };
 const source=fs.readFileSync(path.join(root,'lib/profitReportSnapshot.js'),'utf8').replace(/^import .*;\r?$/gm,'').replaceAll('export ','').replace('async function computeWeekFingerprint(','async function unusedFingerprint(');
 const deps={crypto,query,sql,withTransaction:fn=>fn(query),currentErpReadContext:()=>null,erpContextCache:(_key,value)=>value,loadProfitCategoryOverrides:()=>({}),calcHashModule:{computeProfitReportCalcHash:()=> 'test'},isMaterializedProfitPayload:C.isMaterializedProfitPayload,materializeProfitPayload:C.materializeProfitPayload,computeWeekFingerprint:async()=>({hash:'stable',components:{}})};
 const S=new Function(...Object.keys(deps),source+';return{saveProfitCache,storedProfitPayload};')(...Object.values(deps));
 const saved=await S.saveProfitCache({orderYear:'2026',major:'36',reason:'REFRESH',actor:'test'},async()=>{computed++;return payload;});
 assert.equal(computed,1);assert.equal(saved.action,'saved');assert.equal(saved.payload.rows[0].calc.J,790);assert.equal(JSON.stringify(saved.payload.cacheSourcePayload),original);
 const json=Object.values(inserted).find(p=>typeof p?.value==='string'&&p.value.includes('cacheFinalizationVersion'))?.value;assert(json);
 const stored=JSON.parse(json);assert.equal(stored.rows[0].calc.G,210);assert.equal(stored.rows[0].calc.H,20);assert.equal(stored.rows[0].calc.J,790);
 const revisited=S.storedProfitPayload({orderYear:'2026',major:'36',payload:stored,versionNo:2},{orderYear:'2026',major:'36'});
 assert.equal(C.profitDisplayCalculation(revisited).rows[0].calc.J,790);
});
test('all refresh callers use finalization inside the existing atomic snapshot service',async()=>{
 const source=fs.readFileSync(path.join(root,'pages/api/sales/profit-report.js'),'utf8');
 const body=source.slice(source.indexOf('export async function saveProfitReportCache('),source.indexOf('/**',source.indexOf('export async function saveProfitReportCache('))).replace('export ','');
 let called=0;
 const fn=new Function('saveProfitCache','loadCoherentLatestReport',body+';return saveProfitReportCache;')
  (async(o,compute)=>compute(o.major,o.orderYear),async(m,y,options)=>{called++;assert.equal(y,'2026');assert.equal(m,'36');assert.equal(options.forCache,true);return finalFixture();});
 assert.equal((await fn({orderYear:'2026',major:'36'})).cacheFinalizationVersion,1);assert.equal(called,1);
});
