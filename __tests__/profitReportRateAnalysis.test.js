// lib/profitReportRateAnalysis.js 회귀 검증 — K(매출이익률) 추세 오케스트레이션(같은 OrderYear 안에서만
// 직전 최대 4개 차수, 연도 경계 wrap-around 금지) + 순수 요약/판정 함수.
//
// DB 목킹 방법 감사 메모: loadWeekK()가 직접 import하는 getActiveConfirm(lib/profitReportConfirm.js)와
// loadReportData(pages/api/sales/profit-report.js)는 둘 다 lib/db.js#query를 모듈 최상단에서 직접
// 호출하고 tQ를 인자로 주입받지 않는다 — 이 저장소의 기존 DB 목킹 패턴(tQ 함수 인자 대체,
// syncShipmentDateEst.test.js)을 그대로 쓸 수 없다. __tests__/kcsRatesByCategoryWeighting.test.js에서
// 검증한 것과 같은 node:module register() 리졸브 훅 기법(__tests__/fixtures/
// profitReportRateAnalysisLoaderHook.mjs)으로 이 두 함수만 목으로 교체해 loadWeekK/loadRateTrend를
// 실제로(오케스트레이션 포함) 엔드투엔드 검증한다 — "커버 못 함" 문서화 대신 실제 커버.
//
// 실행: node __tests__/profitReportRateAnalysis.test.js
import { register } from 'node:module';

register('./fixtures/profitReportRateAnalysisLoaderHook.mjs', import.meta.url);

let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

// computeProfitRow()가 크래시하지 않을 최소 유효 row(라이브 경로 테스트용). K 계산에 필요한
// N/L/O/Q/R/H/S/E/F 자동값만 채운다 — auto.E/F 등을 0으로 둬 기초/기말재고 자동계산 분기를 건드리지 않는다.
function makeRow(category, { N = 1000, L = 0, O = 0, Q = 500, R = 1300, H = 0, S = 0 } = {}) {
  return { category, manual: {}, auto: { N, L, O, Q, R, H, S, E: 0, F: 0 }, stock: null };
}

async function main() {
  const { loadWeekK, summarizeRateTrend, loadRateTrend, findRateAndStockGapWeeks, isProvisional } =
    await import('../lib/profitReportRateAnalysis.js');

  console.log('=== summarizeRateTrend — pp diff / priorCount / 0 분모 안전성(순수 함수) ===');
  {
    const r = summarizeRateTrend({ major: '28', K: 0.20 }, [{ major: '27', K: 0.18 }, { major: '26', K: 0.16 }]);
    check('avgPriorK = (0.18+0.16)/2 = 0.17', Math.abs(r.avgPriorK - 0.17) < 1e-9, `actual=${r.avgPriorK}`);
    check('ppDiff = (0.20-0.17)*100 = 3.00pp', r.ppDiff === 3, `actual=${r.ppDiff}`);
    check('priorCount = 2', r.priorCount === 2);
    check('priorScanned = 2', r.priorScanned === 2);
  }
  {
    // 4개 중 2개만 K 있음(나머지 null) — priorCount는 실제 유효 개수만, priorScanned는 시도한 전체.
    const r = summarizeRateTrend(
      { major: '05', K: 0.10 },
      [{ major: '04', K: 0.08 }, { major: '03', K: null }, { major: '02', K: 0.12 }, { major: '01', K: null }],
    );
    check('K 없는 prior(null) 2개는 평균에서 제외', r.priorCount === 2, `actual=${r.priorCount}`);
    check('priorScanned은 시도한 4개 그대로', r.priorScanned === 4);
    check('avgPriorK = (0.08+0.12)/2 = 0.10', Math.abs(r.avgPriorK - 0.10) < 1e-9, `actual=${r.avgPriorK}`);
  }
  {
    // 모든 prior가 null — 0으로 나누거나 크래시하지 않고 avgPriorK:null, ppDiff:null.
    const r = summarizeRateTrend({ major: '02', K: 0.15 }, [{ major: '01', K: null }]);
    check('전부 K 없음 → avgPriorK:null(0-division 없음)', r.avgPriorK === null);
    check('avgPriorK 없으면 ppDiff도 null', r.ppDiff === null);
    check('priorCount = 0', r.priorCount === 0);
  }
  {
    // priorWeeks 자체가 빈 배열/비배열이어도 크래시하지 않음.
    check('priorWeeks=[] → avgPriorK:null, priorCount:0', (() => {
      const r = summarizeRateTrend({ major: '01', K: 0.1 }, []);
      return r.avgPriorK === null && r.priorCount === 0 && r.priorScanned === 0;
    })());
    check('priorWeeks=undefined도 배열처럼 안전 처리', (() => {
      const r = summarizeRateTrend({ major: '01', K: 0.1 }, undefined);
      return r.avgPriorK === null && r.priorCount === 0;
    })());
  }
  {
    // currentWeek.K가 null이면 ppDiff도 null(현재값 없이 비교 불가).
    const r = summarizeRateTrend({ major: '05', K: null }, [{ major: '04', K: 0.1 }]);
    check('currentK 없음 → currentK:null, ppDiff:null', r.currentK === null && r.ppDiff === null);
  }

  console.log('\n=== findRateAndStockGapWeeks — R 결측/재고 갭 주차 스캔(순수 함수) ===');
  {
    const weeks = [
      { major: '28', auditIssues: [{ code: 'TAXABLE_RATE_MISSING', severity: 'error' }] },
      { major: '27', auditIssues: [{ code: 'STOCK_BEGIN_SNAPSHOT_MISSING', severity: 'warning' }] },
      { major: '26', auditIssues: [{ code: 'STOCK_END_SNAPSHOT_MISSING', severity: 'warning' }] },
      { major: '25', auditIssues: [{ code: 'STOCK_VALUATION_MISSING', severity: 'warning' }] },
      { major: '24', auditIssues: [] },
      { major: '23', auditIssues: [{ code: 'SOME_OTHER_CODE', severity: 'error' }] },
    ];
    const { missingRateWeeks, stockGapWeeks } = findRateAndStockGapWeeks(weeks);
    check('missingRateWeeks = [28]', JSON.stringify(missingRateWeeks) === JSON.stringify(['28']), JSON.stringify(missingRateWeeks));
    check('stockGapWeeks = [27,26,25] (3개 코드 모두 인식)', JSON.stringify(stockGapWeeks) === JSON.stringify(['27', '26', '25']), JSON.stringify(stockGapWeeks));
    check('빈 배열/무관 코드 주차는 어느 목록에도 없음', !missingRateWeeks.includes('24') && !stockGapWeeks.includes('24') && !missingRateWeeks.includes('23') && !stockGapWeeks.includes('23'));
  }
  check('weeks=[] → 둘 다 빈 배열', (() => {
    const r = findRateAndStockGapWeeks([]);
    return r.missingRateWeeks.length === 0 && r.stockGapWeeks.length === 0;
  })());
  check('weeks=undefined도 안전', (() => {
    const r = findRateAndStockGapWeeks(undefined);
    return r.missingRateWeeks.length === 0 && r.stockGapWeeks.length === 0;
  })());

  console.log('\n=== isProvisional — audit error/R결측/재고갭 중 하나라도 있으면 true(순수 함수) ===');
  check('전부 clear → false', isProvisional({ auditIssues: [], missingRateWeeks: [], stockGapWeeks: [] }) === false);
  check('warning severity만 있으면 false(error만 확정 차단)', isProvisional({ auditIssues: [{ severity: 'warning' }] }) === false);
  check('error severity 하나만 있어도 true', isProvisional({ auditIssues: [{ severity: 'error' }] }) === true);
  check('missingRateWeeks 하나만 있어도 true', isProvisional({ missingRateWeeks: ['28'] }) === true);
  check('stockGapWeeks 하나만 있어도 true', isProvisional({ stockGapWeeks: ['27'] }) === true);
  check('세 조건 모두 있어도 true(중복 무관)', isProvisional({ auditIssues: [{ severity: 'error' }], missingRateWeeks: ['28'], stockGapWeeks: ['27'] }) === true);
  check('인자 없음(default {}) → false, 크래시 없음', isProvisional() === false);

  console.log('\n=== loadWeekK — snapshot 우선, 없으면 live 폴백, 둘 다 실패하면 missing(절대 throw 안 함) ===');
  {
    globalThis.__mockGetActiveConfirm = async () => ({
      initialized: true,
      confirm: { auditIssues: [{ code: 'X', severity: 'warning' }] },
      totalsCalc: { K: 0.21 },
    });
    globalThis.__mockLoadReportData = async () => { throw new Error('should not be called — snapshot must win'); };
    const r = await loadWeekK('2026', '28');
    check('활성 확정 스냅샷이 있으면 source=snapshot', r.source === 'snapshot' && r.K === 0.21, JSON.stringify(r));
    check('major는 2자리 패딩(28→"28", 숫자 8→"08")', r.major === '28');
  }
  {
    globalThis.__mockGetActiveConfirm = async () => ({ initialized: true, confirm: { auditIssues: [] }, totalsCalc: { K: 0.05 } });
    const r = await loadWeekK('2026', 8);
    check('숫자 major(8)도 "08"로 패딩', r.major === '08');
  }
  {
    globalThis.__mockGetActiveConfirm = async () => ({ initialized: true, confirm: null }); // 활성 스냅샷 없음
    globalThis.__mockLoadReportData = async () => ({
      rows: [makeRow('태국', { N: 2000, Q: 1000, R: 1300 })],
      audit: { issues: [{ code: 'Y', severity: 'warning' }] },
    });
    const r = await loadWeekK('2026', '27');
    check('스냅샷 없으면 라이브 계산으로 폴백(source=live)', r.source === 'live', JSON.stringify(r));
    check('라이브 totals.K가 숫자로 산출됨', typeof r.K === 'number' && Number.isFinite(r.K), `K=${r.K}`);
    check('라이브 경로의 auditIssues는 data.audit.issues', JSON.stringify(r.auditIssues) === JSON.stringify([{ code: 'Y', severity: 'warning' }]));
  }
  {
    globalThis.__mockGetActiveConfirm = async () => { throw new Error('confirm schema down'); }; // 확정 조회 자체가 실패
    globalThis.__mockLoadReportData = async () => ({ rows: [makeRow('태국')], audit: { issues: [] } });
    const r = await loadWeekK('2026', '26');
    check('getActiveConfirm이 throw해도 라이브로 폴백(전체 실패 아님)', r.source === 'live' && typeof r.K === 'number', JSON.stringify(r));
  }
  {
    globalThis.__mockGetActiveConfirm = async () => ({ initialized: false, confirm: null });
    globalThis.__mockLoadReportData = async () => { throw new Error('DB down'); };
    const r = await loadWeekK('2026', '25');
    check('스냅샷도 라이브도 실패 → source=missing, K=null(throw 안 함)', r.source === 'missing' && r.K === null, JSON.stringify(r));
    check('missing 응답에 error 메시지 포함', typeof r.error === 'string' && r.error.includes('DB down'));
  }

  console.log('\n=== loadRateTrend — 같은 OrderYear 안에서만 직전 최대 4개(연도 경계 wrap-around 금지) ===');
  {
    globalThis.__rateAnalysisCallLog = [];
    globalThis.__mockGetActiveConfirm = async (orderYear, major) => ({
      initialized: true,
      confirm: { auditIssues: [] },
      totalsCalc: { K: { '30': 0.22, '29': 0.20, '28': 0.19, '27': 0.18, '26': 0.17 }[major] ?? null },
    });
    const trend = await loadRateTrend('2026', '30');
    const requestedMajors = globalThis.__rateAnalysisCallLog.filter((c) => c.fn === 'getActiveConfirm').map((c) => c.major);
    check('직전 4개(29,28,27,26) + 현재(30) = 5개 요청', requestedMajors.length === 5, JSON.stringify(requestedMajors));
    check('26차보다 이전(25 등)은 요청하지 않음(최대 4개 제한)', !requestedMajors.includes('25'));
    check('모든 요청이 같은 orderYear(2026)', globalThis.__rateAnalysisCallLog.every((c) => c.orderYear === '2026'));
    check('trend.yearBoundaryLimited = false(4개 꽉 참)', trend.trend.yearBoundaryLimited === false);
    check('currentWeek.K = 0.22', trend.currentWeek.K === 0.22);
    check('priorWeeks 4개, major 내림차순(29,28,27,26)', trend.priorWeeks.map((p) => p.major).join(',') === '29,28,27,26');
    check('_detail.priorTotalsList 길이 4(공개 응답 shape 밖 내부 재사용 데이터)', trend._detail.priorTotalsList.length === 4);
  }
  {
    // 연도 경계: major='02'는 prior '01' 하나뿐 — 전년도 52차로 넘어가지 않는다(명시 요구사항).
    globalThis.__rateAnalysisCallLog = [];
    globalThis.__mockGetActiveConfirm = async (orderYear, major) => ({
      initialized: true,
      confirm: { auditIssues: [] },
      totalsCalc: { K: { '02': 0.15, '01': 0.10 }[major] ?? null },
    });
    const trend = await loadRateTrend('2026', '02');
    const requestedMajors = globalThis.__rateAnalysisCallLog.filter((c) => c.fn === 'getActiveConfirm').map((c) => c.major);
    check('major=02 → 요청은 02,01 딱 2개뿐(52 wrap-around 없음)', JSON.stringify(requestedMajors.sort()) === JSON.stringify(['01', '02']), JSON.stringify(requestedMajors));
    check('전년도(2025) 요청이 전혀 없음(cross-year 격리)', !globalThis.__rateAnalysisCallLog.some((c) => c.orderYear === '2025'));
    check('"52"차는 절대 요청되지 않음(wrap-around 가드)', !requestedMajors.includes('52'));
    check('priorWeeks는 [01] 하나뿐', trend.priorWeeks.length === 1 && trend.priorWeeks[0].major === '01');
    check('trend.yearBoundaryLimited = true(4개 미만)', trend.trend.yearBoundaryLimited === true);
    check('trend.avgPriorK = 0.10(prior 1개 그대로)', trend.trend.avgPriorK === 0.10);
  }
  {
    // major='01' — prior가 아예 없음(0개), wrap-around 없이 currentWeek만.
    globalThis.__rateAnalysisCallLog = [];
    globalThis.__mockGetActiveConfirm = async () => ({ initialized: true, confirm: { auditIssues: [] }, totalsCalc: { K: 0.11 } });
    const trend = await loadRateTrend('2026', '01');
    const requestedMajors = globalThis.__rateAnalysisCallLog.filter((c) => c.fn === 'getActiveConfirm').map((c) => c.major);
    check('major=01 → 요청은 01 하나뿐(prior 0개)', requestedMajors.length === 1 && requestedMajors[0] === '01', JSON.stringify(requestedMajors));
    check('priorWeeks = []', trend.priorWeeks.length === 0);
    check('trend.avgPriorK = null(prior 없음)', trend.trend.avgPriorK === null);
  }

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
