// 22~27차 매출원가 양식 **전 열(C~U) × 전 카테고리** 공식 parity + 운영 원천 5% 감사.
// 실행: node __tests__/profitReportFullColumnParity.test.js
//
// 두 가지를 서로 다른 기준으로 검증한다.
//
//  (1) formula parity — 원본이 준 **입력값**(N/L/O/Q/R/S/E/F/H)만 웹 계산 함수에 넣었을 때,
//      원본이 계산한 **결과값**(C/D/G/I/J/K/M/P/T/U/합계행)이 정확히 재현되는가.
//      허용오차는 부동소수 반올림 수준(1e-6 상대)뿐이다. 여기서 하드코딩된 결과 합계를 읽어
//      통과시키지 않는다 — 결과값은 전부 웹 함수가 계산한다.
//
//  (2) source audit — 원본 H(그외통관비)를 웹이 **원천 구성요소로부터** 다시 만들 수 있는가.
//      historical snapshot(원본 워크북 구성요소)을 resolveCountryCustomsTotal/
//      resolveColombiaCustomsAllocation에 통과시켜 얻은 값과 원본 H 셀을 항목별로 대조하고,
//      오차율 5% 초과를 실패로 표시한다.
//
// 근거 fixture: __tests__/fixtures/profit-report-22-27-full.json
//   (scripts/extract-profit-workbook-fixture.mjs 가 원본 xlsx에서 read-only 추출)
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

const num = (cell) => (cell && typeof cell.value === 'number' ? cell.value : null);
const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
/** 상대오차. 기대값이 0이면 절대오차로 본다. */
const relError = (actual, expected) => {
  const e = Number(expected), a = Number(actual);
  if (!Number.isFinite(e) || !Number.isFinite(a)) return Infinity;
  if (Math.abs(e) < 1e-9) return Math.abs(a) < 1e-6 ? 0 : Infinity;
  return Math.abs(a - e) / Math.abs(e);
};
const FORMULA_TOLERANCE = 1e-6;   // 공식 재현은 부동소수 오차만 허용
const SOURCE_TOLERANCE = 0.05;    // 운영 원천 대조는 5% 초과를 실패로

const NO_ENDING = new Set(['이스라엘', '뉴질랜드', '일본']);
const WEEKS = ['22', '23', '24', '25', '26', '27'];

async function main() {
  const { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } =
    await import('../lib/profitReportCalc.js');
  const { RATE_DEFAULTS, resolveCountryCustomsTotal, resolveColombiaCustomsAllocation } =
    await import('../lib/customsForwarding.js');
  const { historicalColombiaWeeks } = await import('../lib/profitReportHistoricalCustoms.js');

  const workbook = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27-full.json'), 'utf8'),
  );
  check('fixture에 22~27차 6개 차수가 모두 있음', WEEKS.every((w) => workbook.weeks[w]));

  // ── (1) 전 열 × 전 카테고리 formula parity ────────────────────────────────
  console.log('\n=== (1) 전 열(C~U) × 전 카테고리 공식 재현 ===');
  const columnErrors = {};   // 열별 최대 상대오차
  let rowCount = 0;
  for (const week of WEEKS) {
    const wk = workbook.weeks[week];
    // 원본이 준 입력값만 넣어 웹 계산 함수로 각 행을 계산한다.
    const rows = wk.main.categories.map((c) => {
      const cell = (col) => num(c.cells[col]);
      const row = {
        category: c.category,
        variant: NO_ENDING.has(c.category) ? 'noEnding' : 'normal',
        stock: null, // F는 원본 직접입력값을 manual로 넣으므로 자동계산 재료가 필요 없다
        auto: {
          N: n0(cell('N')), L: n0(cell('L')), O: n0(cell('O')), Q: n0(cell('Q')),
          S: n0(cell('S')), H: n0(cell('H')), E: n0(cell('E')), F: n0(cell('F')), R: cell('R'),
        },
        manual: { E: cell('E'), F: cell('F'), H: cell('H'), R: cell('R'), S: cell('S') },
      };
      return { ...row, calc: computeProfitRow(row) };
    });
    const totals = computeProfitTotals(rows);

    for (const c of wk.main.categories) {
      const calc = rows.find((r) => r.category === c.category).calc;
      rowCount += 1;
      const compare = (col, actual) => {
        const expected = num(c.cells[col]);
        if (expected == null) return;                       // 원본이 빈칸이면 대조 대상 아님
        const err = relError(actual, expected);
        const key = col;
        if (!(key in columnErrors) || err > columnErrors[key].err) {
          columnErrors[key] = { err, week, category: c.category, actual, expected };
        }
      };
      compare('C', calc.C);
      compare('D', calcRevenueRatio(calc, totals, c.category));
      compare('G', calc.G);
      compare('I', calc.I);
      compare('J', calc.J);
      compare('K', calc.K);
      compare('M', calc.M);
      compare('P', calc.P);
      compare('T', calc.T);
      compare('U', calcPurchaseRatio(calc, totals, c.category));
      // 입력열은 그대로 통과해야 한다(웹이 임의로 바꾸지 않는지 확인)
      compare('E', calc.E); compare('F', calc.F); compare('H', calc.H);
      compare('L', calc.L); compare('N', calc.N); compare('O', calc.O);
      compare('Q', calc.Q); compare('R', calc.R); compare('S', calc.S);
    }

    // 합계행(23행) — 열마다 SUM 범위가 다르다(공제 포함/제외, U는 베트남까지 제외).
    // U 합계는 원본이 SUM(U7:U20)으로 베트남을 빼는 특수 케이스라 별도 검증한다.
    for (const col of ['C', 'E', 'F', 'J', 'G', 'H', 'I', 'L', 'N', 'O', 'P', 'Q', 'S', 'T', 'K', 'M']) {
      const expected = num(wk.main.totals[col]);
      if (expected == null) continue;
      const err = relError(totals[col], expected);
      const key = `합계${col}`;
      if (!(key in columnErrors) || err > columnErrors[key].err) {
        columnErrors[key] = { err, week, category: '합계', actual: totals[col], expected };
      }
    }
  }
  check(`22~27차 전 카테고리 행을 계산(${rowCount}행)`, rowCount === WEEKS.length * 16, String(rowCount));
  for (const [col, worst] of Object.entries(columnErrors)) {
    check(`${col} 공식 재현 (최대오차 ${(worst.err * 100).toExponential(2)}%)`,
      worst.err <= FORMULA_TOLERANCE,
      `${worst.week}차 ${worst.category}: 계산=${worst.actual} 원본=${worst.expected}`);
  }

  console.log('\n=== noEnding 3개국(이스라엘·뉴질랜드·일본) 예외 공식이 실제로 분기됨 ===');
  const noEndInput = {
    category: '이스라엘', variant: 'noEnding', stock: null,
    auto: { N: 1000, L: 0, O: 0, Q: 1, S: 0, H: 30, E: 10, F: 20, R: 100 },
    manual: { E: 10, F: 20, H: 30, R: 100, S: 0 },
  };
  const noEndCalc = computeProfitRow(noEndInput);
  check('noEnding: I = E+G+H (F 미차감)', noEndCalc.I === 10 + 100 + 30);
  check('noEnding: J = C-I+F', noEndCalc.J === 1000 - noEndCalc.I + 20);
  check('noEnding: K = J/(C+F)', Math.abs(noEndCalc.K - noEndCalc.J / (1000 + 20)) < 1e-12);
  const normalCalc = computeProfitRow({ ...noEndInput, category: '태국', variant: 'normal' });
  check('일반 국가: I = E+G+H-F', normalCalc.I === 10 + 100 + 30 - 20);

  console.log('\n=== 기타(미분류)는 공식 본표 합계에 들어가지 않는다 ===');
  const mkRow = (category, C) => {
    const row = {
      category, variant: 'normal', stock: null,
      auto: { N: C, L: 0, O: 0, Q: C, S: 0, H: 0, E: 0, F: 0, R: 1 },
      manual: { E: 0, F: 0, H: 0, R: 1, S: 0 },
    };
    return { ...row, calc: computeProfitRow(row) };
  };
  const withExtra = [mkRow('태국', 100), mkRow('공제', 10), mkRow('기타(미분류)', 999)];
  const extraTotals = computeProfitTotals(withExtra);
  check('합계 C에 미분류 999가 포함되지 않음(공제 10은 포함)', extraTotals.C === 110, String(extraTotals.C));
  check('합계 P/Q에도 미분류가 포함되지 않음', extraTotals.P === 100 && extraTotals.Q === 100);
  check('미분류 행의 D는 비율을 만들지 않음(null)',
    calcRevenueRatio(withExtra[2].calc, extraTotals, '기타(미분류)') === null);
  check('미분류 행의 U도 null', calcPurchaseRatio(withExtra[2].calc, extraTotals, '기타(미분류)') === null);
  check('정상 카테고리 D 분모는 미분류를 뺀 합계',
    Math.abs(calcRevenueRatio(withExtra[0].calc, extraTotals, '태국') - 100 / 110) < 1e-12);

  // ── (2) H 원천 구성요소 → 원본 공식 → 원본 H 대조 (5% 감사) ──────────────
  console.log('\n=== (2) H(그외통관비) 원천 구성요소 재현 — 오차율 5% 초과는 실패 ===');
  const auditRows = [];
  for (const week of WEEKS) {
    const wk = workbook.weeks[week];
    for (const [category, src] of Object.entries(wk.countryCustoms)) {
      // row=null → historical snapshot 경로. gwDef는 일부러 넘기지 않는다(스냅샷 자체로 재현되는지 확인).
      const resolved = resolveCountryCustomsTotal({
        row: null, gwDef: null, rates: RATE_DEFAULTS, category, orderYear: '2026', major: week,
      });
      auditRows.push({
        label: `${week}차 ${category}`, actual: resolved.total, expected: src.excelTotal,
        source: resolved.source,
      });
    }
  }
  const badCountry = auditRows.filter((r) => relError(r.actual, r.expected) > SOURCE_TOLERANCE);
  check(`국가별 H ${auditRows.length}건 모두 오차율 5% 이내`, badCountry.length === 0,
    badCountry.slice(0, 5).map((r) => `${r.label} 계산=${r.actual} 원본=${r.expected}`).join(' / '));
  const worstCountry = auditRows.reduce(
    (worst, r) => (relError(r.actual, r.expected) > relError(worst.actual, worst.expected) ? r : worst),
    auditRows[0],
  );
  check(`국가별 H 최대 오차율 ${(relError(worstCountry.actual, worstCountry.expected) * 100).toFixed(4)}%`,
    relError(worstCountry.actual, worstCountry.expected) <= FORMULA_TOLERANCE,
    `${worstCountry.label} 계산=${worstCountry.actual} 원본=${worstCountry.expected}`);
  check('모든 국가행이 historical_snapshot 원천으로 표시됨(자동값으로 위장하지 않음)',
    auditRows.every((r) => r.source === 'historical_snapshot'));

  const colRows = [];
  for (const week of WEEKS) {
    const wk = workbook.weeks[week];
    for (const [orderWeek, src] of Object.entries(wk.colombia)) {
      const resolved = resolveColombiaCustomsAllocation({
        orderWeek, orderYear: '2026', major: week, colRow: null,
        boxQty: {}, gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
      });
      colRows.push({ label: orderWeek, actual: resolved.total, expected: src.excelTotal, source: resolved.source });
    }
  }
  check(`콜롬비아 반차수 ${colRows.length}건이 fixture 전체를 덮음`,
    colRows.length === historicalColombiaWeeks().length);
  const badCol = colRows.filter((r) => relError(r.actual, r.expected) > FORMULA_TOLERANCE);
  check('콜롬비아 반차수 TOTAL이 원본 공식으로 정확히 재현',
    badCol.length === 0, badCol.map((r) => `${r.label} 계산=${r.actual} 원본=${r.expected}`).join(' / '));

  console.log('\n=== 콜롬비아 4품목 무게배분이 원본 H와 맞는가 (5% 감사) ===');
  const COL_CATS = ['콜롬비아 장미', '콜롬비아 카네이션', '콜롬비아 알스트로', '콜롬비아 루스커스'];
  const allocAudit = [];
  for (const week of WEEKS) {
    const wk = workbook.weeks[week];
    const sum = Object.fromEntries(COL_CATS.map((c) => [c, 0]));
    for (const orderWeek of Object.keys(wk.colombia)) {
      const resolved = resolveColombiaCustomsAllocation({
        orderWeek, orderYear: '2026', major: week, colRow: null,
        boxQty: {}, gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
      });
      for (const c of COL_CATS) sum[c] += resolved.allocation[c].H;
    }
    for (const c of COL_CATS) {
      const expected = num(wk.main.categories.find((x) => x.category === c).cells.H);
      if (expected == null) continue;
      allocAudit.push({ label: `${week}차 ${c}`, actual: sum[c], expected });
    }
  }
  const badAlloc = allocAudit.filter((r) => relError(r.actual, r.expected) > SOURCE_TOLERANCE);
  check(`콜롬비아 4품목 H ${allocAudit.length}건 모두 오차율 5% 이내`, badAlloc.length === 0,
    badAlloc.slice(0, 6).map((r) => `${r.label} 계산=${Math.round(r.actual)} 원본=${Math.round(r.expected)} (${(relError(r.actual, r.expected) * 100).toFixed(2)}%)`).join(' / '));

  console.log('\n=== 하드코딩 합계로 통과시키지 않는다(구조 검증) ===');
  const historicalSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'profitReportHistoricalCustoms.js'), 'utf8');
  check('historical snapshot 모듈에 최종 H 합계 테이블이 없음',
    !/COUNTRY_H_BY_MAJOR/.test(historicalSource) && !/AUDITED_GRAND_TOTAL/.test(historicalSource));
  check('historical snapshot이 구성요소(GW/관세/선율/월드운송료/방역)를 보관',
    /SunYul1/.test(historicalSource) && /WorldFreight1/.test(historicalSource)
    && /Quarantine1/.test(historicalSource) && /Customs1/.test(historicalSource));
  const forwardingSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');
  check('resolveCountryCustomsTotal이 총액을 그대로 반환하지 않고 공식으로 계산',
    /source: HISTORICAL_SOURCE_TAG/.test(forwardingSource)
    && /total: computeCountryCustomsTotal\(world\.row, effectiveRates, category\)/.test(forwardingSource));
  // fixture는 테스트 증거일 뿐이다 — 프로덕션 런타임이 json을 읽으면 fixture가 사라지거나 바뀔 때
  // 운영 계산이 함께 흔들린다. (주석에 근거 파일명을 남기는 것은 허용, 실제 import/require만 금지)
  const importsFixture = (src) => /(?:import|require)\s*\(?[^\n]*profit-report-22-27/.test(src)
    || /from\s+['"][^'"]*profit-report-22-27/.test(src);
  check('프로덕션 코드가 테스트 fixture json을 import하지 않음',
    !importsFixture(forwardingSource) && !importsFixture(historicalSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
