const assert = require('node:assert/strict');
const fs = require('node:fs');
async function main() {
  const p = await import('../lib/profitReportAcquisitionCarry.mjs');
  const row = { OrderYear: '2026', OrderWeek: '30-01', ProdKey: 7, Category: '에콰도르', EstUnit: '송이', Quantity: 100, ForeignTotal: 50, Complete: true, RowCount: 2 };
  const scope = { orderYear: '2026', targetWeek: '40-03' };
  assert.equal(p.selectOlderAcquisitionPurchases([row], scope).length, 1);
  const dutch = {...row, Category:'네덜란드', OrderWeek:'22-02', ProdKey:2575};
  const dutchScope = {orderYear:'2026',targetWeek:'26-10'};
  assert.equal(p.selectOlderAcquisitionPurchases([dutch], dutchScope).length,1);
  for (const change of [{OrderYear:'2025'}, {OrderWeek:'27-01'}, {Category:'베트남'}]) {
    assert.equal(p.selectOlderAcquisitionPurchases([{...dutch,...change}],dutchScope).length,0);
  }
  assert.equal(p.selectOlderAcquisitionPurchases([dutch],{...dutchScope,targetWeek:'25-02'}).length,0,'recent purchase still uses existing FIFO');
  assert.equal(p.selectOlderAcquisitionPurchases([{...row, OrderYear:'2025'}], scope).length, 0);
  assert.equal(p.selectOlderAcquisitionPurchases([{...row, OrderWeek:'41-01'}], scope).length, 0);
  assert.equal(p.selectOlderAcquisitionPurchases([{...row, OrderWeek:'37-01'}], scope).length, 0);
  assert.equal(p.selectOlderAcquisitionPurchases([row, {...row, OrderWeek:'39-01', Complete:false}], scope).length, 0, 'newer invalid purchase blocks stale price');
  assert.equal(p.selectOlderAcquisitionPurchases([row], {...scope,existing:{7:{price:42}}}).length, 0, 'explicit evidence preserved');
  assert.equal(p.selectOlderAcquisitionPurchases([{...row,Category:'호주'}],scope).length,1);
  const china = {...row, Category:'중국', OrderWeek:'19-01', ProdKey:3096, EstUnit:'단', RowCount:1};
  const chinaScope = {orderYear:'2026',targetWeek:'26-10'};
  assert.equal(p.selectOlderAcquisitionPurchases([china],chinaScope).length,1);
  for (const change of [{Category:'미국'}, {Quantity:0}, {ForeignTotal:0}, {Complete:false}, {OrderWeek:'30-01B'}]) {
    assert.equal(p.selectOlderAcquisitionPurchases([{...row,...change}], scope).length, 0);
  }
  const ctx = {...scope,rate:1400,rateSource:'kcs_api',arrival:{price:1700,unit:'송이',rowCount:2}};
  assert.equal(p.buildAcquisitionCarryEvidence(row,ctx).price,1700);
  assert.equal(p.buildAcquisitionCarryEvidence(dutch,{...ctx,...dutchScope}).price,1700);
  const chinaContext={...chinaScope,rate:200,rateSource:'excel_historical_snapshot',arrival:{price:3000,unit:'단',rowCount:1}};
  assert.equal(p.buildAcquisitionCarryEvidence(china,chinaContext).price,3000);
  // Two distinct Thai products keep their own purchase price at every cutoff.
  // Synthetic values: never encode live invoice/product data in fixtures.
  const thaiRows=[{...row,Category:'태국',OrderWeek:'34-01',ProdKey:91,EstUnit:'단',RowCount:1},
    {...row,Category:'태국',OrderWeek:'34-01',ProdKey:92,EstUnit:'단',RowCount:1,ForeignTotal:70}];
  for(const targetWeek of ['38-02','39-02','40-03','41-03']) {
    const thaiScope={orderYear:'2026',targetWeek};
    assert.equal(p.selectOlderAcquisitionPurchases(thaiRows,thaiScope).length,2);
    for(const [i,thai] of thaiRows.entries()) {
      const ctx={...thaiScope,rate:1400,rateSource:'kcs_api',arrival:{price:2000+i*100,unit:'단',rowCount:1}};
      const evidence=p.buildAcquisitionCarryEvidence(thai,ctx);
      assert.equal(evidence.price,2000+i*100);
      assert(evidence.sourceRefs[0].includes(`prod-${thai.ProdKey}`));
      for(const bad of [{OrderYear:'2025'},{OrderWeek:'42-01'},{Complete:false},{Quantity:0},{ForeignTotal:0},{RowCount:2},{EstUnit:'송이'}]) {
        assert.equal(p.buildAcquisitionCarryEvidence({...thai,...bad},ctx),null);
      }
      for(const bad of [{rate:0},{rate:null},{rateSource:'currency_master'},{arrival:{price:2000,unit:'박스',rowCount:1}}]) {
        assert.equal(p.buildAcquisitionCarryEvidence(thai,{...ctx,...bad}),null);
      }
      assert.equal(p.selectOlderAcquisitionPurchases([thai,{...thai,OrderWeek:'37-01',Complete:false}],thaiScope).length,0);
    }
  }
  assert.equal(p.selectOlderAcquisitionPurchases(thaiRows,{orderYear:'2026',targetWeek:'37-02'}).length,0);
  for(const change of [{OrderYear:'2025'},{OrderWeek:'27-01'},{Complete:false},{EstUnit:'송이'},{RowCount:2}]) {
    assert.equal(p.buildAcquisitionCarryEvidence({...china,...change},chinaContext),null);
  }
  assert.equal(p.selectOlderAcquisitionPurchases([china,{...china,OrderWeek:'25-01',Complete:false}],chinaScope).length,0);
  for (const change of [{rate:0}, {rate:null}, {rateSource:'approximate_currency_master'}, {arrival:{price:0,unit:'송이',rowCount:2}}, {arrival:{price:1700,unit:'단',rowCount:2}}, {arrival:{price:1700,unit:'송이',rowCount:1}}, {arrival:{price:1700,unit:'송이',rowCount:2,goodsCostMissing:true}}]) {
    assert.equal(p.buildAcquisitionCarryEvidence(row,{...ctx,...change}),null);
  }
  assert.equal(p.resolveAcquisitionCarryFx(undefined,{}),undefined, 'existing freight callers unchanged');
  const loadCalls=[];
  const loadArrival=async(...args)=>{loadCalls.push(args);return {91:{price:2400,unit:'단',rowCount:1}}};
  const purchaseContext={orderYear:'2026',orderWeek:'34-01',country:'태국',currency:'USD',rate:1400,rateSource:'kcs_api'};
  assert.equal((await p.loadPurchasePeriodArrivalEvidence(purchaseContext,loadArrival))[91].price,2400);
  assert.deepEqual(loadCalls[0],['2026','34-01',{reportExchangeRate:{currency:'USD',country:'태국',rate:1400}}]);
  for(const bad of [{rate:0},{rate:null},{rate:Infinity},{rateSource:'currency_master'},{rateSource:null},{orderYear:''},{orderWeek:'34-01B'},{country:null},{currency:null}]) {
    assert.deepEqual(await p.loadPurchasePeriodArrivalEvidence({...purchaseContext,...bad},loadArrival),{});
  }
  assert.equal(loadCalls.length,1,'invalid evidence never calls current-rate freight fallback');
  await p.loadPurchasePeriodArrivalEvidence({...purchaseContext,orderWeek:'1-01'},loadArrival);
  assert.equal(loadCalls[1][1],'01-01','legacy single-digit major is normalized at the freight boundary');
  const fx={currency:'USD',country:'에콰도르',rate:1400};
  assert.equal(p.resolveAcquisitionCarryFx(fx,{currency:'USD',country:'에콰도르'}).rate,1400);
  const eur={currency:'EUR',country:'네덜란드',rate:1754.12};
  assert.equal(p.resolveAcquisitionCarryFx(eur,{currency:'EUR',country:'네덜란드'}).rate,1754.12);
  assert.equal(p.resolveAcquisitionCarryFx(eur,{currency:'USD',country:'에콰도르'}),null,'same week must not share country/currency context');
  for(const c of [{currency:'EUR',country:'에콰도르'},{currency:'USD',country:null},{currency:'USD',country:'중국'}]) assert.equal(p.resolveAcquisitionCarryFx(fx,c),null);
  const s = await import('../lib/profitReportSnapshot.js');
  const map = new Map([['WH:2026:30','a'],['WH:2026:41','future'],['WH:2025:30','prior']]);
  const f = s.composeWeekFingerprint(map,'2026','40',{calcVersion:'test'});
  assert.equal(f.components['WH:2026:30'],'a');
  assert.equal(f.components['WH:2026:41'],undefined);
  assert.equal(f.components['WH:2025:30'],undefined);
  map.set('WH:2026:30','b');
  assert.notEqual(f.hash,s.composeWeekFingerprint(map,'2026','40',{calcVersion:'test'}).hash);
  assert.equal(s.composeWeekFingerprint(map,'2026','01',{calcVersion:'test'}).components['WH:2025:30'],'prior');
  const source=fs.readFileSync('lib/profitReport.js','utf8');
  const section=source.split('async function olderAcquisitionEvidence')[1].split('/** 재고단가 근거 저장')[0];
  assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE)\s/i.test(section));
  assert.ok(section.includes('wm.OrderYear=@yr') && section.includes('sm.OrderYear=@yr'));
  assert.ok(section.includes("IN (N'에콰도르',N'네덜란드',N'호주',N'중국',N'태국')"));
  const fifoSection=source.split('export async function fifoPurchaseLayersByProduct')[1].split('/** FIFO 적용 여부')[0];
  assert(fifoSection.includes("if (row.Category === '태국')"));
  assert(fifoSection.includes('loadPurchasePeriodArrivalEvidence'));
  assert(fifoSection.includes('freightRaw = thaiFreightCache.get(k)?.[prodKey]'));
  assert.ok(section.includes('`${row.OrderWeek}:${row.Category}`'));
  assert.ok(section.includes('currency: currencyCodeForCategory(row.Category), country: row.Category'));
  assert.ok(source.includes('beginOrderYear: String(prevOrderYear)'));
  assert.ok(!source.includes('autoStockUnitPrices(suggestTargets, prevOrderYear, rankOf(beginWeek))'), '판매단가로 기초재고 원가를 자동 채우지 않는다');
  assert.ok(!source.includes('autoStockUnitPrices(suggestTargets, orderYear, rankOf(endWeek))'), '판매단가로 기말재고 원가를 자동 채우지 않는다');
  const {buildProfitReportAudit}=await import('../lib/profitReportAudit.js');
  const issues=buildProfitReportAudit([{category:'에콰도르',auto:{E:170000},beginStock:{priceEvidenceSources:['erp-purchase-carry:synthetic']}}],{orderYear:'2026',major:'40'});
  assert.ok(issues.issues.some(x=>x.code==='OLDER_ACQUISITION_RECONSTRUCTED'&&x.columns[0]==='E'));
  assert.match(issues.issues.find(x=>x.code==='OLDER_ACQUISITION_RECONSTRUCTED').detail.summary,/판매단가가 아니라/);
  const thaiAudit=buildProfitReportAudit([{category:'태국',auto:{F:8000},stock:{priceEvidenceSources:['erp-purchase-carry:synthetic']}}],{orderYear:'2026',major:'41'});
  assert.match(thaiAudit.issues.find(x=>x.code==='THAI_ACQUISITION_COST_BASIS').detail.summary,/실제 청구액 확인 완료를 뜻하지 않/);
  console.log('profitReportAcquisitionCarry: positive/near-miss/cross-year/freshness/side-effect passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
