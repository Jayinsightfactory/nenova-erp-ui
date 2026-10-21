const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  await require('./historicalStockRepair.test.cjs');
  const { auditStockRange, independentProfitMath, auditReportAgainstStock, roundQty, finite, auditUnitFactor } = await import('../lib/profitIndependentAudit.mjs');
  const product = {ProdKey:1,ProdName:'합성 알스트로',Category:'알스트로',OutUnit:'단',EstUnit:'단',Stockable:1,isDeleted:0};
  const fixture = () => ({products:[product],masters:[
    {StockKey:1,OrderYear:'2025',OrderWeek:'52-02'}, {StockKey:2,OrderYear:'2026',OrderWeek:'01-01'},
    {StockKey:3,OrderYear:'2026',OrderWeek:'02-01'}, {StockKey:9,OrderYear:'2025',OrderWeek:'01-01'},
  ],stocks:[{StockKey:1,ProdKey:1,Stock:10},{StockKey:2,ProdKey:1,Stock:13},{StockKey:3,ProdKey:1,Stock:12},{StockKey:9,ProdKey:1,Stock:999}],
    incoming:[{OrderYear:'2026',OrderWeek:'01-01',ProdKey:1,OutQuantity:5},{OrderYear:'2025',OrderWeek:'01-01',ProdKey:1,OutQuantity:999}],
    outgoing:[{OrderYear:'2026',OrderWeek:'01-01',ProdKey:1,OutQuantity:2},{OrderYear:'2026',OrderWeek:'02-01',ProdKey:1,OutQuantity:1}],adjustments:[],prices:[]});
  const run = f => auditStockRange(f,{year:'2026',major:'02'});
  let out=run(fixture()); assert.equal(out.weeks[0].status,'MATCH'); assert.equal(out.weeks[1].status,'MATCH');
  assert.equal(out.weeks[0].begin.year,'2025'); assert.equal(out.weeks[0].begin.week,'52-02');
  let f=fixture();f.stocks[1].Stock=15;f.stocks[2].Stock=14;out=run(f);
  assert.equal(out.weeks[0].status,'MISMATCH');assert.equal(out.weeks[0].entries[0].difference,2);
  assert.equal(out.weeks[1].status,'CARRIED');assert.equal(out.weeks[1].entries[0].firstObserved,'2026/01-01');
  assert.equal(out.weeks[1].entries[0].openingError,2);assert.equal(out.weeks[1].entries[0].closingError,2);
  f.stocks[2].Stock=12;out=run(f);assert.equal(out.weeks[1].entries[0].closingError,0);
  f=fixture(); f.adjustments=[{OrderYear:'2026',OrderWeek:'01-01',ProdKey:1,BeforeValue:0,AfterValue:2,TypeMatches:1,Descr:''},
    {OrderYear:'2026',OrderWeek:'01-01',ProdKey:1,BeforeValue:2,AfterValue:0,TypeMatches:1,Descr:'합성 사유'}];
  out=run(f);assert.equal(out.weeks[0].status,'MATCH');assert.equal(out.weeks[0].entries[0].adjustmentCount,2);assert.equal(out.weeks[0].entries[0].missingReasonCount,1);
  f.adjustments[0].TypeMatches=2;assert.equal(run(f).weeks[0].status,'INPUT_REQUIRED');
  for (const mutation of [f=>{f.stocks[0].Stock=null;},f=>{f.stocks.splice(0,1);},f=>{f.masters.push({...f.masters[1],StockKey:4});},f=>{f.incoming[0].OutQuantity=null;},f=>{f.stocks.push({...f.stocks[1]});}]) {
    f=fixture();mutation(f);assert.equal(run(f).weeks[0].status,'INPUT_REQUIRED');
  }
  f=fixture();f.masters=f.masters.filter(x=>x.StockKey!==2);assert.equal(run(f).weeks[1].status,'INPUT_REQUIRED');
  f=fixture();f.masters.push({StockKey:4,OrderYear:'2026',OrderWeek:'01-01B'});f.stocks.push({StockKey:4,ProdKey:1,Stock:13});
  out=run(f);assert.equal(out.weeks[0].status,'INPUT_REQUIRED');assert.equal(out.weeks[1].status,'INPUT_REQUIRED');assert.equal(out.weeks[1].openingPolicyMismatch,true);assert.equal(out.invalidKeyCount,1);
  f=fixture();f.masters.push({StockKey:5,OrderYear:'2025',OrderWeek:'53-01'});f.stocks.push({StockKey:5,ProdKey:1,Stock:10});
  out=run(f);assert.equal(out.weeks[0].openingPolicyMismatch,true);assert.equal(out.weeks[0].status,'INPUT_REQUIRED');assert.equal(out.weeks[0].begin.week,'52-02');
  f=fixture();f.masters[1].NativePreviousStockKey=999;assert.equal(run(f).weeks[0].status,'INPUT_REQUIRED');
  f=fixture();f.masters.push({StockKey:6,OrderYear:'2025',OrderWeek:'60-01'});f.stocks.push({StockKey:6,ProdKey:1,Stock:20});f.masters[1].NativePreviousStockKey=6;f.stocks[1].Stock=23;
  out=run(f);assert.equal(out.weeks[0].openingPolicyMismatch,true);assert.equal(out.weeks[0].localMismatchCount,0);
  assert.equal(finite(null),null);assert.equal(finite(0),0);assert.equal(roundQty(-1.235),-1.24);assert.equal(roundQty(1.235),1.24);
  assert.equal(auditUnitFactor({...product,OutUnit:'박스',BunchOf1Box:20}),20);assert.equal(auditUnitFactor({...product,OutUnit:'박스'}),null);
  f=fixture();f.prices=[{OrderYear:'2026',OrderWeek:'01-01',ProdKey:1,Price:100,EvidenceStatus:'VERIFIED',SourceRef:'fixture',EffectiveAt:'2026-01-01',ConfirmedBy:'fixture',ConfirmedAt:'2026-01-01'}];
  out=run(f);assert.equal(out.weeks[0].end.categories.알스트로.value,1300);
  f.prices[0].OrderYear='2025';assert.equal(run(f).weeks[0].end.categories.알스트로.value,null);
  const row={category:'알스트로',variant:'normal',auto:{N:1000,L:-50,O:0,Q:10,R:10,S:2,H:30,E:100,F:50},manual:{},source:{S:'manual'}};
  let math=independentProfitMath(row);assert.equal(math.values.C,950);assert.equal(math.values.J,750);assert.equal(math.values.K,750/950);
  assert.equal(independentProfitMath({...row,auto:{...row.auto,E:null}}).status,'INPUT_REQUIRED');
  assert.equal(independentProfitMath({...row,auto:{...row.auto,R:null}}).status,'INPUT_REQUIRED');
  math=independentProfitMath({...row,variant:'noEnding'});assert.equal(math.values.J,750);assert.equal(math.values.K,.75);
  math=independentProfitMath({...row,auto:{...row.auto,N:50}});assert.equal(math.values.K,null);
  const report={rows:[row],stockWeeks:{}};
  const checked=auditReportAgainstStock(report,out.weeks[0],[{...row,calc:{...independentProfitMath(row).values,J:999}}]);
  assert.deepEqual(checked.rows[0].differences,['J']);assert.equal(checked.rows[0].valuation[0].status,'INPUT_REQUIRED');
  assert.equal(auditReportAgainstStock({...report,confirmed:{revisionNo:1}},out.weeks[0]).rows[0].valuation[1].status,'HISTORICAL');
  assert.equal(auditReportAgainstStock({rows:[{...row,auto:{...row.auto,E:null}}]},null).totals,null);
  assert.match(auditReportAgainstStock({rows:[{...row,auto:{...row.auto,E:10000}}]},null).rows[0].cause,/음수로 바꾼 직접 요인은 기초재고액/);
  const core=fs.readFileSync('lib/profitIndependentAudit.mjs','utf8');
  assert.doesNotMatch(core,/^import .*profitReportCalc/m);
  const source=fs.readFileSync('lib/profitIndependentAuditSource.js','utf8');
  assert.doesNotMatch(source,/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|EXEC\s+|CREATE\s+TABLE|ALTER\s+)\b/i);
  assert.match(source,/OrderYear=@year/);assert.match(source,/OrderYear=@previousYear/);assert.match(source,/DetailFix=1/);
  assert.match(source,/before.hash !== after.hash/);assert.match(source,/knownStockCalculationPolicy\(after.policyHash\)/);assert.match(source,/JSON.stringify\(\{ data, policyHash, invalid \}\)/);
  assert.doesNotMatch(source,/sm\.isFix\s*=/);
  const api=fs.readFileSync('pages/api/sales/profit-independent-audit.js','utf8');
  assert.match(api,/withAuth/);assert.match(api,/req.method !== 'GET'/);assert.match(api,/outputScope\(req.query.year, req.query.week\)/);
  const ui=fs.readFileSync('components/ProfitIndependentAudit.js','utf8');
  assert.match(ui,/method: 'GET'/);assert.doesNotMatch(ui,/method: 'POST'|snapshotRefresh/);
  assert.match(ui,/미실행/);assert.match(ui,/판정 보류/);assert.match(ui,/전후 원천/);assert.match(ui,/request.current === controller/);
  const vm=require('node:vm');let calls=0;const ctx={AbortController,console,withAuth:f=>f,
    outputScope:(await import('../lib/profitRangeOutput.mjs')).outputScope,
    collectIndependentAudit:async scope=>{calls++;return {...scope,weeks:[{major:'01',entries:[{fixture:true}],begin:null,end:null},{major:'02',entries:[],begin:null,end:null}]};}};
  vm.runInNewContext(api.replace(/^import .*;\r?\n/gm,'').replace('export default withAuth','handler = withAuth'),ctx);
  const invoke=async(method,query)=>{const response={writableEnded:false,setHeader(){},on(){},removeListener(){},status(code){this.code=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}};await ctx.handler({method,query},response);return response;};
  assert.equal((await invoke('POST',{year:'2026',week:'02'})).code,405);
  assert.equal((await invoke('GET',{week:'02'})).code,400);
  assert.equal((await invoke('GET',{year:['2025','2026'],week:'02'})).code,400);
  assert.equal((await invoke('GET',{year:'2026',week:'02',detail:'03'})).code,400);assert.equal(calls,0);
  const response=await invoke('GET',{year:'2026',week:'02',detail:'01'});assert.equal(response.code,200);assert.equal(response.body.orderYear,'2026');assert.equal(response.body.weeks[0].entries.length,1);assert.equal(response.body.weeks[1].detailsLoaded,false);assert.equal(calls,1);
  console.log('Independent audit PASS: scope, carry, repair, missing/duplicate/null, net-zero adjustments, unit/value, math mutation, historical, readonly guards');
})().catch(e=>{console.error(e);process.exitCode=1;});
