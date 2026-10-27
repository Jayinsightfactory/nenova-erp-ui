const assert = require('node:assert/strict');
const fs = require('node:fs');
async function main() {
  const carry = await import('../lib/profitReportAcquisitionCarry.mjs');
  const rateCarry = await import('../lib/profitReportTaxableRateCarry.js');
  const rates = await import('../lib/taxableExchangeRate.js');
  const calc = await import('../lib/profitReportCalc.js');
  const valuation = await import('../lib/profitReportValuation.mjs');
  const catalog = await import('../lib/profitReportInventoryWorkbookCatalog.js');
  const audit = await import('../lib/profitReportAudit.js');
  const source = 'approved_customs_timing_estimate';
  const detail = { estimated:true, orderYear:'2026',major:'34',scheduleId:'china-plus-one',dateSource:source,
    officialSourceRange:{start:'2026-08-23',end:'2026-08-29'} };
  const context = {orderYear:'2026',major:'34',rate:200,rateSource:source,rateDetail:detail};
  const exact = {price:100,source:'VERIFIED_FREIGHT_ARRIVAL_CALC',sourceRefs:['purchase:2026:34']};
  assert.equal(carry.withPurchaseRateEvidence(exact,{...context,rateSource:'kcs_api'}),exact,'actual evidence preserved');
  const estimated = carry.withPurchaseRateEvidence(exact,context);
  assert.equal(estimated.price,100); assert.equal(estimated.source,'APPROVED_ESTIMATE');
  assert.equal(estimated.estimated,true);assert.equal(estimated.rateDetail,detail);
  const actualSnapshot={...exact,reportRateApplied:false,reportRateEvidence:[{rate:201,source:'freight_cost_snapshot'}]};
  assert.equal(carry.withPurchaseRateEvidence(actualSnapshot,context),actualSnapshot,'unused estimate must not relabel actual snapshot');
  assert.ok(estimated.sourceRefs.some(ref=>ref.startsWith(source+':2026:34:')));
  assert.equal(carry.withPurchaseRateEvidence(exact,{...context,orderYear:'2025'}),null);
  assert.equal(carry.withPurchaseRateEvidence(exact,{...context,major:'35'}),null);
  const purchase = {OrderYear:'2026',OrderWeek:'34-01',Category:'중국',ProdKey:7,Quantity:10,
    ForeignTotal:20,EstUnit:'단',Complete:true,RowCount:1};
  const older = carry.buildAcquisitionCarryEvidence(purchase,{...context,targetWeek:'41-01',arrival:{price:100,unit:'단',rowCount:1}});
  assert.equal(older.source,'APPROVED_ESTIMATE');assert.ok(older.sourceRefs.some(ref=>ref.includes(source)));
  const snapshotCarry=carry.buildAcquisitionCarryEvidence(purchase,{...context,rate:null,rateSource:null,targetWeek:'41-01',arrival:{...actualSnapshot,unit:'단',rowCount:1}});
  assert.equal(snapshotCarry.source,'VERIFIED_CARRIED_ACQUISITION');assert.equal(snapshotCarry.estimated,false);
  assert.ok(snapshotCarry.sourceRefs.every(ref=>!ref.includes(source)),'unused timing candidate must not leak into actual snapshot provenance');
  assert.equal(carry.buildAcquisitionCarryEvidence(purchase,{...context,rate:null,rateSource:null,targetWeek:'41-01',arrival:{...actualSnapshot,unit:'단',rowCount:1,reportRateEvidence:[{rate:201,source:'currency_master'}]}}),null);
  assert.equal(carry.buildAcquisitionCarryEvidence(purchase,{...context,targetWeek:'41-01',rateSource:'approximate_currency_master',arrival:{price:100,unit:'단',rowCount:1}}),null);
  let calls=0;
  const loaded=await carry.loadPurchasePeriodArrivalEvidence({...context,orderWeek:'34-01',country:'중국',currency:'CNY'},async(year,week,options)=>{
    calls++;assert.equal(year,'2026');assert.equal(week,'34-01');
    assert.equal(options.reportExchangeRate.estimated,true);assert.equal(options.reportExchangeRate.rate,200);
    assert.equal(options.reportExchangeRate.preserveStoredExchangeRate,true);
    assert.equal(options.reportExchangeRate.detail,detail);return {7:estimated};
  });
  assert.equal(loaded[7].source,'APPROVED_ESTIMATE');
  assert.deepEqual(await carry.loadPurchasePeriodArrivalEvidence({...context,orderYear:'2025',orderWeek:'34-01',country:'중국',currency:'CNY'},()=>{throw Error('cross-year loader called')}),{});
  assert.equal(calls,1);
  await carry.loadPurchasePeriodArrivalEvidence({...context,rate:null,rateSource:null,orderWeek:'34-01',country:'중국',currency:'CNY'},async(y,w,options)=>{
    assert.equal(options.reportExchangeRate.rate,null);assert.equal(options.reportExchangeRate.preserveStoredExchangeRate,true);return {};
  });
  await carry.loadPurchasePeriodArrivalEvidence({...context,rate:202,rateSource:'manual',orderWeek:'34-01',country:'중국',currency:'CNY'},async(y,w,options)=>{
    assert.equal(options.reportExchangeRate.rate,202);assert.equal(options.reportExchangeRate.preserveStoredExchangeRate,undefined,'explicit manual override remains highest priority');return {};
  });
  assert.equal(carry.purchaseRateCountry('콜롬비아 수국'),'콜롬비아');
  assert.equal(carry.purchaseRateCountry('중국'),'중국');
  assert.equal(carry.needsPurchasePeriodFreight('2026','27','중국'),false);
  assert.equal(carry.needsPurchasePeriodFreight('2025','34','네덜란드'),false);
  assert.equal(carry.needsPurchasePeriodFreight('2026','28','중국'),true);
  assert.equal(carry.needsPurchasePeriodFreight('2026','27','태국'),true);
  await carry.loadPurchasePeriodArrivalEvidence({...context,orderWeek:'34-01',country:'콜롬비아 수국',currency:'USD'},async(y,w,options)=>{
    assert.equal(options.reportExchangeRate.country,'콜롬비아');return {};
  });

  const fiscalContext = {kcsRates:{byCategory:{중국:{rate:200,detail}}},purchaseQty:{중국:10}};
  const current = rateCarry.resolveExactRateForWeek({orderYear:'2026',major:'34',category:'중국',currency:'CNY',...fiscalContext});
  assert.equal(current.source,rates.RATE_SOURCE.APPROVED_TIMING_ESTIMATE);assert.equal(current.estimated,true);
  const carried = await rateCarry.walkCarry({orderYear:'2026',major:'35',category:'중국',currency:'CNY',maxSteps:1,
    getWeekContext:async(y,m)=>{assert.equal(y,'2026');assert.equal(m,'34');return fiscalContext;}});
  assert.equal(carried.estimated,true);assert.equal(carried.originalSource,source);assert.equal(carried.detail,detail);
  const manual = rateCarry.resolveExactRateForWeek({orderYear:'2026',major:'34',category:'중국',currency:'CNY',manualRate:201,...fiscalContext});
  assert.equal(manual.rate,201);assert.notEqual(manual.estimated,true);

  const sourceCode=fs.readFileSync('lib/profitReport.js','utf8');
  const timingPolicy=await import('../lib/profitReportCustomsRateTiming.mjs');
  const wrapperStart=sourceCode.indexOf('async function reportPeriodFreightArrivalEvidence(');
  const wrapperEnd=sourceCode.indexOf('\nfunction missingPriceItemFromRow',wrapperStart);
  const arrivalOptions=[];
  const fallback=new Function('freightArrivalPriceEvidenceByProduct','isApprovedCustomsTimingPeriod','query','CASE_CATEGORY','NORMALIZED_ORDER_WEEK_SQL','stockablePurchaseItemSql','sql','needsPurchasePeriodFreight','fifoLayerRateAndCustoms','loadPurchasePeriodArrivalEvidence','currencyCodeForCategory',
    sourceCode.slice(wrapperStart,wrapperEnd)+';return reportPeriodFreightArrivalEvidence;')(
    async(y,w,options)=>{arrivalOptions.push(options);return {7:{price:999,source:'old-current-fx'},8:{price:999},9:{price:123}};},timingPolicy.isApprovedCustomsTimingPeriod,
    async(sqlText,params)=>{assert.match(sqlText,/wm.OrderYear=@yr/);assert.equal(params.yr.value,'2026');assert.equal(params.week.value,'34-01');return {recordset:[{ProdKey:7,Category:'중국'},{ProdKey:8,Category:'네덜란드'}]};},
    'category',x=>x,()=> '1=1',{NVarChar:'nvarchar'},carry.needsPurchasePeriodFreight,
    async(y,m,c)=>({rate:c==='중국'?200:null,rateSource:source,rateDetail:detail}),
    async({country,orderYear,orderWeek},loadArrival)=>{await loadArrival(orderYear,orderWeek,{reportExchangeRate:{currency:'CNY',country,rate:200}});return country==='중국'?{7:estimated,8:{price:222}}:{};},()=> 'CNY');
  const corrected=await fallback('2026','34-01');
  assert.equal(corrected[7].price,100,'fallback uses scoped purchase-period FX, not current FX');
  assert.equal(corrected[8],undefined,'missing scoped evidence cannot reveal stale fallback or another country result');
  assert.equal(corrected[9].price,123,'unrelated scope is preserved');
  assert.equal((await fallback('2026','27-01'))[7].price,999,'pre-policy non-Thai fallback unchanged');
  assert(arrivalOptions.every(options=>options.strictReceiptLines===false),'existing callers keep strict line matching off');
  arrivalOptions.length=0;
  await fallback('2026','34-01',{strictReceiptLines:true});
  assert(arrivalOptions.length>1 && arrivalOptions.every(options=>options.strictReceiptLines===true),'new strict option reaches baseline and purchase-period FX loaders');
  assert(arrivalOptions.some(options=>options.reportExchangeRate?.rate===200),'strict option preserves scoped purchase FX options');
  assert.ok(sourceCode.includes('beginWeek ? reportPeriodFreightArrivalEvidence(prevOrderYear, beginWeek)'));
  assert.ok(sourceCode.includes('reportPeriodFreightArrivalEvidence(orderYear, week),'));
  assert.ok(sourceCode.includes('(chosen === arrival || chosen?.reportRateApplied === false)'));
  assert.ok(sourceCode.includes('&& isApprovedCustomsTimingPeriod(row.OrderYear, major2)'));
  const start=sourceCode.indexOf('export function resolveFifoStockEvidence(');
  const end=sourceCode.indexOf('\n/**',start);
  const fifo=new Function('computeFifoStockUnitPrice','normalizeInventoryUnit',sourceCode.slice(start,end).replace('export ','')+';return resolveFifoStockEvidence;')(calc.computeFifoStockUnitPrice,catalog.normalizeInventoryUnit);
  const ev=fifo({layers:[{offset:0,week:'2026-34',qty:10,price:100,unit:'단',estimated:true,sourceRefs:estimated.sourceRefs}],qty:2,unit:'단',orderYear:'2026',week:'34-01',prodKey:7}).evidence;
  assert.equal(ev.source,'APPROVED_ESTIMATE');assert.equal(ev.price,100);assert.equal(ev.estimated,true);
  const average=valuation.selectReportInventoryValuation({year:'2026',major:'34',week:'34-01',average:{value:200,estimated:true,sourceRefs:[source+':2026:34']}});
  assert.equal(average.status,'APPROVED_ESTIMATE');assert.equal(average.value,200);
  const catalogRows=catalog.inventoryWorkbookPriceEvidenceByProduct('2026','34-01',{rateEvidenceByCurrency:{AUD:{rate:1000,source}}});
  assert.ok(Object.values(catalogRows).some(row=>row.currency==='AUD'&&row.estimated));
  assert.ok(Object.values(catalogRows).filter(row=>row.currency==='AUD').every(row=>row.source==='APPROVED_ESTIMATE'));
  const row={category:'중국',currency:'CNY',manual:{},auto:{Q:100,S:10,R:200,H:0,E:200,F:200},source:{R:source},rateEstimated:true,rateDetail:detail,
    stock:{priceEvidenceSources:estimated.sourceRefs},beginStock:{priceEvidenceSources:[]}};
  const report=audit.buildProfitReportAudit([row],{orderYear:'2026',major:'34'});
  assert.ok(report.issues.some(i=>i.code==='APPROVED_CUSTOMS_TIMING_ESTIMATE'));
  assert.ok(report.issues.some(i=>i.code==='INVENTORY_CUSTOMS_TIMING_ESTIMATE'));
  assert.ok(!audit.buildProfitReportAudit([{...row,manual:{R:201}}],{orderYear:'2026',major:'34'}).issues.some(i=>i.code==='APPROVED_CUSTOMS_TIMING_ESTIMATE'));
  console.log('profitReportTimingIntegration: scoped estimate, manual priority, FIFO/carry/catalog/average, warnings, no current-FX substitution PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1});
