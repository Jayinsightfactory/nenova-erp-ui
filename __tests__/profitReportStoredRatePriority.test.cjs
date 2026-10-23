const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { resolveAcquisitionCarryFx } = await import('../lib/profitReportAcquisitionCarry.mjs');
  const { aggregateArrivalCosts } = await import('../lib/pivotArrivalCalc.js');
  const code = fs.readFileSync('lib/pivotFreightArrival.js', 'utf8');
  const start = code.indexOf('  const invoiceCurrency = detectInvoiceCurrency(');
  const end = code.indexOf('  // 카테고리 오버라이드 적용', start);
  assert(start > 0 && end > start, 'execute the production FX selection block');
  const select = new Function('snap','reportExchangeRate','rows','currencyRates','masters','primaryKey','workbookFxRows',
    'detectInvoiceCurrency','dominantBaseCountry','resolveAcquisitionCarryFx','resolveFreightExchangeRate',
    code.slice(start,end)+';return {fx,metadata:reportRateMetadata};');
  let genericCalls=0;
  const run=(snapshot,report,category='중국',currency='CNY')=>select(snapshot==null?null:{ExchangeRate:snapshot},report,
    [{CounName:category}],{CNY:999},[{WarehouseKey:7,OrderYear:'2026',OrderWeek:'34-01'}],7,[],
    ()=>currency,()=>category,resolveAcquisitionCarryFx,()=>{genericCalls++;return {rate:999,source:'currency_master'};});
  const request={currency:'CNY',country:'중국',rate:200,source:'approved_customs_timing_estimate',estimated:true,
    preserveStoredExchangeRate:true,detail:{orderYear:'2026',major:'34'}};
  const actual=run(205,request);
  assert.equal(actual.fx.rate,205);assert.equal(actual.metadata.reportRateApplied,false);
  assert.equal(actual.metadata.reportRateEvidence[0].source,'freight_cost_snapshot');
  assert.equal(actual.metadata.reportRateEvidence[0].estimated,undefined);
  assert.equal(run(206,request).fx.rate,206,'each AWB retains its own stored FX, not category average');
  const fallback=run(null,request);
  assert.equal(fallback.fx.rate,200);assert.equal(fallback.metadata.reportRateApplied,true);
  assert.equal(fallback.metadata.reportRateEvidence[0].estimated,true);
  assert.equal(run(205,{...request,rate:null}).fx.rate,205,'API failure still preserves exact saved AWB rate');
  for(const invalid of [0,-1,NaN,Infinity]) {
    assert.equal(run(invalid,request).fx.rate,200);
    assert.deepEqual(run(invalid,{...request,rate:null}),[],'missing everything must not call current FX');
  }
  assert.deepEqual(run(205,{...request,country:'태국'}),[]);
  assert.deepEqual(run(205,{...request,currency:'USD'}),[]);
  assert.equal(genericCalls,0,'new scoped calls never consult generic current FX');
  assert.equal(run(205,{...request,preserveStoredExchangeRate:undefined}).fx.rate,200,'legacy opt-in override behavior unchanged');
  assert.equal(run(205,undefined).fx.rate,999,'ordinary callers preserve prior generic resolver');
  assert.equal(genericCalls,1);

  const makeRow=(qty,price,metadata,unit='단')=>({prodKey:1,inQty:qty,displayArrivalKRW:price,arrivalPerStem:price/10,displayUnit:unit,source:'live',...metadata});
  const savedRow=makeRow(2,205,actual.metadata), estimatedRow=makeRow(1,200,fallback.metadata);
  const saved=aggregateArrivalCosts([savedRow],{mode:'weighted'})[1];
  assert.equal(saved.reportRateApplied,false);assert.equal(saved.reportRateEvidence.length,1);
  const mixed=aggregateArrivalCosts([savedRow,estimatedRow],{mode:'weighted'})[1];
  assert.equal(mixed.arrivalCost,(205*2+200)/3);
  assert.equal(mixed.reportRateApplied,true);assert.equal(mixed.reportRateEvidence.length,2);
  const max=aggregateArrivalCosts([savedRow,estimatedRow])[1];
  assert.equal(max.arrivalCost,205);assert.equal(max.reportRateApplied,false,'MAX provenance belongs only to selected row');
  const otherUnit=aggregateArrivalCosts([savedRow,makeRow(1,200,fallback.metadata,'송이')],{mode:'weighted'})[1];
  assert.equal(otherUnit.reportRateApplied,false,'discarded units cannot taint selected evidence');
  assert.equal(aggregateArrivalCosts([makeRow(1,123,{})],{mode:'weighted'})[1].reportRateApplied,undefined,'ordinary aggregation shape unchanged');
  console.log('PASS: per-AWB stored FX priority, snapshot-only recovery, no current-FX fallback, scoped provenance and legacy preservation');
})().catch(error=>{console.error(error);process.exitCode=1});
