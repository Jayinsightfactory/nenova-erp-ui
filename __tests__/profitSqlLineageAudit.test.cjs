const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { aggregateSqlLineage, auditReportSqlLineage, inventoryPurchaseCoverage } = await import('../lib/profitSqlLineageAudit.mjs');
  const { classifyCategory } = await import('../lib/profitReportClassification.js');
  const scope = {year:'2026',major:'02'}, integrity={status:'STABLE_OBSERVED'};
  const base={OrderYear:'2026',OrderWeek:'01-01',OrderYearWeek:'202601',ProdKey:1,MasterFix:true,DetailFix:true,ZeroQuantity:0,Amount:100,SourceRows:1};
  const data={products:[{ProdKey:1,ProdName:'rose',CounName:'에콰도르'}, {ProdKey:2,ProdName:'수국 운송료',CounName:'국내'}, {ProdKey:3,ProdName:'GROSS WEIGHT',CounName:'에콰도르'}, {ProdKey:4,ProdName:'SERVICE FEE',CounName:'에콰도르'}],
    financeSales:[base,{...base,OrderYear:'2025',OrderYearWeek:'202501',Amount:9999},{...base,MasterFix:false},{...base,DetailFix:false},{...base,ZeroQuantity:1},{...base,OrderYearWeek:'202501',Amount:777},{...base,ProdKey:2,Amount:20},{...base,ProdKey:3}],
    financeEstimates:[{...base,EstimateType:'defect',Amount:-10},{...base,EstimateType:'other',Amount:5}],
    financePurchases:[{...base,Amount:40},{...base,ProdKey:2,Amount:20},{...base,ProdKey:3},{...base,ProdKey:4}],
    financeCodes:[{DetailCode:'defect',Descr2:'불량차감'}]};
  let out=aggregateSqlLineage(data,scope,integrity)['01'];
  assert.deepEqual(out.categories['에콰도르'],{N:100,L:-10,O:5,Q:40});
  assert.equal(out.categories['콜롬비아 수국'].O,20);assert.equal(out.excludedKeyCount,1);assert.equal(out.excludedAmounts.N,777);
  const report={rows:Object.entries(out.categories).map(([category,auto])=>({category,auto}))};
  assert.equal(auditReportSqlLineage(report,out).status,'MATCH');
  assert.equal(auditReportSqlLineage({...report,confirmed:{}},out).status,'HISTORICAL');
  assert.equal(auditReportSqlLineage({...report,snapshot:{servedFrom:'snapshot'}},out).status,'HISTORICAL');
  assert.equal(auditReportSqlLineage(report,null).status,'UNVERIFIED');
  assert.equal(auditReportSqlLineage(report,{...out,integrityStatus:'STALE'}).status,'UNVERIFIED');
  let mutation=structuredClone(report);mutation.rows[0].auto.N+=1;assert.equal(auditReportSqlLineage(mutation,out).status,'MISMATCH');
  mutation=structuredClone(report);mutation.rows[0].auto.N=null;assert.equal(auditReportSqlLineage(mutation,out).status,'MISMATCH');
  assert.equal(auditReportSqlLineage({rows:[]},out).status,'MISMATCH');
  out=aggregateSqlLineage({...data,financeCodes:[...data.financeCodes,...data.financeCodes]},scope,integrity)['01'];
  assert.equal(auditReportSqlLineage(report,out).status,'UNVERIFIED');
  out=aggregateSqlLineage({...data,categoryOverrides:{1:{category:'중국'}}},scope,integrity)['01'];assert.equal(out.categories['중국'].N,100);
  out=aggregateSqlLineage({...data,categoryOverrides:{1:{category:'잘못된 분류'}}},scope,integrity)['01'];assert.equal(out.categories['에콰도르'].N,100);
  assert.equal(classifyCategory('국내','왁스','Hydrangea test'),'콜롬비아 수국');
  assert.equal(classifyCategory('국내','왁스','수국 샘플'),'국내');
  const snap={year:'2026',week:'01-02',categories:{test:{items:[{prodKey:1},{prodKey:9}]}}};
  assert.equal(inventoryPurchaseCoverage(snap,data.financePurchases,'2026')[1].status,'PURCHASE_PRESENT');
  assert.equal(inventoryPurchaseCoverage(snap,[{...base,OrderWeek:'02-01'}],'2026')[1].status,'NO_PURCHASE_AT_CUTOFF');
  assert.equal(inventoryPurchaseCoverage({...snap,year:'2025'},data.financePurchases,'2026')[1].status,'OUTSIDE_SCOPE');
  assert.equal(inventoryPurchaseCoverage(snap,[{...base,OrderWeek:'01-02A'}],'2026')[1].status,'AMBIGUOUS_PURCHASE_WEEK');
  const missing={rows:[{...report.rows[0],stock:{missingPriceItems:[{prodKey:9,prodName:'synthetic'}]}}]};
  const coverageSource={...out,purchaseCoverage:{end:inventoryPurchaseCoverage(snap,data.financePurchases,'2026')}};
  assert.match(auditReportSqlLineage(missing,coverageSource).inventoryIssues[0].reason,/미래 매입단가/);
  const source=fs.readFileSync('lib/profitIndependentAuditSource.js','utf8');
  assert.match(source,/financeSales, financeEstimates, financePurchases, financeCodes/);
  assert.match(source,/categoryOverrides: loadProfitCategoryOverrides\(true\)/);
  assert.match(source,/aggregateSqlLineage\(after.data, scope, integrity\)/);
  assert.doesNotMatch(source,/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET|CREATE\s+TABLE)\b/i);
  assert.doesNotMatch(fs.readFileSync('lib/profitSqlLineageAudit.mjs','utf8'),/from ['"].*profitReportCalc/);
  console.log('SQL lineage PASS: raw sums, cross-year, fix/zero, key collision, costs, duplicates, null, overrides, historical, stale and mutation');
})().catch(error=>{console.error(error);process.exitCode=1;});
