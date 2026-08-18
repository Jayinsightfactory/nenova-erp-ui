const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const calc = await import('../lib/profitReportCalc.js');
  const audit = await import('../lib/profitReportAudit.js');

  const direct = calc.distributionMajorityStockPriceSuggestion({
    category: '중국',
    rows: [
      { custKey: 1, estQty: 10, grossCost: 11000, distributionCount: 1 },
      { custKey: 2, estQty: 10, grossCost: 11000, distributionCount: 1 },
      { custKey: 3, estQty: 100, grossCost: 13200, distributionCount: 1 },
    ],
  });
  assert.ok(direct);
  assert.ok(Math.abs(direct.price - 10000) < 0.000001);
  assert.equal(direct.grossCost, 11000);
  assert.equal(direct.customerCount, 2);
  assert.equal(direct.totalEstQuantity, 20);
  assert.equal(direct.candidates.length, 2);
  assert.deepEqual(direct.candidates.map((row) => row.grossCost), [11000, 13200]);
  assert.equal(direct.basis, 'CURRENT_WEEK_CONFIRMED_DISTRIBUTION_MAJORITY_CUSTOMER_PRICE');

  const quantityTieBreak = calc.distributionMajorityStockPriceSuggestion({
    category: '중국',
    rows: [
      { custKey: 1, estQty: 5, grossCost: 11000 },
      { custKey: 2, estQty: 5, grossCost: 11000 },
      { custKey: 3, estQty: 20, grossCost: 13200 },
      { custKey: 4, estQty: 20, grossCost: 13200 },
    ],
  });
  assert.equal(quantityTieBreak.grossCost, 13200, '업체 수가 같을 때만 기준수량 합계로 순위를 정해야 한다.');

  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '호주', rows: [{ custKey: 1, estQty: 1, grossCost: 11000 }] }), null);
  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '콜롬비아 장미', rows: [{ custKey: 1, estQty: 1, grossCost: 11000 }] }), null);
  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '베트남', rows: [{ custKey: 1, estQty: 1, grossCost: 11000 }] }), null);
  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '중국', rows: [] }), null);

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
  const customerMixSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCustomerMixSql.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  const snapshotBlock = reportSource.slice(
    reportSource.indexOf('export async function stockSnapshotByCategory'),
    reportSource.indexOf('/** 카테고리별 구매 통화'),
  );
  assert.ok(!/SuggestedPrice|distributionMajorityStockPriceSuggestion|p\.Cost/.test(snapshotBlock),
    '분배단가 후보가 E/F 자동 계산으로 유입되면 안 된다.');
  assert.match(reportSource, /loadConfirmedCustomerProductPrices\(orderYear, major/);
  assert.match(reportSource, /SuggestedBasis: distributionSuggestion\?\.basis/);
  assert.match(reportSource, /confirmed-distribution:\$\{orderYear\}:\$\{major\}:prod/);
  assert.match(pageSource, /다수업체 기준 단가 일괄 선택/);
  assert.match(pageSource, /priceSuggestionEvidence/);
  assert.match(pageSource, /평균값을 새로 만들지 않습니다/);
  assert.match(pageSource, /SuggestionCandidates/);
  assert.match(customerMixSource, /GROUP BY sm\.CustKey, sd\.ProdKey, sd\.Cost/);
  assert.match(customerMixSource, /ISNULL\(sm\.OrderYear,''\)=@yr/);
  assert.match(customerMixSource, /ISNULL\(sm\.OrderYearWeek,''\)=@yw/);
  assert.match(customerMixSource, /ISNULL\(sm\.isFix,0\)=1/);
  assert.match(customerMixSource, /ISNULL\(sd\.isFix,0\)=1/);
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER)\b/i.test(
    customerMixSource.slice(customerMixSource.indexOf('export async function loadConfirmedCustomerProductPrices')),
  ), '분배단가 후보 조회는 ERP/Web 원장을 변경하면 안 된다.');

  console.log('profit report stock price suggestion tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
