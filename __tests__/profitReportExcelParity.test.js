// __tests__/profitReportExcelParity.test.js — 웹 ↔ 원본 엑셀(2026 22~27차) 항목별 대조 판정 검증.
//
// 이 테스트는 **27차 오차의 원인 규명 결과 자체를 고정**한다. 나중에 누가 계산을 바꾸면
// "베트남 기초재고 차이는 엑셀 쪽 원인"이라는 판정이 조용히 뒤집히지 않도록 잠근다.
//
// 검증 내용
//   1. lib/profitReportExcelBaseline.js(자동 생성)가 원본 fixture와 값이 같다 — 기준값 드리프트 방지.
//   2. 27차 E(기초재고) 차이 3,658,862.89원은 **전액 베트남 한 줄**이며, 원본 엑셀이 자기 26차
//      기말과 어긋난 수기 예외다(웹은 26차 기말을 그대로 이월). → 판정 'explained'.
//   3. 22→26차 이월 체인에는 불일치가 없다 — 26→27 베트남 1건이 유일하다.
//   4. 27차 엑셀 F(기말재고)는 베트남·중국 등 칸이 비어 있고(수기 미기입), 웹 값은 'excel_blank_cell'로
//      분류된다.
//   5. **J·K에 5% 기준을 적용할 수 없다**는 산술 사실: 사용자 보고 실측치(27차)를 그대로 넣으면
//      J의 차이는 C 차이 − I 차이와 정확히 같고, J 단독 원인은 존재하지 않는다.
//   6. 원본 엑셀 값을 그대로 웹 값으로 넣으면 전 열이 'match'다(대조기 자체가 거짓 차이를 만들지 않음).
//
// 실행: node __tests__/profitReportExcelParity.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;
const NOEND = new Set(['이스라엘', '뉴질랜드', '일본']);
const cellOf = (parity, col) => parity.totals.find((c) => c.col === col);

// ── 27차 운영 실측치(사용자 보고, 2026-08-12) — 이 값들이 서로 산술적으로 맞물린다는 것 자체가
// "J 오차는 C·I 오차의 결과"라는 결론의 근거다.
const WEB_27_TOTALS = {
  N: 251445145, L: -11055272, O: -1143017,
  C: 239246856,                       // N + L + O
  E: 8919590, F: 15539936, H: 10813030,
  P: 133730753.465, T: 66315408.661,
  G: 200046162.126,                   // P + T
  I: 204238846,                       // E + G + H − F
  J: 35008010,                        // C − I
};

async function main() {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8',
  ));
  const baseline = await import('../lib/profitReportExcelBaseline.js');
  const { buildExcelParity, DEFAULT_TOLERANCE_PCT } = await import('../lib/profitReportExcelParity.js');

  // ── 1. 생성된 기준값이 원본 fixture와 동일한가
  console.log('\n=== 1. 기준값 드리프트 ===');
  let baselineCells = 0; let baselineMismatch = 0;
  for (const major of ['22', '23', '24', '25', '26', '27']) {
    const wk = fixture.weeks[major];
    const base = baseline.getExcelBaseline('2026', major);
    if (!base) { check(`${major}차 기준값 존재`, false); continue; }
    for (const cat of wk.categories) {
      for (const col of baseline.EXCEL_BASELINE_COLUMNS) {
        const raw = cat.cells?.[col]?.value;
        const expected = raw == null || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
        const actual = base.categories[cat.category]?.[col] ?? null;
        baselineCells += 1;
        if (!(expected == null ? actual == null : near(actual, expected, 1e-6))) {
          baselineMismatch += 1;
          if (baselineMismatch <= 3) console.error(`    ${major}차 ${cat.category} ${col}: fixture=${expected} baseline=${actual}`);
        }
      }
    }
  }
  check(`생성 기준값 ${baselineCells}셀이 원본 fixture와 일치`, baselineMismatch === 0, `불일치 ${baselineMismatch}건`);
  check('기준값은 2026년 22~27차만 존재', baseline.hasExcelBaseline('2026', '27') && !baseline.hasExcelBaseline('2026', '28') && !baseline.hasExcelBaseline('2025', '27'));

  // ── 2·3. 이월 체인 불일치 — 26→27 베트남 1건이 전부인가
  console.log('\n=== 2. 엑셀 자체 이월 체인 ===');
  const breaks = baseline.EXCEL_CARRYOVER_BREAKS;
  check('엑셀 22~27차 이월 불일치는 정확히 1건', breaks.length === 1, `실제 ${breaks.length}건`);
  const brk = breaks[0] || {};
  check('그 1건은 26→27차 베트남', brk.fromMajor === '26' && brk.toMajor === '27' && brk.category === '베트남');
  check('불일치 금액 3,658,862.89원', near(brk.diff, -3658862.88875, 0.01), String(brk.diff));

  const excel26F = baseline.getExcelBaseline('2026', '26').totals.F;
  const excel27E = baseline.getExcelBaseline('2026', '27').totals.E;
  check('엑셀 27차 기초재고 합계 − 26차 기말재고 합계 = 베트남 불일치 전액',
    near(excel27E - excel26F, 3658862.88875, 0.01), `${excel27E} − ${excel26F}`);
  check('웹 27차 기초재고(8,919,590)는 엑셀 26차 기말재고 합계와 일치 — 웹은 이월을 지킨다',
    near(WEB_27_TOTALS.E, excel26F, 1), `web=${WEB_27_TOTALS.E} excel26F=${excel26F}`);

  // ── 4·5. 실측치 대조 판정
  console.log('\n=== 3. 27차 실측 대조 판정 ===');
  const parity = buildExcelParity({ orderYear: '2026', major: '27', rowsWithCalc: [], totals: WEB_27_TOTALS });
  check('27차는 대조 가능', parity.available === true, parity.reason || '');
  check('허용오차 기본 5%', parity.tolerancePct === DEFAULT_TOLERANCE_PCT);

  const E = cellOf(parity, 'E');
  check('E 차이는 −3,658,863원', near(E.diff, -3658863.105749998, 1), String(E.diff));
  check('E 오차율은 5% 초과(29.1%)', Math.abs(E.pctDiff) > 0.05 && near(Math.abs(E.pctDiff), 0.2909, 0.001), String(E.pctDiff));
  check('E는 엑셀 이월 불일치로 설명되어 미설명 차이 ≈ 0', Math.abs(E.unexplained) <= 1, `unexplained=${E.unexplained}`);
  check("E 판정 = 'explained'", E.verdict === 'explained', E.verdict);
  check('E 원인 = excel_carryover_break', (E.causes[0] || {}).cause === 'excel_carryover_break');

  const F = cellOf(parity, 'F');
  check('F 오차율 17.5%, 판정 = investigate(웹 재고평가 확인 필요)',
    near(Math.abs(F.pctDiff), 0.1747, 0.001) && F.verdict === 'investigate', `${F.pctDiff} / ${F.verdict}`);

  const C = cellOf(parity, 'C');
  const I = cellOf(parity, 'I');
  const J = cellOf(parity, 'J');
  check('C 오차율 5.09%', near(Math.abs(C.pctDiff), 0.0509, 0.0005), String(C.pctDiff));
  check('I 오차율 2.91%', near(Math.abs(I.pctDiff), 0.0291, 0.0005), String(I.pctDiff));
  check('J 오차율 102.4%', near(Math.abs(J.pctDiff), 1.024, 0.002), String(J.pctDiff));
  check('J 차이 = C 차이 − I 차이 (J 단독 원인 없음)', near(J.diff, C.diff - I.diff, 1), `${J.diff} vs ${C.diff - I.diff}`);
  check('J는 파생열로 표시되고 상위 열이 C·I', J.derived === true && J.attribution.exact === true
    && J.attribution.parts.map(p => p.source).sort().join(',') === 'C,I');
  const jFromC = J.attribution.parts.find(p => p.source === 'C');
  const jFromI = J.attribution.parts.find(p => p.source === 'I');
  check('J 차이 분해 합 = J 차이', near(jFromC.amount + jFromI.amount, J.diff, 1));

  check('I 차이 = E 차이 + G 차이 + H 차이 − F 차이',
    near(I.diff, E.diff + cellOf(parity, 'G').diff + cellOf(parity, 'H').diff - F.diff, 1));
  check('H(그외통관비) 차이 0 — 판정 match', cellOf(parity, 'H').verdict === 'match' && Math.abs(cellOf(parity, 'H').diff) < 1);

  // O(그 외 매출액): 엑셀 27차 '그 외 매출액' 시트가 1,223,171원을 어느 카테고리에도 못 실은 원본
  // 결함이 있다. 다만 현재 웹 O는 엑셀보다 **낮아서**(−686,819) 이 결함으로는 설명되지 않는다 —
  // 원인은 목록에 남되 적용액 0으로, 판정은 investigate 여야 한다(원인을 억지로 상계하지 않는다).
  const O = cellOf(parity, 'O');
  check('O 원인 목록에 엑셀 원본 결함(1,223,171원 미분류)이 남아 있음',
    O.causes.some(c => c.cause === 'excel_known_defect' && near(c.amount, 1223171, 1)));
  check('그 결함은 방향이 반대라 적용액 0 — 억지 상계 없음',
    O.causes.every(c => c.applied === 0) && O.verdict === 'investigate', `${O.verdict}`);
  check('O 미설명 차이 = 실제 차이 −686,819원', near(O.unexplained, -686819, 1), String(O.unexplained));

  const N = cellOf(parity, 'N');
  check('N(순수매출)은 미설명 차이가 남아 investigate', N.verdict === 'investigate', `${N.verdict} unexplained=${N.unexplained}`);
  check('조사 목록은 원천열이 파생열보다 앞', parity.investigate.length > 0 && parity.investigate[0].derived === false);

  // ── 6. 엑셀 값을 그대로 넣으면 전 열 match — 대조기가 거짓 차이를 만들지 않는지
  console.log('\n=== 4. 자기동일성(엑셀=웹이면 차이 0) ===');
  for (const major of ['22', '23', '24', '25', '26', '27']) {
    const base = baseline.getExcelBaseline('2026', major);
    const rowsWithCalc = fixture.weeks[major].categories.map((cat) => ({
      category: cat.category,
      variant: NOEND.has(cat.category) ? 'noEnding' : 'normal',
      calc: Object.fromEntries(baseline.EXCEL_BASELINE_COLUMNS.map(c => [c, base.categories[cat.category]?.[c] ?? null])),
    }));
    const self = buildExcelParity({ orderYear: '2026', major, rowsWithCalc, totals: base.totals });
    // 알려진 원인은 "최대 얼마까지 설명하는지"의 상한이라, 실제 차이가 0이면 설명도 0이고 판정은 match다.
    const badTotals = self.totals.filter(c => c.verdict !== 'match');
    const badRows = self.categories.flatMap(r => r.cells.filter(c => c.verdict !== 'match').map(c => `${r.category}.${c.col}`));
    check(`${major}차 합계 전 열 match`, badTotals.length === 0, badTotals.map(c => `${c.col}:${c.verdict}`).join(','));
    check(`${major}차 카테고리 전 셀 match`, badRows.length === 0, badRows.slice(0, 5).join(','));
    const residuals = self.categories.flatMap(r => r.cells.filter(c => c.attributionResidual != null && Math.abs(c.attributionResidual) > 1));
    check(`${major}차 파생열 잔차 0(엑셀이 자기 공식을 지킴)`, residuals.length === 0,
      residuals.slice(0, 3).map(c => `${c.col}:${c.attributionResidual}`).join(','));
  }

  // ── 7. 대조 기준이 없는 차수는 조용히 통과시키지 않는다
  console.log('\n=== 5. 기준 없는 차수 ===');
  const none = buildExcelParity({ orderYear: '2026', major: '32', rowsWithCalc: [], totals: {} });
  check('32차는 available=false + 이유 표기', none.available === false && /원본 엑셀이 없습니다/.test(none.reason || ''));
  const y2025 = buildExcelParity({ orderYear: '2025', major: '27', rowsWithCalc: [], totals: {} });
  check('2025년 27차는 2026년 기준값과 섞이지 않는다', y2025.available === false);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
