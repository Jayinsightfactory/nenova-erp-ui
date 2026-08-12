// 2026-08-11 결함수정 6: 카테고리 안에 매입단위(박스)와 재고단위(단/송이)가 섞이면
// F열 1순위 공식(category 평균단가 = 매입총액÷매입총수량×기말수량)이 서로 다른 물리단위를
// 그대로 합산·나눗셈하는 것이라 무효다. 27차 호주가 실측 사례다 — fixture 실측값
// (__tests__/fixtures/profit-report-22-27.json weeks.27 호주행) F=7,843,425.3635, R=1068.23는
// 품목별 최근 매입 외화단가×품목별 기말수량 합계(recentCost, 이미 품목별로 집계됨)에 AUD
// 환율만 곱한 값과 정확히 일치해야 한다. lib/profitReportCalc.js computeAutoEndingStock의
// unitMismatch 플래그가 이 fallback을 강제하는지, 다른(단위 일관) 카테고리는 기존 1순위
// 공식이 그대로 유지되는지(회귀 없음) 검증한다.
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
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8')
  );
  const week27 = fixture.weeks['27'];
  const aus = week27.categories.find((c) => c.category === '호주');
  const F = aus.cells.F.value;   // 7,843,425.3635
  const R = aus.cells.R.value;   // 1068.23
  const Q = aus.cells.Q.value;   // 16,667.5 (외화 구매금액)
  const H = aus.cells.H.value;   // 608,410 (그외통관비)

  console.log('=== 27차 호주 실측값 로딩 ===');
  check('fixture에서 호주 F/R/Q/H 값을 읽음', F > 0 && R > 0 && Q > 0 && H >= 0,
    `F=${F} R=${R} Q=${Q} H=${H}`);

  console.log('\n=== 2026-08-12 원천 정정: F 1순위는 재고평가단가(tableF) — unitMismatch와 무관 ===');
  // 이전(2026-08-11)에는 "매입총액÷매입총수량×기말수량"(landed-cost 평균단가)가 1순위였고,
  // unitMismatch 플래그가 그 1순위 공식을 건너뛰게 하는 역할이었다. 사용자가 재확정한 업무
  // 규칙에 따라 F 1순위는 이제 재고평가단가(tableF = 품목별 ProductStock × 적용단가 ÷1.1의
  // 카테고리 합)다 — 이 값은 품목 단위로 이미 집계된 결과라 카테고리 안에 단위가 섞여 있어도
  // (unitMismatch) 문제가 없다. unitMismatch는 이제 3순위(landed-cost 평균, 아래 별도 검증)에서만
  // 의미를 가진다.
  const tableFOnly = computeAutoEndingStock(
    { purchQty: 999, endQty: 500, recentCost: 123, tableF: 456789, unitMismatch: true },
    { Q, S: 0, H, R },
  );
  check('tableF가 있으면 unitMismatch=true여도 tableF를 그대로 사용(1순위)',
    tableFOnly === 456789, `계산=${tableFOnly}`);
  const tableFNoMismatch = computeAutoEndingStock(
    { purchQty: 100, endQty: 40, recentCost: 999, tableF: 456789, unitMismatch: false },
    { Q, S: 0, H, R },
  );
  check('unitMismatch=false여도 tableF가 있으면 항상 tableF(2/3순위 공식으로 대체되지 않음)',
    tableFNoMismatch === 456789);

  console.log('\n=== 2순위(recentCost) — tableF가 없을 때만 사용, unitMismatch와 무관 ===');
  // 2026-08-11 결함수정 9(테스트 한계 명시, 여전히 유효): 이 fixture는 카테고리 합계 셀(F/R/Q/H)만
  // 담고 있어 품목별 원본 행은 없다. recentCost = F/R은 "2순위 공식이 산술적으로 F를 재현하는지"만
  // 검증하는 역산이며, 운영 DB에서 실제로 이 값이 나오는지는 이 테스트가 증명하지 못한다.
  const recentCost = F / R;
  const recentCostResult = computeAutoEndingStock(
    { purchQty: 999, endQty: 500, recentCost, tableF: null, unitMismatch: true },
    { Q, S: 0, H, R },
  );
  check('tableF가 없고 recentCost가 있으면 unitMismatch=true여도 recentCost×R 사용',
    Math.abs(recentCostResult - F) < 0.01, `계산=${recentCostResult} 기대=${F}`);
  const recentCostResultNoMismatch = computeAutoEndingStock(
    { purchQty: 999, endQty: 500, recentCost, tableF: null, unitMismatch: false },
    { Q, S: 0, H, R },
  );
  check('unitMismatch=false여도 tableF가 없으면 recentCost×R을 그대로 사용(회귀 없음)',
    Math.abs(recentCostResultNoMismatch - F) < 0.01);

  console.log('\n=== 3순위(landed-cost 평균) — tableF·recentCost가 모두 없을 때만, unitMismatch가 이 단계를 건너뜀 ===');
  const normalStock = { purchQty: 100, endQty: 40, recentCost: 0, tableF: null };
  const expectedTier3 = ((Q * R + 0 * R + H) / 100) * 40;
  const normalResult = computeAutoEndingStock(normalStock, { Q, S: 0, H, R });
  check('tableF·recentCost가 없으면 3순위(매입총액÷매입총수량×기말수량) 공식을 사용',
    Math.abs(normalResult - expectedTier3) < 0.01,
    `계산=${normalResult} 기대=${expectedTier3}`);
  const mismatchTier3 = computeAutoEndingStock({ ...normalStock, unitMismatch: true }, { Q, S: 0, H, R });
  check('unitMismatch=true면 3순위 공식을 건너뛰고 null(원천 없음) 반환', mismatchTier3 === null);

  console.log('\n=== purchQty=0(매입 없는 차수)이면 unitMismatch 여부와 무관하게 2순위로 자연히 넘어감(기존 동작) ===');
  const noPurchase = computeAutoEndingStock(
    { purchQty: 0, endQty: 40, recentCost, tableF: null, unitMismatch: false },
    { Q: 0, S: 0, H: 0, R }
  );
  check('매입이 없으면 unitMismatch:false여도 recentCost×R 사용', Math.abs(noPurchase - recentCost * R) < 0.01);

  console.log('\n=== lib/profitReport.js 소스 — categoryUnitMismatch 배선 확인 ===');
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  check('categoryUnitMismatch 함수가 export됨', /export async function categoryUnitMismatch/.test(reportSource));
  check('stockSnapshotByCategory가 categoryUnitMismatch를 호출', /categoryUnitMismatch\(major, orderYear, snapshot\.stockKey\)/.test(reportSource));
  check('반환값에 unitMismatch 맵이 포함됨', /unitMismatch:\s*unitRows/.test(reportSource));
  check('EstUnit 기준 매입/재고 단위 합집합 distinct count로 판정', /COUNT\(DISTINCT EstUnit\) AS UnitCount/.test(reportSource));

  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('API가 이번 차수 stock.unitMismatch를 stockEnd에서 전달', /unitMismatch: Boolean\(stockEnd\.unitMismatch\?\.\[key\]\)/.test(apiSource));
  check('API가 전차수(E 자동계산) stock.unitMismatch도 stockBegin에서 전달', /unitMismatch: Boolean\(stockBegin\.unitMismatch\?\.\[key\]\)/.test(apiSource));

  console.log('\n=== lib/profitReportCalc.js — computeAutoEndingStock이 unitMismatch를 실제로 분기 조건에 사용 ===');
  const calcSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCalc.js'), 'utf8');
  check('3순위(landed-cost 평균) 조건이 !stock.unitMismatch를 포함', /if \(!stock\.unitMismatch && purchQty > 0 && landedWon > 0\)/.test(calcSource));

  console.log('\n=== 결함수정 7: recentCost fallback에서 최근단가 못 찾은 품목을 0으로 조용히 누락하지 않음 ===');
  const missingCostRow = (overrides = {}) => ({
    category: '호주', currency: 'AUD', variant: 'normal',
    auto: { N: 100, L: 0, O: 0, Q: 10, S: 0, H: 0, E: 0, F: 0, R: 1000 },
    manual: {},
    stock: { endQty: 500, purchQty: 0, unitMismatch: true, recentCostMissingQty: 120, negativeQty: 0 },
    source: { E: 'auto_exe_stock_view', F: 'auto_exe_stock_view', H: 'missing', R: 'missing', S: 'missing' },
    ...overrides,
  });
  const missingCostAudit = buildProfitReportAudit([missingCostRow()], { major: 27 });
  check('최근단가 못 찾은 품목이 있으면 error(RECENT_COST_MISSING_ITEMS)로 표시',
    missingCostAudit.issues.some((i) => i.code === 'RECENT_COST_MISSING_ITEMS' && i.severity === 'error'));
  check('해당 카테고리는 needs_input 상태가 됨', missingCostAudit.status === 'needs_input');

  const noGapAudit = buildProfitReportAudit(
    [missingCostRow({ stock: { endQty: 500, purchQty: 0, unitMismatch: true, recentCostMissingQty: 0, negativeQty: 0 } })],
    { major: 27 },
  );
  check('갭이 없으면(recentCostMissingQty=0) RECENT_COST_MISSING_ITEMS 없음',
    !noGapAudit.issues.some((i) => i.code === 'RECENT_COST_MISSING_ITEMS'));

  const manualOverrideAudit = buildProfitReportAudit(
    [missingCostRow({ manual: { F: 9999999 } })],
    { major: 27 },
  );
  check('F를 수기 저장했으면(manual.F) 자동계산 갭 경고를 내지 않음',
    !manualOverrideAudit.issues.some((i) => i.code === 'RECENT_COST_MISSING_ITEMS'));

  const tier1Audit = buildProfitReportAudit(
    [missingCostRow({ stock: { endQty: 500, purchQty: 1000, unitMismatch: false, recentCostMissingQty: 120, negativeQty: 0 } })],
    { major: 27 },
  );
  check('unitMismatch가 아니고 이번 차수 매입도 있으면(1순위 공식 사용) 갭 경고 없음',
    !tier1Audit.issues.some((i) => i.code === 'RECENT_COST_MISSING_ITEMS'));

  console.log('\n=== lib/profitReport.js — recentCostMissingQty 배선 확인 ===');
  const reportSourceForGap = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  check('stockSnapshotByCategory SQL이 lc.UnitCost IS NULL 품목 수량을 별도 집계', /lc\.UnitCost IS NULL/.test(reportSourceForGap));
  check('반환값에 recentCostMissingQty 맵이 포함됨', /recentCostMissingQty:\s*Object\.fromEntries/.test(reportSourceForGap));
  const apiSourceForGap = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('API가 stock.recentCostMissingQty를 stockEnd에서 전달', /recentCostMissingQty: stockEnd\.recentCostMissingQty/.test(apiSourceForGap));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
