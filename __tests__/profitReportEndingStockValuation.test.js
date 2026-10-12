// 기말상품재고액(F)/기초상품재고액(E) 평가 규칙 회귀 테스트 — 2026-08-12 업무규칙 확정.
//
//   F = Σ(마지막 확정 세부차수 ProductStock 수량 × 품목별 재고평가단가) ÷ 1.1
//   E = 전차수 마지막 확정 F (확정 스냅샷 > 전차수 수기 F > 전차수 자동계산)
//       27차의 전차수는 같은 연도의 26차이며, 01차에서만 전년도 52차로 넘어간다.
//
// 이전 구현은 "(구매금액×환율 + 포워딩×환율 + 그외통관비) ÷ 매입총수량 × 기말수량"이라는
// 착륙원가 평균단가를 1순위로 썼다. 이 식은 원본 워크북 어느 시트에도 없고 27차 F 오차를
// 41.6%까지 벌렸다. 이 테스트는 그 공식이 되살아나지 않도록 고정한다.
//
// 실행: node __tests__/profitReportEndingStockValuation.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { computeAutoEndingStock } = await import('../lib/profitReportCalc.js');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');
  const workbook = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27-full.json'), 'utf8'),
  );

  console.log('=== 원본 재고잔량 시트 공식: Σ(수량×평가단가) ÷ 1.1 ===');
  // 원본 재고잔량 시트는 품목마다 `수량 × 가격`을 세로 합산하고(O24=SUM(O7:O23))
  // 그룹 합계를 공급가로 환산한다(O25=O24/1.1). 서버는 이 값을 stock.tableF로 넘겨준다.
  const tableF = 13229405.2035;
  check('평가단가 원천(tableF)이 있으면 그 값을 그대로 F로 사용',
    computeAutoEndingStock({ endQty: 1200, tableF, recentCost: 99999 }, { R: 1068.23 }) === tableF);

  console.log('\n=== 착륙원가 평균단가(구매+포워딩+통관비 ÷ 매입수량) 공식은 되살아나면 안 된다 ===');
  const landedTrap = computeAutoEndingStock(
    { endQty: 40, purchQty: 100, tableF, recentCost: 500, unitMismatch: false },
    { Q: 16667.5, S: 1000, H: 608410, R: 1068.23 },
  );
  check('purchQty/Q/S/H가 모두 주어져도 F는 재고평가단가(tableF) 그대로', landedTrap === tableF,
    `계산=${landedTrap}`);
  const calcSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCalc.js'), 'utf8');
  check('computeAutoEndingStock에 landedWon(착륙원가 평균단가) 계산이 남아 있지 않음',
    !/landedWon/.test(calcSource));
  check('purchQty 비율 분기가 남아 있지 않음', !/purchQty > 0 && landedWon/.test(calcSource));

  console.log('\n=== 평가단가 원천이 아예 없을 때만 최근 매입단가×환율 fallback ===');
  const R = 1068.23;
  const recentCost = 7343.42;
  check('tableF가 없으면 recentCost×R',
    Math.abs(computeAutoEndingStock({ endQty: 500, tableF: null, recentCost }, { R }) - recentCost * R) < 0.01);
  check('tableF가 0(평가액 0)이어도 recentCost가 있으면 fallback',
    Math.abs(computeAutoEndingStock({ endQty: 500, tableF: 0, recentCost }, { R }) - recentCost * R) < 0.01);
  check('둘 다 없으면 null(원천 누락) — 값을 추정해 채우지 않음',
    computeAutoEndingStock({ endQty: 500, tableF: null, recentCost: 0 }, { R }) == null);
  check('기말수량이 0이면 F 자동계산 자체를 하지 않음',
    computeAutoEndingStock({ endQty: 0, tableF }, { R }) === null);

  console.log('\n=== 평가단가 원천 누락은 audit이 명시 ===');
  const baseRow = (stock, overrides = {}) => ({
    category: '호주', currency: 'AUD', variant: 'normal',
    auto: { N: 100, L: 0, O: 0, Q: 10, S: 0, H: 0, E: 0, F: 0, R: 1000 },
    manual: {},
    stock: { negativeQty: 0, recentCostMissingQty: 0, ...stock },
    source: { E: 'auto_exe_stock_view', F: 'auto_exe_stock_view', H: 'missing', R: 'missing', S: 'missing' },
    ...overrides,
  });
  const missingPrice = buildProfitReportAudit([baseRow({ endQty: 500, tableF: 0, recentCost: 0 })], { major: 27 });
  check('수량은 있는데 평가단가가 전혀 없으면 STOCK_VALUATION_PRICE_MISSING(error)',
    missingPrice.issues.some((i) => i.code === 'STOCK_VALUATION_PRICE_MISSING' && i.severity === 'error'));
  check('그 카테고리는 needs_input 상태', missingPrice.status === 'needs_input');

  const gapRow = buildProfitReportAudit(
    [baseRow({ endQty: 500, tableF: 0, recentCost: 1000, recentCostMissingQty: 120 })], { major: 27 },
  );
  check('fallback 경로에서 단가를 못 찾은 수량이 있으면 RECENT_COST_MISSING_ITEMS(error)',
    gapRow.issues.some((i) => i.code === 'RECENT_COST_MISSING_ITEMS' && i.severity === 'error'));
  const noGap = buildProfitReportAudit(
    [baseRow({ endQty: 500, tableF: 1234567, recentCost: 0, recentCostMissingQty: 120 })], { major: 27 },
  );
  check('평가단가로 정상 계산되면(tableF>0) fallback 갭 경고를 내지 않음',
    !noGap.issues.some((i) => i.code === 'RECENT_COST_MISSING_ITEMS'));
  const manualF = buildProfitReportAudit(
    [baseRow({ endQty: 500, tableF: 0, recentCost: 0 }, { manual: { F: 9999999 } })], { major: 27 },
  );
  check('F를 수기 저장했으면 자동계산 원천 경고를 내지 않음',
    !manualF.issues.some((i) => i.code === 'STOCK_VALUATION_PRICE_MISSING'));

  console.log('\n=== 재고잔량 시트 전체합을 그대로 복사하지 않는다 ===');
  // 원본 27차 재고잔량 시트에는 수동 정정·오입력(예: 카네이션 기말단가 110,000 = 기초 11,000의 10배)이
  // 남아 있어 시트 총합과 본표 F 합계가 일치하지 않는다. 본표 F는 카테고리별로 따로 입력된 값이다.
  const week27 = workbook.weeks['27'];
  const mainFSum = week27.main.categories.reduce((sum, c) => sum + (Number(c.cells.F.value) || 0), 0);
  check('본표 F 합계와 재고잔량 시트 총합계(공급가)가 서로 다름 — 시트 합계 복사 금지 근거',
    week27.stockSheet == null || Math.abs(mainFSum - Number(week27.stockSheet.endTotalSupply || 0)) > 1,
    `본표F합=${mainFSum} 시트합=${week27.stockSheet?.endTotalSupply}`);
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  check('F 평가액은 품목별 ProductStock × 적용단가 ÷ 1.1 SQL로 집계',
    /SUM\(ps\.Stock \* \(\$\{STOCK_TO_EST_UNIT_EXPR\}\) \* \(\$\{APPLIED_PRICE_EXPR\}\) \/ 1\.1\) AS v/.test(reportSource));

  console.log('\n=== E 이월: 같은 연도 전차수 마지막 확정 F, 01차만 전년 52차 ===');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('01차만 전년도 52차로 넘어감',
    /currentMajor <= 1 \? String\(Number\(orderYear\) - 1\) : String\(orderYear\)/.test(apiSource)
    && /currentMajor <= 1 \? '52' : String\(currentMajor - 1\)/.test(apiSource));
  check('E 1순위는 전차수 활성 확정 스냅샷 F', /prevConfirmFValue != null \? prevConfirmFValue : prevMan\.F/.test(apiSource));
  check('E source가 확정 스냅샷/수기이월/자동을 구분해 표시',
    /prior_confirmed_snapshot/.test(apiSource) && /inherited_manual/.test(apiSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
