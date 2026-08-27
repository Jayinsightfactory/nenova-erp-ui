const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const calc = await import('../lib/profitReportCalc.js');
  const audit = await import('../lib/profitReportAudit.js');

  assert.equal(calc.distributionMajorityStockPriceSuggestion, undefined,
    '판매·분배단가를 재고 매입원가로 추천하는 함수가 남아 있으면 안 된다.');

  const sampleAverage = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 1, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 2, price: 1000, priceSource: 'VERIFIED_EXACT', prodName: 'Dendrobium A' },
    { rowKey: 2, scopeKey: '2026:32-02:500', category: '태국', unit: 'BOX', qty: 6, price: 2000, priceSource: 'VERIFIED_ARRIVAL_COST', prodName: 'Dendrobium B' },
    { rowKey: 3, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: null, prodName: 'Dendrobium Sample' },
    { rowKey: 4, scopeKey: '2025:32-02:400', category: '태국', unit: '박스', qty: 100, price: 999999, priceSource: 'VERIFIED_EXACT', prodName: '다른 연도 품목' },
  ]);
  assert.ok(Math.abs(sampleAverage['3'].price - 1750) < 0.000001);
  assert.equal(sampleAverage['3'].basis, 'CURRENT_SNAPSHOT_SAMPLE_AVERAGE_SAME_CATEGORY_UNIT');
  assert.deepEqual(sampleAverage['3'].peerSources.sort(), ['VERIFIED_ARRIVAL_COST', 'VERIFIED_EXACT']);

  const salesPriceMustBeIgnored = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 10, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 100, price: 90000, priceSource: 'CONFIRMED_DISTRIBUTION', prodName: '판매단가 품목' },
    { rowKey: 11, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: 1000, priceSource: 'VERIFIED_WORKBOOK_CATALOG', prodName: '검증 매입원가 품목' },
    { rowKey: 12, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: null, prodName: '태국 샘플' },
  ]);
  assert.equal(salesPriceMustBeIgnored['12'].price, 1000, '판매·분배단가는 샘플 재고원가 평균에서 제외해야 한다.');

  const unverifiedMustBeIgnored = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 20, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: 5000, priceSource: '', prodName: '근거 없음' },
    { rowKey: 21, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: null, prodName: '샘플' },
  ]);
  assert.deepEqual(unverifiedMustBeIgnored, {});

  const sameUnitFallback = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 30, scopeKey: '2026:32-02:500', category: '중국', unit: '단', qty: 3, price: 3000, priceSource: 'VERIFIED_EVIDENCE', prodName: 'CHINA A' },
    { rowKey: 31, scopeKey: '2026:32-02:500', category: '에콰도르', unit: 'BUNCH', qty: 1, price: null, displayName: '에콰도르 샘플' },
  ]);
  assert.equal(sameUnitFallback['31'].price, 3000);
  assert.equal(sameUnitFallback['31'].basis, 'CURRENT_SNAPSHOT_SAMPLE_AVERAGE_SAME_UNIT');

  const exactSampleWins = calc.sampleInventoryAveragePriceSuggestions([
    { rowKey: 40, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: 5000, priceSource: 'VERIFIED_EXACT', prodName: 'Thailand SAMPLE' },
    { rowKey: 41, scopeKey: '2026:32-02:500', category: '태국', unit: '박스', qty: 1, price: 1000, priceSource: 'VERIFIED_EXACT', prodName: 'Thailand regular' },
  ]);
  assert.equal(exactSampleWins['40'], undefined);

  const carried = calc.selectCarriedAcquisitionPriceEvidence({
    targetYear: '2026',
    targetWeek: '33-02',
    products: [
      { prodKey: 100, unit: '박스' },
      { prodKey: 200, unit: '단' },
      { prodKey: 300, unit: '박스' },
    ],
    candidates: [
      { orderYear: '2026', orderWeek: '32-02', prodKey: 100, unit: 'BOX', price: 5000, source: 'VERIFIED_EVIDENCE', sourceRef: 'invoice:A' },
      { orderYear: '2026', orderWeek: '31-02', prodKey: 100, unit: '박스', price: 4000, source: 'VERIFIED_ARRIVAL_COST', sourceRef: 'arrival:A' },
      { orderYear: '2026', orderWeek: '32-02', prodKey: 200, unit: '박스', price: 6000, source: 'VERIFIED_EVIDENCE', sourceRef: 'wrong-unit' },
      { orderYear: '2025', orderWeek: '32-02', prodKey: 300, unit: '박스', price: 7000, source: 'VERIFIED_EVIDENCE', sourceRef: 'wrong-year' },
      { orderYear: '2026', orderWeek: '32-02', prodKey: 300, unit: '박스', price: 99000, source: 'CONFIRMED_DISTRIBUTION', sourceRef: 'sales-price' },
    ],
    purchases: [],
  });
  assert.equal(carried['100'].price, 5000, '같은 연도·품목·단위의 가장 최근 VERIFIED 매입원가를 이어 써야 한다.');
  assert.equal(carried['100'].source, 'VERIFIED_CARRIED_ACQUISITION');
  assert.equal(carried['200'], undefined, '단위가 다른 단가는 이어 쓰면 안 된다.');
  assert.equal(carried['300'], undefined, '다른 연도·판매단가는 이어 쓰면 안 된다.');

  const laterPurchaseBlocksCarry = calc.selectCarriedAcquisitionPriceEvidence({
    targetYear: '2026', targetWeek: '33-02', products: [{ prodKey: 100, unit: '박스' }],
    candidates: [{ orderYear: '2026', orderWeek: '32-02', prodKey: 100, unit: '박스', price: 5000, source: 'VERIFIED_EVIDENCE' }],
    purchases: [{ OrderYear: '2026', OrderWeek: '33-01', ProdKey: 100 }],
  });
  assert.equal(laterPurchaseBlocksCarry['100'], undefined, '근거 이후 새 매입이 있으면 새 매입원가가 필요하다.');

  assert.equal(calc.computeAutoEndingStock({
    endQty: 1, snapshotConfirmed: true,
    priceEvidenceStatus: 'VERIFIED_SAMPLE_AVERAGE', evidenceValue: 3000,
  }), 3000);

  const directIssues = audit.buildProfitReportAudit([{
    category: '중국', variant: null,
    auto: { N: 1, L: 0, O: 0, Q: 0, S: 0, E: null, F: null },
    manual: {}, source: { E: 'missing_price_evidence', F: 'missing_price_evidence' },
    beginStock: {
      unitMismatch: true,
      conversionMissingCount: 0,
      missingPriceItems: [{ prodKey: 9999, prodName: '', displayName: '' }],
    },
    stock: {
      endQty: 10, unitMismatch: true, missingPriceCount: 1, conversionMissingCount: 0,
      missingPriceItems: [
        { prodKey: 9999, prodName: '', displayName: '' },
        { prodKey: 123, prodName: 'CHINA / Limonium Sinensis white 500g', displayName: '' },
      ],
    },
  }], { major: 28 }).issues;
  assert.ok(directIssues.some(item => item.code === 'STOCK_BEGIN_PRICE_EVIDENCE_MISSING'));
  assert.ok(directIssues.some(item => item.code === 'STOCK_END_PRICE_EVIDENCE_MISSING'));
  assert.ok(directIssues.some(item => item.code === 'STOCK_BEGIN_PRICE_EVIDENCE_MISSING' && /품목번호 9999/.test(item.message) && !/시네신스/.test(item.message)));
  assert.ok(directIssues.some(item => item.code === 'STOCK_END_PRICE_EVIDENCE_MISSING'
    && /품목번호 9999/.test(item.message)
    && /CHINA \/ Limonium Sinensis white 500g\(123\)/.test(item.message)
    && !/시네신스\(2158\)/.test(item.message)));

  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const calcSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCalc.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  const inventoryBlock = reportSource.slice(
    reportSource.indexOf('export async function stockPriceRows'),
    reportSource.indexOf('/** 카테고리별 구매 통화'),
  );
  // 2026-08-27 정책 갱신(사장님 지시): 판매단가 자동제안 도입 — 26~31차 백테스트에서 확정 엑셀
  // 대비 오차율이 판매단가 7.3% vs 매입원가환산 45.2%로 검증됨. 단, 과거 제거된 분배단가 자동
  // 반영(loadConfirmedCustomerProductPrices/confirmedDistribution 등)은 계속 금지하고, 제안은
  // RequiresInput 행에만 붙는 표시 전용 값으로 beginPrice/endPrice 확정 로직에는 개입하지 않는다
  // (저장 시 사용자 확인 근거로만 계산에 들어간다).
  assert.ok(!/loadConfirmedCustomerProductPrices|confirmedDistribution|SuggestionCandidates/.test(inventoryBlock));
  assert.match(inventoryBlock, /SuggestedPrice/);
  assert.match(inventoryBlock, /if \(!row\.RequiresInput\) continue;/);
  const suggestionMarker = inventoryBlock.indexOf('판매단가 자동평가·제안');
  assert.ok(suggestionMarker > 0);
  assert.ok(!/SuggestedPrice/.test(inventoryBlock.slice(0, suggestionMarker)));
  assert.ok(!/distributionMajorityStockPriceSuggestion/.test(calcSource));
  assert.match(reportSource, /RequiresInput: requiresInput/);
  assert.match(reportSource, /CATEGORY_AVERAGE_INVENTORY_KEYS\.includes/);
  assert.match(reportSource, /carriedAcquisitionPriceEvidenceByProduct/);
  assert.match(reportSource, /VERIFIED_CARRIED_ACQUISITION/);
  assert.match(pageSource, /row\.BeginRequiresInput/);
  assert.match(pageSource, /row\.EndRequiresInput/);
  assert.match(pageSource, /priceInputRows\.map/);
  assert.match(pageSource, /ScopeLabel: '기초'/);
  assert.match(pageSource, /ScopeLabel: '기말'/);
  assert.match(pageSource, /week: String\(batch\.orderWeek/);
  assert.match(pageSource, /자동완성·검증 완료 품목/);
  assert.ok(!/분배단가 후보|다수업체 기준 단가|SuggestionCandidates|priceSuggestionEvidence/.test(pageSource));
  assert.ok(!/key: 'H'.*editable: true/.test(pageSource));
  assert.ok(!/key: 'S'.*editable: true/.test(pageSource));
  // 2026-08-26 조정열(AC/AJ) 추가로 렌더 조건이 삼항으로 변경 — R 입력칸 노출 조건은 동일.
  assert.match(pageSource, /cd\.key === 'R' \? needsRateInput\(row\)/);
  assert.match(reportSource, /AS StockBeginEst/);
  assert.match(reportSource, /AS StockEndEst/);

  console.log('profit report acquisition-cost input boundary tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
