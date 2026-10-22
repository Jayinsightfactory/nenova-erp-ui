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
  for (const change of [{Category:'호주'}, {Quantity:0}, {ForeignTotal:0}, {Complete:false}, {OrderWeek:'30-01B'}]) {
    assert.equal(p.selectOlderAcquisitionPurchases([{...row,...change}], scope).length, 0);
  }
  const ctx = {...scope,rate:1400,rateSource:'kcs_api',arrival:{price:1700,unit:'송이',rowCount:2}};
  assert.equal(p.buildAcquisitionCarryEvidence(row,ctx).price,1700);
  assert.equal(p.buildAcquisitionCarryEvidence(dutch,{...ctx,...dutchScope}).price,1700);
  for (const change of [{rate:0}, {rate:null}, {rateSource:'approximate_currency_master'}, {arrival:{price:0,unit:'송이',rowCount:2}}, {arrival:{price:1700,unit:'단',rowCount:2}}, {arrival:{price:1700,unit:'송이',rowCount:1}}, {arrival:{price:1700,unit:'송이',rowCount:2,goodsCostMissing:true}}]) {
    assert.equal(p.buildAcquisitionCarryEvidence(row,{...ctx,...change}),null);
  }
  assert.equal(p.resolveAcquisitionCarryFx(undefined,{}),undefined, 'existing freight callers unchanged');
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
  assert.ok(section.includes("IN (N'에콰도르',N'네덜란드')"));
  assert.ok(section.includes('`${row.OrderWeek}:${row.Category}`'));
  assert.ok(section.includes('currency: currencyCodeForCategory(row.Category), country: row.Category'));
  assert.ok(source.includes('beginOrderYear: String(prevOrderYear)'));
  assert.ok(source.includes('autoStockUnitPrices(suggestTargets, prevOrderYear, rankOf(beginWeek))'));
  assert.ok(source.includes('autoStockUnitPrices(suggestTargets, orderYear, rankOf(endWeek))'));
  const {buildProfitReportAudit}=await import('../lib/profitReportAudit.js');
  const issues=buildProfitReportAudit([{category:'에콰도르',auto:{E:170000},beginStock:{priceEvidenceSources:['erp-purchase-carry:synthetic']}}],{orderYear:'2026',major:'40'});
  assert.ok(issues.issues.some(x=>x.code==='OLDER_ACQUISITION_RECONSTRUCTED'&&x.columns[0]==='E'));
  assert.match(issues.issues.find(x=>x.code==='OLDER_ACQUISITION_RECONSTRUCTED').detail.summary,/판매단가가 아니라/);
  console.log('profitReportAcquisitionCarry: positive/near-miss/cross-year/freshness/side-effect passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
