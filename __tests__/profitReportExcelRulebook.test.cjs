const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixture = require('../data/profit-report-evidence/formula-rulebook-26-31.json');
(async () => {
  const policy = await import('../lib/profitReportExcelRulebook.mjs');
  const { selectReportInventoryValuation: select } = await import('../lib/profitReportValuation.mjs');
  const { computeProfitRow, computeProfitTotals, computeCategoryAverageInventoryValue } = await import('../lib/profitReportCalc.js');
  let checks = 0;
  for (const book of fixture.workbooks) {
    assert.match(book.sha256, /^[a-f0-9]{64}$/);
    for (const row of book.rows) {
      const noEnding = ['이스라엘','뉴질랜드','일본'].includes(row.category);
      const expected = noEnding ? policy.PROFIT_EXCEL_BASELINE.noEnding : policy.PROFIT_EXCEL_BASELINE.normal;
      assert.equal(row.formulas.I, expected.I);
      assert.equal(row.formulas.K.replace('(J/C)','J/C').replace('(J/(C+F))','J/(C+F)'), `IFERROR(${expected.K},"")`);
      assert.equal(row.formulas.J.replace(/[+-]\d+$/, ''), expected.J.replace('+AJ',''));
      // Synthetic amounts; no customer or business figures committed.
      const calc = computeProfitRow({category:row.category,variant:noEnding?'noEnding':undefined,
        auto:{N:10000,L:-100,O:200,Q:20,R:100,S:3,H:400,E:1000,F:600},manual:{AJ:book.week===30?-50:book.week===31?50:0}});
      assert.equal(calc.I, noEnding?3700:3100);
      assert.equal(calc.J, (noEnding?7000:7000)+(book.week===30?-50:book.week===31?50:0));
      assert.equal(calc.K, calc.J/(noEnding?10700:10100));
      const totals=computeProfitTotals([{category:row.category,calc}]);
      assert.equal(totals.K,totals.J/(totals.C+totals.F));
      checks += 7;
      if (row.inventoryFormula) {
        assert.match(row.inventoryFormula,/SUMIF\(구매현황!N:N/);
        const value=computeCategoryAverageInventoryValue({category:row.category,purchaseForeign:20,forwardingForeign:3,taxableRate:100,customsCost:400,purchaseQty:100,stockQty:10});
        assert.equal(value.value,270);
      }
    }
  }
  assert.deepEqual(fixture.workbooks.map(x=>x.week),[26,27,28,29,30,31]);
  for(const year of ['2025','2026']) {
    const input={year,major:'31',week:'31-02'};
    assert.equal(select({...input,historical:{value:999,status:'VERIFIED_HISTORICAL_WORKBOOK'}}),null);
    assert.equal(select({...input,averageFallback:{value:999}}),null);
    assert.equal(select({...input,carried:{value:999,sourceWeek:`${year}:30`}}),null);
    assert.equal(select({...input,direct:999,directStatus:'VERIFIED_SALES_PRICE_AUTO'}),null);
    assert.equal(select({...input,direct:999,directStatus:'VERIFIED',directSources:['판매단가 기준 재고평가']}),null);
    assert.equal(select({...input,direct:0,directStatus:'VERIFIED',directSources:['invoice:exact']} ).value,0);
    assert(select({...input,average:{value:1}}).sources[0].includes(year));
  }
  assert.equal(select({year:null,major:'31',average:{value:1}}),null);
  assert.equal(policy.acquisitionEvidencePrice(100,'판매단가 기준 재고평가'),null);
  assert.equal(policy.acquisitionEvidencePrice(100,'판매단가 아님; 인보이스 매입원가'),100);
  assert.equal(policy.acquisitionEvidencePrice(100,null),null);
  assert.equal(policy.acquisitionEvidencePrice(Infinity,'invoice'),null);
  const purchase={OrderYear:'2026',OrderWeek:'26-01',Category:'호주',ProdKey:1,EstUnit:'단',Quantity:100,ForeignTotal:700,Complete:true};
  const context={orderYear:'2026',targetWeek:'31-02',rate:1000,rateSource:'exact_purchase_period',hShare:50,purchaseUnit:'단'};
  assert.equal(policy.buildAustraliaPurchaseEvidence(purchase,context).price,7050);
  for(const patch of [{OrderYear:'2025'},{OrderWeek:'32-01'},{Category:'태국'},{Complete:false},{Quantity:0},{ForeignTotal:0},{EstUnit:'unknown'}]) {
    assert.equal(policy.buildAustraliaPurchaseEvidence({...purchase,...patch},context),null);
  }
  for(const patch of [{rate:0},{rateSource:'approximate_currency_master'},{hShare:null},{hShare:-1},{targetWeek:'bad'},{purchaseUnit:'박스'},{purchaseUnit:null}]) {
    assert.equal(policy.buildAustraliaPurchaseEvidence(purchase,{...context,...patch}),null);
  }
  const {buildProfitReportAudit}=await import('../lib/profitReportAudit.js');
  const audit=buildProfitReportAudit([{category:'일본',variant:'noEnding',auto:{N:100,E:null,F:null},manual:{},source:{E:'missing_price_evidence',F:'missing_price_evidence'},stock:{endQty:1},beginStock:{qty:1}}],{orderYear:'2026',major:'31'});
  assert.equal(audit.issues.filter(x=>x.code==='STOCK_PRICE_EVIDENCE_MISSING_NO_ENDING').length,2);
  const source=fs.readFileSync('lib/profitReport.js','utf8');
  const api=fs.readFileSync('pages/api/sales/profit-report.js','utf8');
  const snapshot=source.slice(source.indexOf('export async function stockSnapshotByCategory'),source.indexOf('/** 카테고리별 구매 통화'));
  const prices=source.slice(source.indexOf('export async function stockPriceRows'),source.indexOf('export async function autoStockUnitPrices'));
  assert(snapshot.includes('spe.SourceRef AS VerifiedSourceRef'));
  assert(snapshot.includes('acquisitionEvidencePrice(row.VerifiedPrice, row.VerifiedSourceRef)'));
  assert(prices.includes('acquisitionEvidencePrice(row.BeginPrice, row.BeginEvidenceSourceRef)'));
  assert(prices.includes('acquisitionEvidencePrice(row.SetPrice, row.EndEvidenceSourceRef)'));
  assert(source.includes('.filter((row) => isAcquisitionCostSource(row.SourceRef))'));
  assert(!snapshot.includes('resolveAutoStockPrice('));assert(!prices.includes('resolveAutoStockPrice('));
  assert(!api.includes('anyCategory: true'));assert(!api.includes('getHistoricalClosingInventoryEvidence'));
  assert(source.includes('allowApproximate = false'));
  for(const block of [snapshot,prices]) assert(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\s/i.test(block));
  console.log(`profitReportExcelRulebook: ${checks} source-formula/synthetic checks, year and read-only policy passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
