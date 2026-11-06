const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../lib/erpRequestMemo.mjs'),import('../lib/erpReadContext.js')]);
test('scope exit drops only cache references, preserves returned and cached objects and external evidence',async()=>{
 const [,{withErpReadContext:scope,currentErpReadContext:current,erpContextCache:cache}]=await modules;
 const external={rate:{value:0}},payload={rows:[{value:0}]};let context,held;
 const value=await scope({queryFn:async()=>({}),externalEvidence:external},async()=>{
  context=current();held=cache('held',null);held.set('payload',payload);return payload;
 });
 assert.equal(value,payload);assert.deepEqual(value,{rows:[{value:0}]});assert.equal(held.get('payload'),payload);
 assert.equal(context.caches.size,0);assert.equal(context.externalEvidence,external);assert.equal(current(),undefined);
});
test('work, swallowed source and missing-evidence failures release caches without changing error precedence',async()=>{
 const [,{withErpReadContext:scope,currentErpReadContext:current,erpContextCache:cache}]=await modules;
 for(const mode of ['work','source','evidence','source-and-evidence']){
  const original=Error('fixture');let context;
  await assert.rejects(scope({queryFn:async()=>{throw original;}},async()=>{
   context=current();cache('held',null).set('payload',{value:0});
   if(mode==='work')throw original;
   if(mode.includes('source'))await context.query('SELECT 1').catch(()=>{});
   context.missingEvidence.add('USD:2026-01-01');return {value:0};
  }),error=>mode==='work'?error===original:mode.includes('source')?error.code==='APPROVAL_REPORT_SOURCE_FAILED'&&error.cause===original:error.code==='APPROVAL_EXTERNAL_EVIDENCE_REQUIRED'&&error.evidenceKeys[0]==='USD:2026-01-01');
  assert.equal(context.caches.size,0);
  if(mode!=='work')assert.ok(context.missingEvidence.has('USD:2026-01-01'));
 }
});
test('successful and throwing work retain cache until outstanding scoped SELECT drains',async()=>{
 const [,{withErpReadContext:scope,currentErpReadContext:current,erpContextCache:cache}]=await modules;
 for(const fail of [false,true]){
  let context,release,workEnded=false,settled=false;const original=Error('work');
  const pending=scope({queryFn:()=>new Promise(resolve=>{release=resolve;})},async()=>{
   context=current();cache('held',null).set('value',0);void context.query('SELECT 1');
   await Promise.resolve();workEnded=true;if(fail)throw original;return 0;
  });
  const observed=pending.then(value=>{settled=true;return value;},error=>{settled=true;assert.equal(error,original);});
  while(!release||!workEnded)await Promise.resolve();
  assert.equal(settled,false);assert.equal(context.caches.size,1);
  release({recordset:[]});await observed;assert.equal(settled,true);assert.equal(context.caches.size,0);
 }
});
test('concurrent scopes and nested scopes release only their own caches',async()=>{
 const [,{withErpReadContext:scope,currentErpReadContext:current,erpContextCache:cache}]=await modules;
 let releaseFirst,releaseSecond,first,second;
 const run=(id,hold)=>scope({queryFn:async()=>({})},async()=>{const ctx=current();cache('same',null).set('id',id);if(id===1)first=ctx;else second=ctx;await hold;return id;});
 const a=run(1,new Promise(resolve=>{releaseFirst=resolve;})),b=run(2,new Promise(resolve=>{releaseSecond=resolve;}));
 assert.notEqual(first,second);releaseFirst();assert.equal(await a,1);assert.equal(first.caches.size,0);assert.equal(second.caches.size,1);
 releaseSecond();assert.equal(await b,2);assert.equal(second.caches.size,0);
 let outer,inner;
 await scope({queryFn:async()=>({})},async()=>{
  outer=current();const held=cache('same',null);held.set('id',1);
  await scope({queryFn:async()=>({})},async()=>{inner=current();cache('same',null).set('id',2);});
  assert.equal(inner.caches.size,0);assert.equal(current(),outer);assert.equal(outer.caches.size,1);assert.equal(held.get('id'),1);
 });assert.equal(outer.caches.size,0);
});
test('exact request key separates year, zero, false, omitted, undefined and nested options',async()=>{
 const [{erpRequestMemoKey:key}]=await modules;
 const samples=[{}, {year:'2026'}, {year:'2025'}, {cost:0}, {cost:false}, {cost:null}, {cost:undefined}, {cost:'0'}, {cost:-0}, {cost:NaN}, {options:{strict:false}}, {options:{strict:true}}];
 assert.equal(new Set(samples.map(x=>key(x))).size,samples.length);
 assert.equal(key({b:0,a:false}),key({a:false,b:0}));
 const state={functions:new WeakMap(),nextFunction:0},a=()=>0,b=()=>0;
 assert.equal(key({queryRunner:a},state),key({queryRunner:a},state));assert.notEqual(key({queryRunner:a},state),key({queryRunner:b},state));
});
test('one promise per exact scope; clone isolates consumers; no cross-request or global memo',async()=>{
 const [{memoizeErpRequestRead:memo},{withErpReadContext:scope}]=await modules;
 let reads=0;const read=async()=>({rows:[{cost:++reads}],date:new Date(0)});
 await scope({queryFn:async()=>({})},async()=>{
  const [a,b]=await Promise.all([memo('test',{year:'2026'},read),memo('test',{year:'2026'},read)]);
  assert.equal(reads,1);a.rows[0].cost=900;assert.equal(b.rows[0].cost,1);
  assert.equal((await memo('test',{year:'2026'},read)).rows[0].cost,1);
  assert.ok(b.date instanceof Date);await memo('test',{year:'2025'},read);assert.equal(reads,2);
 });
 await scope({queryFn:async()=>({})},()=>memo('test',{year:'2026'},read));assert.equal(reads,3);
 await memo('test',{},read);await memo('test',{},read);assert.equal(reads,5);
});
test('rejection evicts and unsupported arguments preserve uncached behavior',async()=>{
 const [{memoizeErpRequestRead:memo},{withErpReadContext:scope}]=await modules;let reads=0;
 await scope({queryFn:async()=>({})},async()=>{
  await assert.rejects(memo('fail',{},async()=>{reads++;throw Error('fail');}));
  assert.equal(await memo('fail',{},async()=>++reads),2);
  const cycle={};cycle.self=cycle;
  assert.equal(await memo('cycle',cycle,async()=>++reads),3);
  assert.equal(await memo('cycle',cycle,async()=>++reads),4);
 });
});
test('FX loader preserves SQL/year scope and empty input, memoizes normalized year set only inside request',async()=>{
 const fs=require('node:fs');
 const [{memoizeErpRequestRead:memo},{withErpReadContext:scope}]=await modules;
 const source=fs.readFileSync(require.resolve('../lib/sourceWorkbookFx.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 let queries=0;const rows=[{ExchangeRate:0},{ExchangeRate:false},{ExchangeRate:null}];
 const query=async(sql,params)=>{queries++;if(sql.includes('OBJECT_ID'))return {recordset:[{TableId:1}]};assert.match(sql,/OrderYear IN/);assert.deepEqual(Object.values(params).map(p=>p.value).sort(),['2025','2026']);return {recordset:rows};};
 const {loadSourceWorkbookFxRows:load}=new Function('query','sql','memoizeErpRequestRead','COUNTRY_CURRENCY_MAP',source+';return {loadSourceWorkbookFxRows};')(query,{NVarChar:'string'},memo,{});
 for(const value of [0,false,null,undefined,'invalid',[]])assert.deepEqual(await load(value),[]);
 assert.equal(queries,0);
 await scope({queryFn:query},async()=>{
  const a=await load(['2026','2025','2026']);assert.deepEqual(a,rows);a[0].ExchangeRate=999;
  assert.deepEqual(await load(['2025','2026']),rows);assert.equal(queries,2);
 });
 await load(['2025','2026']);await load(['2025','2026']);assert.equal(queries,6);
});
test('arrival entrypoint keys every option and query runner, with original reads outside scope',async()=>{
 const fs=require('node:fs');const [{memoizeErpRequestRead:memo},{withErpReadContext:scope}]=await modules;
 const source=fs.readFileSync(require.resolve('../lib/pivotFreightArrival.js'),'utf8')
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm,'').replace(/^export \{ aggregateArrivalCosts \};\r?\n/m,'').replaceAll('export ','');
 let reads=0;const query=async()=>{reads++;return {recordset:[]};};
 const load=new Function('memoizeErpRequestRead','query','sql','normalizeOrderWeek','resolveActiveOrderYear','buildOrderYearWeek',source+';return getArrivalCostsForWeekRange;')
  (memo,query,{NVarChar:'string'},x=>x,(week,year,fallback)=>year||fallback,(year,week)=>year+week);
 const base={weekStart:'44-01',orderYear:'2026',queryRunner:query};
 await scope({queryFn:query},async()=>{
  await Promise.all([load(base),load({...base})]);assert.equal(reads,1);
  for(const extra of [{orderYear:'2025'},{strictReceiptLines:false},{strictReceiptLines:true},{reportCustomsCost:{total:0}},{reportCustomsCost:{total:false}},{reportExchangeRate:{rate:0}},{reportActualCosts:false},{dutyBasisOnly:false},{aggregate:'weighted'},{weekEnd:'44-02'},{queryRunner:async()=>query()}])await load({...base,...extra});
  assert.equal(reads,12);
 });
 await load(base);await load(base);assert.equal(reads,14);
});
