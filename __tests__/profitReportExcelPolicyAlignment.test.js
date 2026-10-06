// 매출원가 엑셀 전용 콜롬비아 계수와 공통 원가자료 계수 분리 회귀 테스트.
// 실행: node __tests__/profitReportExcelPolicyAlignment.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { applyProfitReportColombiaRates } = await import('../lib/profitReportCustomsPolicy.js');
  const {
    COLOMBIA_POOLED_HYDRANGEA,
    RATE_DEFAULTS,
    computeColombiaAllocation,
    resolveColombiaCustomsAllocation,
  } = await import('../lib/customsForwarding.js');
  const { computeProfitRow } = await import('../lib/profitReportCalc.js');

  const baseRates = {
    ...RATE_DEFAULTS,
    BakSangRate: 460,
    Truck5t: 200000,
    QuarantinePerItemRate: 0,
  };
  const frozenBase = structuredClone(baseRates);
  const excelRates = applyProfitReportColombiaRates(baseRates);

  assert.notEqual(excelRates, baseRates, '정책 적용은 별도 rate 객체를 반환');
  assert.deepEqual(baseRates, frozenBase, '입력 baseRates를 변경하지 않음');
  assert.deepEqual([
    excelRates.BoxWeight_콜롬비아장미,
    excelRates.BoxWeight_콜롬비아카네이션,
    excelRates.BoxWeight_콜롬비아알스트로,
    excelRates.BoxWeight_콜롬비아루스커스,
    excelRates.BoxWeight_콜롬비아수국,
  ], [7, 11, 9.7, 8, 5.6], '매출원가 엑셀 무게 계수');
  assert.deepEqual([
    excelRates.BoxCBM_콜롬비아장미,
    excelRates.BoxCBM_콜롬비아카네이션,
    excelRates.BoxCBM_콜롬비아알스트로,
    excelRates.BoxCBM_콜롬비아루스커스,
    excelRates.BoxCBM_콜롬비아수국,
  ], [10, 11, 7, 9.6, 7], '매출원가 엑셀 CBM 계수');
  assert.deepEqual([
    baseRates.BoxWeight_콜롬비아장미,
    baseRates.BoxWeight_콜롬비아카네이션,
    baseRates.BoxWeight_콜롬비아알스트로,
    baseRates.BoxWeight_콜롬비아루스커스,
    baseRates.BoxWeight_콜롬비아수국,
  ], [8, 11, 9.7, 8, 5.5], '공통 원가자료 무게 계수는 유지');
  assert.deepEqual([
    baseRates.BoxCBM_콜롬비아장미,
    baseRates.BoxCBM_콜롬비아카네이션,
    baseRates.BoxCBM_콜롬비아알스트로,
    baseRates.BoxCBM_콜롬비아루스커스,
    baseRates.BoxCBM_콜롬비아수국,
  ], [10, 9, 7, 9.6, 6.7], '공통 원가자료 CBM 계수는 유지');
  // 실제 공통 계산기를 이용해 GW=CW와 GW≠CW 조건의 배부 공식/합계 보존을 확인.
  const qty = {
    '콜롬비아 장미': 3,
    '콜롬비아 카네이션': 5,
    '콜롬비아 알스트로': 2,
    '콜롬비아 루스커스': 4,
    '콜롬비아 수국': 2,
  };
  const rowFor = (GW, CW) => ({
    GW, CW, HandlingFee: 12345, ItemCount: 2, Truck5t: 1,
    CustomsFee: 23456, DisinfectFee: 3456, QuarantineDeductFee: 789,
    AirRateUSD: 1234.56,
  });
  const totalFor = (row) => row.GW * baseRates.BakSangRate + row.HandlingFee
    + row.ItemCount * baseRates.QuarantinePerItemRate + row.Truck5t * baseRates.Truck5t
    + row.CustomsFee + row.DisinfectFee + row.QuarantineDeductFee;
  for (const [label, GW, CW] of [['GW=CW', 1200, 1200], ['GW≠CW', 1200, 1350]]) {
    const row = rowFor(GW, CW);
    const result = computeColombiaAllocation(row, qty, excelRates);
    const HSum = Object.values(result).reduce((sum, item) => sum + item.H, 0);
    const SSum = Object.values(result).reduce((sum, item) => sum + item.S, 0);
    assert.ok(Math.abs(HSum - totalFor(row)) < 1e-7, `${label}: H 배부 합계 보존`);
    assert.ok(Math.abs(SSum - row.AirRateUSD) < 1e-7, `${label}: S 배부 합계 보존`);

    const useWeight = GW === CW;
    const weightBasis = Object.fromEntries(Object.entries(qty).map(([cat, boxes]) => {
      const suffix = cat.replace('콜롬비아 ', '');
      const key = `BoxWeight_콜롬비아${suffix}`;
      return [cat, boxes * excelRates[key]];
    }));
    const cbmBasis = Object.fromEntries(Object.entries(qty).map(([cat, boxes]) => {
      const suffix = cat.replace('콜롬비아 ', '');
      const key = `BoxCBM_콜롬비아${suffix}`;
      return [cat, boxes * excelRates[key]];
    }));
    const basis = useWeight ? weightBasis : cbmBasis;
    const denom = Object.values(basis).reduce((sum, value) => sum + value, 0);
    for (const cat of Object.keys(qty)) {
      assert.ok(Math.abs(result[cat].S - row.AirRateUSD * basis[cat] / denom) < 1e-8,
        `${label}: ${cat} S 배부 기준`);
    }
  }

  const mixedHydrangeaQty = { ...qty, [COLOMBIA_POOLED_HYDRANGEA]: 3 };
  const resolvedMixed = resolveColombiaCustomsAllocation({
    orderWeek: '38-01', orderYear: '2027', major: '38',
    colRow: null, boxQty: mixedHydrangeaQty, gwDef: { GW: 1200, CW: 1350 },
    airTotal: 300, rates: applyProfitReportColombiaRates(baseRates),
  });
  assert.equal(resolvedMixed.source, 'gw_auto', '실제 resolver가 2027년 GW 원천을 사용하고 다른 연도 historical 행을 섞지 않음');
  assert.equal(resolvedMixed.row.GW, 1200, '실제 resolver 행이 해당 연도 GW 컨텍스트 보존');
  assert.ok(resolvedMixed.allocation[COLOMBIA_POOLED_HYDRANGEA], '혼적 수국이 배분 풀에 포함');
  assert.ok(Math.abs(Object.values(resolvedMixed.allocation).reduce((sum, item) => sum + item.H, 0) - resolvedMixed.total) < 1e-7,
    '혼적 수국 포함 H 배분 합계 보존');
  assert.ok(Math.abs(Object.values(resolvedMixed.allocation).reduce((sum, item) => sum + item.S, 0) - 300) < 1e-7,
    '혼적 수국 포함 S 배분 합계 보존');
  excelRates.BoxWeight_콜롬비아장미 = 999;
  assert.equal(baseRates.BoxWeight_콜롬비아장미, 8, '반환값 변경이 baseRates로 전파되지 않음');

  // 실제 API 연도 컨텍스트: 당기/전기 요청은 각각 자신의 대차수·연도를 전달한다.
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  assert.match(apiSource, /computeCustomsAndForwarding\(major, orderYear, \{ profile: 'profit-report' \}\)/,
    '당기 원천은 요청 연도를 사용');
  assert.match(apiSource, /computeCustomsAndForwarding\(prevMajor, prevOrderYear, \{ profile: 'profit-report' \}\)/,
    '전기 원천은 계산된 전기 연도 컨텍스트를 사용');
  assert.match(apiSource, /computeCustomsAndForwarding\(ppMajor, ppYear, \{ profile: 'profit-report' \}\)/,
    'FIFO 전전기 원천도 보고서 전용 계산 프로파일을 사용');
  assert.match(apiSource, /const ppYear\s*=\s*prevOrderYear/,
    'FIFO 전전기는 실제 계산된 전기 연도 컨텍스트를 사용');
  assert.match(apiSource, /currentMajor <= 1 \? String\(Number\(orderYear\) - 1\) : String\(orderYear\)/,
    '01차만 기초재고 연도를 전년도로 이동');
  assert.match(apiSource, /currentMajor <= 1 \? '52'/,
    '01차 기초재고는 전년도 52차를 참조');
  const weekCheckSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report-week-check.js'), 'utf8');
  assert.match(weekCheckSource, /computeCustomsAndForwarding\(major, orderYear, \{ profile: 'profit-report' \}\)/,
    '새 차수 week-check도 보고서 전용 계산 프로파일을 사용');
  const customsSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');
  assert.match(customsSource, /profile\s*===\s*['"]profit-report['"]\s*\?\s*applyProfitReportColombiaRates\(rates\)\s*:\s*rates/,
    '콜롬비아 계수 오버라이드는 보고서 프로파일에서만 적용');
  for (const [route, resultKey, allocationKey] of [
    ['customs-clearance.js', 'allocationH', 'H'],
    ['forwarding-clearance.js', 'allocationS', 'S'],
  ]) {
    const routeSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', route), 'utf8');
    assert.match(routeSource, /resolveColombiaCustomsAllocation\(/, `${route}: 보고서 공용 Colombia resolver`);
    assert.match(routeSource, /applyProfitReportColombiaRates\(rates\)/, `${route}: 보고서 Excel 계수`);
    assert.match(routeSource, /hydBoxes\s*>\s*0[\s\S]{0,180}COLOMBIA_POOLED_HYDRANGEA/,
      `${route}: 혼적 수국 박스를 같은 배분 풀에 주입`);
    assert.match(routeSource, /Object\.entries\(resolved\.allocation\)/,
      `${route}: resolver가 반환한 전체 품목 배분을 직렬화`);
    assert.match(routeSource, new RegExp(`${resultKey}:\\s*Object\\.fromEntries\\(Object\\.entries\\(resolved\\.allocation\\)\\.map\\(\\(\\[cat,\\s*value\\]\\)\\s*=>\\s*\\[cat,[^\\]]*value\\.${allocationKey}`),
      `${route}: 전체 ${allocationKey} 배분을 ${resultKey}로 노출`);
  }

  // 자동 H=0은 보존되고 AJ는 이익에만 반영, E/F의 소수 정밀도도 유지.
  const row = {
    category: '콜롬비아 장미', variant: 'normal', stock: {},
    auto: { N: 1000, L: 0, O: 0, Q: 1, R: 1.5, H: 456, S: 0, E: 123.4567, F: 23.4567 },
    manual: { H: 0, AJ: 12.34 },
  };
  const calc = computeProfitRow(row);
  assert.equal(calc.H, 0, '수기 H=0이 양수 자동 H보다 우선');
  assert.equal(calc.AJ, 12.34, 'AJ 수기값 보존');
  assert.equal(calc.E, 123.4567, 'E 자동 소수 정밀도 보존');
  assert.equal(calc.F, 23.4567, 'F 자동 소수 정밀도 보존');

  const calcSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCalc.js'), 'utf8');
  assert.doesNotMatch(calcSource, /Math\.round\s*\(\s*auto[EF]\b/, '자동 E/F 값 계산에서 반올림하지 않음');
  assert.match(apiSource, /E: autoE != null \? autoE : null/,
    'API가 E 자동 재고 금액의 소수 정밀도를 보존');
  assert.match(apiSource, /F: autoF != null \? autoF : null/,
    'API가 F 자동 재고 금액의 소수 정밀도를 보존');

  // 확정 스냅샷은 수정/재계산하지 않는 기존 보장을 테스트의 일부로 고정.
  const snapshotTest = fs.readFileSync(path.join(__dirname, 'profitReportConfirmSnapshotImmutability.test.js'), 'utf8');
  assert.match(snapshotTest, /confirmed.*computeProfitRow 재계산을 건너뜀/);
  assert.match(snapshotTest, /엑셀 생성이 row\.confirmed면 저장된 calc를 그대로 씀/);

  console.log('성공 — Excel 정책 계수, 분배, 연도 컨텍스트 및 보고서 계산 정밀도');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
