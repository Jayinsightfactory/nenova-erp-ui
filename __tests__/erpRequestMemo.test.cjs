const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../lib/erpRequestMemo.mjs'),import('../lib/erpReadContext.js')]);
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
