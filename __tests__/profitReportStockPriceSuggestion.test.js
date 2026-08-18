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

  const australia = calc.distributionMajorityStockPriceSuggestion({
    category: '호주',
    rows: [{ custKey: 1, estQty: 1, grossCost: 11000 }],
  });
  assert.ok(australia, '정확한 품목 원가가 없는 호주 품목도 당차수 확정 분배단가 후보를 보여줘야 한다.');
  assert.equal(australia.grossCost, 11000);
  assert.equal(australia.price, 10000);
  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '콜롬비아 장미', rows: [{ custKey: 1, estQty: 1, grossCost: 11000 }] }), null);
  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '베트남', rows: [{ custKey: 1, estQty: 1, grossCost: 11000 }] }), null);
  assert.equal(calc.distributionMajorityStockPriceSuggestion({ category: '중국', rows: [] }), null);

  const sampleAverage = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 1, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 2, price: 1000, prodName: 'Dendrobium A' },
    { rowKey: 2, scopeKey: '2026:32-02:500', category: '태국', unit: 'BOX', qty: 6, price: 2000, prodName: 'Dendrobium B' },
    { rowKey: 3, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: null, prodName: 'Dendrobium Sample' },
    { rowKey: 4, scopeKey: '2025:32-02:400', category: '태국', unit: '박스', qty: 100, price: 999999, prodName: '다른 연도 품목' },
  ]);
  assert.ok(Math.abs(sampleAverage['3'].price - 1750) < 0.000001, '같은 스냅샷·카테고리·단위 비샘플 단가를 수량가중평균해야 한다.');
  assert.equal(sampleAverage['3'].basis, 'CURRENT_SNAPSHOT_SAMPLE_AVERAGE_SAME_CATEGORY_UNIT');
  assert.equal(sampleAverage['3'].peerCount, 2);

  const sameUnitFallback = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 10, scopeKey: '2026:32-02:500', category: '중국', unit: '단', qty: 3, price: 3000, prodName: 'CHINA A' },
    { rowKey: 11, scopeKey: '2026:32-02:500', category: '에콰도르', unit: 'BUNCH', qty: 1, price: null, displayName: '에콰도르 샘플' },
    { rowKey: 12, scopeKey: '2026:32-02:500', category: '에콰도르', unit: '박스', qty: 10, price: 1, prodName: '단위 다른 품목' },
  ]);
  assert.equal(sameUnitFallback['11'].price, 3000);
  assert.equal(sameUnitFallback['11'].basis, 'CURRENT_SNAPSHOT_SAMPLE_AVERAGE_SAME_UNIT');

  const exactSampleWins = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 20, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: 5000, prodName: 'Thailand SAMPLE' },
    { rowKey: 21, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: 1000, prodName: 'Thailand regular' },
  ]);
  assert.equal(exactSampleWins['20'], undefined, '샘플이라도 정확한 단가 근거가 있으면 평균으로 덮어쓰면 안 된다.');
  assert.deepEqual(calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 30, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: null, prodName: '샘플' },
    { rowKey: 31, scopeKey: '2026:32-02:501', category: '태국', unit: '박스', qty: 1, price: 1000, prodName: '다른 스냅샷' },
  ]), {}, '다른 스냅샷의 단가를 샘플 평균에 섞으면 안 된다.');
  assert.equal(calc.computeAutoEndingStock({
    endQty: 1,
    snapshotConfirmed: true,
    priceEvidenceStatus: 'VERIFIED_SAMPLE_AVERAGE',
    evidenceValue: 3000,
  }), 3000);
  assert.equal(calc.endingStockSourceKind({
    endQty: 1,
    snapshotConfirmed: true,
    priceEvidenceStatus: 'VERIFIED_SAMPLE_AVERAGE',
    evidenceValue: 3000,
  }), 'verified_sample_average');

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
  assert.match(reportSource, /sampleInventoryAveragePriceSuggestions/);
  assert.match(reportSource, /VERIFIED_SAMPLE_AVERAGE/);
  assert.match(reportSource, /AS StockBeginEst/);
  assert.match(reportSource, /AS StockEndEst/);
  assert.match(reportSource, /ConversionStatus === 'VERIFIED' \? item\.row\.StockBeginEst : 0/,
    '샘플 평균의 수량 가중치는 박스·단·송이를 금액단위로 환산한 검증 수량만 사용해야 한다.');
  assert.match(reportSource, /GROUP BY[\s\S]*?p\.SteamOf1Box, p\.BunchOf1Box, p\.SteamOf1Bunch/,
    '재고단가 조회의 환산식에서 사용하는 품목 마스터 필드는 모두 SQL 묶음 기준에 포함되어야 한다.');
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
