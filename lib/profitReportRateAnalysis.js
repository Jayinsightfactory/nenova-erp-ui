// lib/profitReportRateAnalysis.js — 매출이익 보고서: 이번 차수 K(매출이익률) vs 직전 4개 차수 추세.
//
// 읽기 전용(SELECT만). pages/api/sales/profit-analysis.js 가 이 모듈을 호출해 "이번 주차 K가
// 직전 주차들 대비 얼마나 다른가"를 계산한다. 원본 매출이익 보고서(pages/api/sales/profit-report.js)
// 의 응답/계산을 절대 막거나 늦추지 않도록 완전히 별도 엔드포인트에서만 쓰인다.
//
// 비교 범위: 반드시 **같은 OrderYear** 안에서만, 이번 major 바로 앞 최대 4개 차수. major가 작아
// (예: '02') 같은 연도 안에 4개가 안 되면 있는 만큼만 쓰고 전년도로 넘어가지 않는다
// (예: major='02'는 prior '01' 하나뿐 — 전년도 52차로 wrap-around 하지 않는다).
//
// 각 주차(현재 포함, 최대 5개)의 K는:
//   1순위: getActiveConfirm(orderYear, majorN) 활성 확정 스냅샷이 있으면 그 totalsCalc.K → source='snapshot'
//   2순위: 없으면 loadReportData(majorN, orderYear) 라이브 계산 → computeProfitTotals(rows+calc) → source='live'
//          (pages/api/sales/profit-report.js#loadAnnualMonthlyReportData 가 totals를 뽑는 방식과 동일:
//           computeProfitTotals(rows.map(row => ({ ...row, calc: computeProfitRow(row) }))))
//   실패/원천 없음: source='missing', K=null — 단일 주차 실패로 전체를 throw하지 않고 부분 결과를 모은다.
import { getActiveConfirm } from './profitReportConfirm.js';
import { loadReportData } from '../pages/api/sales/profit-report.js';
import { computeProfitRow, computeProfitTotals } from './profitReportCalc.js';

const RATE_MISSING_CODE = 'TAXABLE_RATE_MISSING';
const STOCK_GAP_CODES = new Set(['STOCK_BEGIN_SNAPSHOT_MISSING', 'STOCK_END_SNAPSHOT_MISSING', 'STOCK_VALUATION_MISSING']);

const asFiniteNumber = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/** 지정 차수 하나의 K(매출이익률) 조회 — 확정 스냅샷 우선, 없으면 라이브 계산.
 * 절대 throw하지 않는다: 실패하면 source:'missing', K:null 로 반환해 호출부가 부분 결과를 계속 쓸 수 있게 한다. */
export async function loadWeekK(orderYear, majorN) {
  const majorPadded = String(majorN).padStart(2, '0');
  try {
    const activeConfirm = await getActiveConfirm(String(orderYear), majorPadded);
    if (activeConfirm?.initialized && activeConfirm.confirm) {
      return {
        major: majorPadded,
        K: asFiniteNumber(activeConfirm.totalsCalc?.K),
        source: 'snapshot',
        totals: activeConfirm.totalsCalc || null,
        auditIssues: activeConfirm.confirm.auditIssues || [],
      };
    }
  } catch {
    // 확정 스냅샷 조회 자체가 실패 — 아래 라이브 계산으로 폴백 시도.
  }
  try {
    const data = await loadReportData(majorPadded, orderYear);
    const rowsWithCalc = (data.rows || []).map((row) => ({ ...row, calc: computeProfitRow(row) }));
    const totals = computeProfitTotals(rowsWithCalc);
    return {
      major: majorPadded,
      K: asFiniteNumber(totals.K),
      source: 'live',
      totals,
      auditIssues: data.audit?.issues || [],
    };
  } catch (e) {
    return {
      major: majorPadded, K: null, source: 'missing', totals: null, auditIssues: [],
      error: e?.message || String(e),
    };
  }
}

/** 순수 함수 — currentWeek({major,K,source})과 priorWeeks(Array<{major,K,source}>)로 추세 요약을 계산한다.
 * K가 없는(null) prior는 평균에서 제외하되, "직전 최대 4개 중 실제로 K가 있었던 개수"(priorCount)를
 * 반드시 함께 보고한다 — 결측 주차를 절대 0으로 간주해 평균에 섞지 않는다. */
export function summarizeRateTrend(currentWeek, priorWeeks) {
  const priors = Array.isArray(priorWeeks) ? priorWeeks : [];
  const validPriors = priors.filter((p) => p && asFiniteNumber(p.K) != null);
  const priorCount = validPriors.length;
  const avgPriorK = priorCount > 0
    ? validPriors.reduce((sum, p) => sum + Number(p.K), 0) / priorCount
    : null;
  const currentK = asFiniteNumber(currentWeek?.K);
  // K는 이미 0.18 같은 비율값이므로 pp(퍼센트포인트) 차이는 (현재-평균)*100.
  const ppDiff = currentK != null && avgPriorK != null
    ? Math.round((currentK - avgPriorK) * 100 * 100) / 100 // 0.01pp 단위로 반올림
    : null;
  return {
    currentK,
    avgPriorK,
    ppDiff,
    priorCount,              // K를 실제로 구한 prior 개수(최대 4)
    priorScanned: priors.length, // 같은 연도 경계 안에서 "시도한" prior 개수(연도 초반이면 4 미만)
  };
}

/** 오케스트레이션 — 현재 major + 같은 OrderYear 안의 직전 최대 4개 차수의 K 추세.
 * 읽기 전용, 부분 실패 허용(개별 주차 오류가 전체를 죽이지 않는다). */
export async function loadRateTrend(orderYear, major) {
  const currentMajorNum = Number(major);
  const priorMajorNums = [];
  for (let i = 1; i <= 4; i += 1) {
    const m = currentMajorNum - i;
    if (m < 1) break; // 연도 경계 — 전년도로 넘어가지 않는다(명시 요구사항, wrap-around 금지)
    priorMajorNums.push(m);
  }

  const [currentResult, ...priorResults] = await Promise.all(
    [currentMajorNum, ...priorMajorNums].map((m) => loadWeekK(orderYear, m)),
  );

  const priorWeeks = priorResults.map((r) => ({ major: r.major, K: r.K, source: r.source }));
  const trendCore = summarizeRateTrend(
    { major: currentResult.major, K: currentResult.K, source: currentResult.source },
    priorWeeks,
  );

  return {
    currentWeek: { major: currentResult.major, K: currentResult.K, source: currentResult.source },
    priorWeeks,
    trend: {
      ...trendCore,
      // 같은 연도 안에 4개 미만의 prior만 존재했다는 사실을 명시(전년도로 넘어가지 않았다는 신호).
      yearBoundaryLimited: priorMajorNums.length < 4,
    },
    // 공개 응답 shape(문서화된 { currentWeek, priorWeeks, trend })에는 포함하지 않는 내부 재사용 데이터 —
    // pages/api/sales/profit-analysis.js 가 driver 설명/provisional 판정에 재사용해 DB를 다시 조회하지 않게 한다.
    _detail: {
      currentTotals: currentResult.totals,
      currentAuditIssues: currentResult.auditIssues || [],
      priorTotalsList: priorResults.map((r) => r.totals),
      priorWeeksDetail: priorResults.map((r) => ({ major: r.major, source: r.source, auditIssues: r.auditIssues || [] })),
    },
  };
}

/** 여러 주차의 audit issues를 스캔해 "R(과세환율) 결측/미해결" 주차와 "재고 스냅샷 갭" 주차를 뽑는다.
 * weeks: Array<{ major, auditIssues: Array<{severity,code,...}> }> (buildProfitReportAudit()의 issues 형태) */
export function findRateAndStockGapWeeks(weeks = []) {
  const missingRateWeeks = [];
  const stockGapWeeks = [];
  for (const w of weeks || []) {
    const issues = w?.auditIssues || [];
    if (issues.some((i) => i?.code === RATE_MISSING_CODE)) missingRateWeeks.push(w.major);
    if (issues.some((i) => STOCK_GAP_CODES.has(i?.code))) stockGapWeeks.push(w.major);
  }
  return { missingRateWeeks, stockGapWeeks };
}

/** 이 분석이 잠정치인지 판정.
 * - auditIssues 중 severity==='error' 인 것이 하나라도 있으면 true(경고는 확정을 막지 않는 것과 동일 기준 —
 *   lib/profitReportConfirm.js#confirmSnapshot 도 errorCount>0 만 확정을 막는다).
 * - missingRateWeeks/stockGapWeeks(현재+최대 4개 prior 중 R 결측 또는 재고 스냅샷 갭이 있는 주차) 중
 *   하나라도 있으면 true.
 * 이 값이 true면 호출부(API)는 provisional:true 와 함께 구체적 사유를 응답에 담아야 한다 —
 * 잠정치를 최종치처럼 조용히 보여주지 않는다. */
export function isProvisional({ auditIssues = [], missingRateWeeks = [], stockGapWeeks = [] } = {}) {
  const hasUnresolvedAudit = (auditIssues || []).some((i) => i?.severity === 'error');
  const hasMissingRate = (missingRateWeeks || []).length > 0;
  const hasStockGap = (stockGapWeeks || []).length > 0;
  return Boolean(hasUnresolvedAudit || hasMissingRate || hasStockGap);
}
