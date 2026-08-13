// lib/profitReportDriverExplanation.js 회귀 검증 — K(이익률) 변동을 매출이익 영향액으로 설명.
// 전부 순수 함수(DB 없음) — DB 목킹 불필요.
//
// 실행: node __tests__/profitReportDriverExplanation.test.js
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { DRIVER_COLUMNS, averageTotals, explainDrivers } = await import('../lib/profitReportDriverExplanation.js');

  console.log('=== DRIVER_COLUMNS — 고정 순서 C/E/F/P/H/T (L은 C에 포함되어 중복 제외) ===');
  check('DRIVER_COLUMNS = [C,E,F,P,H,T]', JSON.stringify(DRIVER_COLUMNS) === JSON.stringify(['C', 'E', 'F', 'P', 'H', 'T']));

  console.log('\n=== averageTotals — 여러 주차 totals의 필드별 단순평균, null 주차/필드는 그 필드 평균에서만 제외 ===');
  {
    const list = [{ C: 100, E: 10 }, { C: 200, E: 20 }, { C: 300, E: 30 }];
    const avg = averageTotals(list, ['C', 'E']);
    check('C 평균 = 200', avg.C === 200);
    check('E 평균 = 20', avg.E === 20);
  }
  {
    // 필드가 일부 주차에서만 null이면 그 필드만 유효 주차로 평균(전체 주차 수로 나누지 않음).
    const list = [{ C: 100 }, { C: null }, { C: 300 }];
    const avg = averageTotals(list, ['C']);
    check('null 필드는 그 필드 평균에서 제외 — (100+300)/2=200 (3이 아님)', avg.C === 200, `actual=${avg.C}`);
  }
  {
    // 전체 주차가 null인 필드는 결과도 null.
    const list = [{ C: null }, { C: undefined }];
    const avg = averageTotals(list, ['C']);
    check('전 주차 null인 필드는 결과도 null', avg.C === null);
  }
  {
    // null/undefined totals 자체(주차 실패)는 filter(Boolean)로 걸러짐.
    const list = [{ C: 100 }, null, undefined, { C: 300 }];
    const avg = averageTotals(list, ['C']);
    check('null/undefined totals(주차 실패)는 건너뜀 — (100+300)/2=200', avg.C === 200, `actual=${avg.C}`);
  }
  {
    check('빈 리스트 → 모든 컬럼 null', (() => {
      const avg = averageTotals([], ['C', 'E']);
      return avg.C === null && avg.E === null;
    })());
    check('totalsList 생략(default []) → 크래시 없이 전부 null', (() => {
      const avg = averageTotals(undefined, DRIVER_COLUMNS);
      return DRIVER_COLUMNS.every((c) => avg[c] === null);
    })());
  }
  {
    // columns 인자 생략 시 DRIVER_COLUMNS 전체를 기본으로 사용.
    const single = { C: 1, E: 2, F: 3, P: 4, H: 5, T: 6, L: 7 };
    const avg = averageTotals([single]);
    check('columns 생략 시 DRIVER_COLUMNS 6개 전부 계산됨', DRIVER_COLUMNS.every((c) => avg[c] === single[c]));
  }

  console.log('\n=== explainDrivers — delta/pctDelta 산식, |delta| 내림차순 정렬 ===');
  {
    const current = { C: 1000, E: 100, F: 90, P: 500, H: 20, T: 10, L: 5 };
    const priorAvg = { C: 900, E: 100, F: 100, P: 520, H: 20, T: 30, L: 5 };
    const list = explainDrivers(current, priorAvg);
    check('6개 컬럼 전부 반환(L 중복 제외)', list.length === 6 && !list.some((d) => d.column === 'L'));
    const byCol = Object.fromEntries(list.map((d) => [d.column, d]));
    check('C delta = 100', byCol.C.delta === 100);
    check('C pctDelta = 100/900', Math.abs(byCol.C.pctDelta - 100 / 900) < 1e-9, `actual=${byCol.C.pctDelta}`);
    check('E delta = 0(변화 없음)', byCol.E.delta === 0);
    check('E pctDelta = 0/100 = 0', byCol.E.pctDelta === 0);
    check('F delta = -10', byCol.F.delta === -10);
    check('T delta = -20(가장 큰 절대값)', byCol.T.delta === -20);
    check('비용 P 감소는 이익 증가 영향', byCol.P.delta === -20 && byCol.P.profitImpact === 20 && byCol.P.impactDirection === 'improved');
    check('기말재고 F 감소는 이익 감소 영향', byCol.F.delta === -10 && byCol.F.profitImpact === -10 && byCol.F.impactDirection === 'worsened');
    // |delta| 내림차순: T(20) > C(100)? — 실제로 C=100이 가장 크다. 정렬 검증은 실제 절대값 기준으로.
    const deltasInOrder = list.map((d) => Math.abs(d.delta ?? 0));
    const sortedDesc = [...deltasInOrder].sort((a, b) => b - a);
    check('|delta| 내림차순 정렬됨', JSON.stringify(deltasInOrder) === JSON.stringify(sortedDesc), JSON.stringify(deltasInOrder));
    check('가장 큰 |delta|는 C(100) — 최상단', list[0].column === 'C', JSON.stringify(list.map((d) => [d.column, d.delta])));
  }
  {
    // priorAvgValue가 0이면 pctDelta는 division-by-zero를 피해 null이어야 한다(소스: priorAvgValue !== 0 조건).
    const current = { C: 50 };
    const priorAvg = { C: 0 };
    const list = explainDrivers(current, priorAvg);
    const c = list.find((d) => d.column === 'C');
    check('priorAvgValue=0이면 delta는 계산되지만(50) pctDelta는 null(0-division 회피)', c.delta === 50 && c.pctDelta === null, JSON.stringify(c));
  }
  {
    // currentValue 또는 priorAvgValue가 null이면 delta/pctDelta 모두 null(크래시 없음).
    const list1 = explainDrivers({ C: null }, { C: 100 });
    const list2 = explainDrivers({ C: 100 }, { C: null });
    const list3 = explainDrivers({}, {});
    check('currentValue null → delta/pctDelta 모두 null', list1.find((d) => d.column === 'C').delta === null && list1.find((d) => d.column === 'C').pctDelta === null);
    check('priorAvgValue null → delta/pctDelta 모두 null', list2.find((d) => d.column === 'C').delta === null && list2.find((d) => d.column === 'C').pctDelta === null);
    check('둘 다 없는 빈 객체끼리 비교해도 크래시 없음(전부 null)', list3.every((d) => d.delta === null && d.pctDelta === null));
  }
  {
    // null delta는 정렬 시 |delta| 0으로 취급되어 실제 delta가 있는 항목보다 뒤로 밀린다(?? 0 fallback).
    const current = { C: 100, E: null };
    const priorAvg = { C: 90, E: null };
    const list = explainDrivers(current, priorAvg);
    check('delta:null 항목도 결과에 포함되고 NaN 없이 정렬됨', list.every((d) => d.delta === null || Number.isFinite(d.delta)));
    const eIdx = list.findIndex((d) => d.column === 'E');
    const cIdx = list.findIndex((d) => d.column === 'C');
    check('delta 있는 C가 delta:null인 E보다 앞에 옴', cIdx < eIdx, JSON.stringify(list.map((d) => d.column)));
  }
  {
    // pctDelta: currentValue와 priorAvgValue가 부호가 반대여도(음수 priorAvg) Math.abs(priorAvgValue) 정규화 확인.
    const list = explainDrivers({ C: 10 }, { C: -100 });
    const c = list.find((d) => d.column === 'C');
    check('delta = 10-(-100) = 110', c.delta === 110);
    check('pctDelta = 110/abs(-100) = 1.1(음수 분모도 절대값으로 정규화)', Math.abs(c.pctDelta - 1.1) < 1e-9, `actual=${c.pctDelta}`);
  }

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
