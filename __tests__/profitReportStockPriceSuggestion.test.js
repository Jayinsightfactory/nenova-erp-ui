const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const calc = await import('../lib/profitReportCalc.js');
  const audit = await import('../lib/profitReportAudit.js');

  const direct = calc.productMasterStockPriceSuggestion({ category: '중국', cost: 14000 });
  assert.ok(direct);
  assert.equal(direct.price, 14000 / 1.1);
  assert.equal(direct.grossCost, 14000);
  assert.equal(direct.basis, 'PRODUCT_MASTER_OUT_PRICE_SUGGESTION_ONLY');

  assert.equal(calc.productMasterStockPriceSuggestion({ category: '호주', cost: 14000 }), null);
  assert.equal(calc.productMasterStockPriceSuggestion({ category: '콜롬비아 장미', cost: 14000 }), null);
  assert.equal(calc.productMasterStockPriceSuggestion({ category: '베트남', cost: 14000 }), null);
  assert.equal(calc.productMasterStockPriceSuggestion({ category: '중국', cost: 0 }), null);

  const directIssues = audit.buildProfitReportAudit([{
    category: '중국', variant: null,
    auto: { N: 1, L: 0, O: 0, Q: 0, S: 0, E: null, F: null },
    manual: {}, source: { E: 'missing_price_evidence', F: 'missing_price_evidence' },
    beginStock: { unitMismatch: true, conversionMissingCount: 0 },
    stock: { endQty: 10, unitMismatch: true, missingPriceCount: 1, conversionMissingCount: 0 },
  }], { major: 28 }).issues;
  assert.ok(directIssues.some(item => item.code === 'STOCK_BEGIN_PRICE_EVIDENCE_MISSING'));
  assert.ok(directIssues.some(item => item.code === 'STOCK_END_PRICE_EVIDENCE_MISSING'));
  assert.ok(!directIssues.some(item => item.code === 'STOCK_BEGIN_UNIT_MIXED'));
  assert.ok(!directIssues.some(item => item.code === 'STOCK_END_UNIT_MIXED'));

  const averageIssues = audit.buildProfitReportAudit([{
    category: '콜롬비아 장미', variant: null,
    auto: { N: 1, L: 0, O: 0, Q: 0, S: 0, E: null, F: null },
    manual: {}, source: { E: 'missing_price_evidence', F: 'missing_price_evidence' },
    beginStock: { unitMismatch: true, conversionMissingCount: 0 },
    stock: { endQty: 10, unitMismatch: true, missingPriceCount: 1, conversionMissingCount: 0 },
  }], { major: 28 }).issues;
  assert.ok(averageIssues.some(item => item.code === 'STOCK_BEGIN_UNIT_MIXED'));
  assert.ok(averageIssues.some(item => item.code === 'STOCK_END_UNIT_MIXED'));

  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  const snapshotBlock = reportSource.slice(
    reportSource.indexOf('export async function stockSnapshotByCategory'),
    reportSource.indexOf('/** 카테고리별 구매 통화'),
  );
  assert.ok(!/SuggestedPrice|productMasterStockPriceSuggestion|p\.Cost/.test(snapshotBlock),
    '출고단가 추천이 E/F 자동 계산으로 유입되면 안 된다.');
  assert.match(reportSource, /SuggestedBasis: productMasterSuggestion\?\.basis/);
  assert.match(pageSource, /출고단가 추천값 일괄 선택/);
  assert.match(pageSource, /priceSuggestionEvidence/);
  assert.match(pageSource, /재고원가가 아닙니다/);

  console.log('profit report stock price suggestion tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
