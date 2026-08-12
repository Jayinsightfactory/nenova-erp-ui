// __tests__/profitReportWorkbookFullParity.test.js — 2026년 22~27차 전체 열·전체 카테고리 공식 재현 검증.
//
// __tests__/fixtures/profit-report-22-27.json(원본 6개 xlsx, read-only 추출)의 카테고리별 원본 셀 값을
// 그대로 computeProfitRow/computeProfitTotals 입력으로 넣어, 프로덕션 계산 공식이 원본과 정확히
// 일치하는지 6개 차수 × 16개 카테고리(공제 포함) × C~U 전체 열에서 검증한다. 하드코딩된 합계를
// 그대로 읽어 통과시키지 않는다 — 매번 lib/profitReportCalc.js의 실제 함수를 호출한다.
//
// 알려진 원본 결함(fixture.weeks[major].expectedAnomalies/manualExceptions)은 "원본 자체의 결함"으로
// 문서화된 것만 예외 처리한다(추측으로 새 예외를 추가하지 않는다).
//
// 실행: node __tests__/profitReportWorkbookFullParity.test.js
const fs = require('fs');
const path = require('path');

const near = (actual, expected, tolerance) => Math.abs(Number(actual) - Number(expected)) <= tolerance;
let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

const NOEND_CATEGORIES = new Set(['이스라엘', '뉴질랜드', '일본']);
const MAJORS = ['22', '23', '24', '25', '26', '27'];
// 원본 자체의 스테일 캐시 결함(fixture expectedAnomalies id=colombia-n21-n24-div0-template) —
// 콜롬비아 1/2차 시트 N21:N24는 항상 #DIV/0!인 템플릿 잔재라 본표 계산과는 무관하다. 본표 열
// 재현에는 영향이 없으므로 별도 스킵 처리가 필요 없다(참고용으로만 남긴다).

async function main() {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8',
  ));
  const { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio, TOTALS_EXCLUDED_CATEGORIES }
    = await import('../lib/profitReportCalc.js');

  check('본표 합계 제외 목록에 기타(미분류)만 있음(원본 fixture에는 그 행 자체가 없음)',
    TOTALS_EXCLUDED_CATEGORIES.length === 1 && TOTALS_EXCLUDED_CATEGORIES[0] === '기타(미분류)');

  let cellsChecked = 0;
  for (const major of MAJORS) {
    const week = fixture.weeks[major];
    if (!week) { check(`fixture에 ${major}차 존재`, false); continue; }
    console.log(`\n=== ${major}차 (${week.categories.length}개 카테고리) ===`);

    const rowsWithCalc = week.categories.map((cat) => {
      const cells = cat.cells;
      const variant = NOEND_CATEGORIES.has(cat.category) ? 'noEnding' : 'normal';
      const auto = {
        N: cells.N?.value ?? 0, L: cells.L?.value ?? 0, O: cells.O?.value ?? 0,
        Q: cells.Q?.value ?? 0, S: cells.S?.value ?? 0, H: cells.H?.value ?? 0,
        E: cells.E?.value ?? 0, F: cells.F?.value ?? 0, R: cells.R?.value ?? null,
      };
      const calc = computeProfitRow({ category: cat.category, variant, stock: {}, auto, manual: {} });
      return { category: cat.category, variant, cells, calc };
    });

    for (const { category, cells, calc } of rowsWithCalc) {
      const label = (key) => `${major}차 ${category} ${key}`;
      // C/G/I/J/K/M/P/T는 계산값 — 원본 셀과 직접 대조한다.
      check(label('C=N+L+O'), near(calc.C, cells.C?.value ?? 0, 0.5)); cellsChecked += 1;
      check(label('G=P+T'), near(calc.G, cells.G?.value ?? 0, 0.5)); cellsChecked += 1;
      check(label('I=E+G+H-F(±noEnding)'), near(calc.I, cells.I?.value ?? 0, 0.5)); cellsChecked += 1;
      check(label('J=C-I(±noEnding)'), near(calc.J, cells.J?.value ?? 0, 0.5)); cellsChecked += 1;
      if (typeof cells.K?.value === 'number') {
        check(label('K=J/C(±noEnding)'), calc.K == null ? false : near(calc.K, cells.K.value, 0.0005));
        cellsChecked += 1;
      }
      if (typeof cells.M?.value === 'number') {
        check(label('M=-L/C'), calc.M == null ? false : near(calc.M, cells.M.value, 0.0005));
        cellsChecked += 1;
      }
      check(label('P=Q×R'), near(calc.P, cells.P?.value ?? 0, 0.5)); cellsChecked += 1;
      check(label('T=S×R'), near(calc.T, cells.T?.value ?? 0, 0.5)); cellsChecked += 1;
    }

    // 합계행 — computeProfitTotals가 원본 24행(SUM 범위 규칙)과 일치해야 한다.
    const totals = computeProfitTotals(rowsWithCalc);
    const wt = week.totals;
    for (const col of ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'N', 'O', 'P', 'Q', 'S', 'T']) {
      if (typeof wt[col]?.value !== 'number') continue;
      check(`${major}차 합계 ${col}`, near(totals[col], wt[col].value, Math.max(1, Math.abs(wt[col].value) * 0.0005)),
        `calc=${totals[col]} excel=${wt[col].value}`);
      cellsChecked += 1;
    }
    if (typeof wt.K?.value === 'number') { check(`${major}차 합계 K=J/(C+F)`, near(totals.K, wt.K.value, 0.0005)); cellsChecked += 1; }
    if (typeof wt.M?.value === 'number') { check(`${major}차 합계 M=-L/C`, near(totals.M, wt.M.value, 0.0005)); cellsChecked += 1; }
    if (typeof wt.D?.value === 'number') { check(`${major}차 합계 D=SUM(D7:D22)`, near(totals.D, wt.D.value, 0.0005)); cellsChecked += 1; }
    if (typeof wt.U?.value === 'number') { check(`${major}차 합계 U=SUM(U7:U20)`, near(totals.U, wt.U.value, 0.0005)); cellsChecked += 1; }

    // D/U 비율 — 화면·엑셀 공용 함수로 행 단위 재계산.
    for (const { category, cells, calc } of rowsWithCalc) {
      const D = calcRevenueRatio(calc, totals);
      const U = calcPurchaseRatio(calc, totals);
      if (typeof cells.D?.value === 'number') {
        check(`${major}차 ${category} D`, D == null ? false : near(D, cells.D.value, 0.0005)); cellsChecked += 1;
      }
      if (typeof cells.U?.value === 'number' && category !== '공제') {
        check(`${major}차 ${category} U`, U == null ? false : near(U, cells.U.value, 0.0005)); cellsChecked += 1;
      }
    }
  }

  console.log(`\n검사한 셀 수: ${cellsChecked}`);
  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
