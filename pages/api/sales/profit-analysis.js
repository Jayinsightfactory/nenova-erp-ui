// pages/api/sales/profit-analysis.js — 매출이익 보고서용 "이익률 분석" 읽기 전용 API.
//
// GET 전용, SELECT만 수행한다(INSERT/UPDATE/DELETE/MERGE/ensure*/DDL 없음). 기존
// pages/api/sales/profit-report.js 와 **완전히 분리된 별도 엔드포인트**다 — 이 API가 느리거나
// 실패해도 본표(주차별 매출이익 보고서) 응답은 절대 막히거나 늦어지지 않는다. 핸들러 전체를
// try/catch로 감싸 어떤 경우에도 500 스택트레이스가 아니라 깔끔한 JSON을 반환한다.
//
// 요청: GET /api/sales/profit-analysis?year=2026&week=31
//   (profit-report.js 와 동일하게 parseMajor로 week를 해석하고, resolveActiveOrderYear로 연도를 정한다)
//
// 응답 shape(문서화 — 이후 UI 재구성 작업이 이 shape에 의존한다):
// {
//   ok: true,
//   orderYear, major,
//   trend: {
//     currentWeek: { major, K, source },              // source: 'snapshot'|'live'|'missing'
//     priorWeeks: [ { major, K, source }, ... ],       // 같은 OrderYear 안의 직전 최대 4개 차수
//     trend: { avgPriorK, currentK, ppDiff, priorCount },
//   },
//   drivers: [ { column, currentValue, priorAvgValue, delta, pctDelta }, ... ], // C/E/F/P/H/T/L, |delta| 내림차순
//   priceDecreaseCandidates: [ { custKey, prodKey, custName, productName, currentPrice, priorPrice, pctChange, kind, note }, ... ],
//   lowPriceMixCandidates: [ { custKey, prodKey, custName, productName, currentPrice, peerWeightedAvg, peerMedian, shareDeltaPp, kind, note }, ... ],
//   provisional: boolean,       // true면 검증 미해결/데이터 결측이 있다는 뜻 — 최종치로 취급 금지
//   provisionalReasons: [ '...' ],
// }
// 에러: { ok:false, message }
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { parseMajor } from './profit-report';
import { loadCustomerProductSales } from '../../../lib/profitReportCustomerMixSql.js';
import { loadRateTrend, findRateAndStockGapWeeks, isProvisional } from '../../../lib/profitReportRateAnalysis.js';
import { explainDrivers, averageTotals } from '../../../lib/profitReportDriverExplanation.js';
import { detectPriceDecreaseCandidates, detectLowPriceCustomerMixCandidates } from '../../../lib/profitReportPriceMixCandidates.js';

// 가격/구성비 후보 탐지의 품목 스캔 범위를 안전하게 제한한다. loadCustomerProductSales()를
// prodKeys 없이 호출해도 이미 "그 주 확정 출고(ShipmentDetail, isFix=1)"로 스코프가 좁혀져
// 전체 품목 카탈로그 스캔이 아니지만, 그 위에 추가로 이번 주차 매출액 상위 MAX_PRODUCTS개만
// 골라 직전 주차 조회·탐지 대상으로 쓴다 — 롱테일 품목은 표본이 작아 가격/구성 변화 신호가
// 약하고, 상한이 없으면 이론상 한 주에 수백~수천 품목이 섞일 수 있기 때문이다.
const MAX_PRODUCTS = 300;

function prevMajorYear(orderYear, majorNum) {
  // loadReportData()의 E(기초재고) 이월과 동일한 "직전 차수" 정의를 그대로 따른다:
  // 01차의 직전은 전년도 52차, 그 외에는 같은 연도의 (major-1)차.
  const prevOrderYear = majorNum <= 1 ? String(Number(orderYear) - 1) : String(orderYear);
  const prevMajor = majorNum <= 1 ? '52' : String(majorNum - 1).padStart(2, '0');
  return { prevOrderYear, prevMajor };
}

async function loadPriceMixCandidates(orderYear, major) {
  const majorNum = Number(major);
  const { prevOrderYear, prevMajor } = prevMajorYear(orderYear, majorNum);
  try {
    const allCurrentRows = await loadCustomerProductSales(orderYear, major);
    if (!allCurrentRows.length) return { priceDecreaseCandidates: [], lowPriceMixCandidates: [] };

    const amountByProd = new Map();
    for (const r of allCurrentRows) {
      amountByProd.set(r.prodKey, (amountByProd.get(r.prodKey) || 0) + Math.abs(r.amount || 0));
    }
    const topProdKeys = [...amountByProd.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PRODUCTS)
      .map(([prodKey]) => prodKey);
    const topProdKeySet = new Set(topProdKeys);
    const currentRows = allCurrentRows.filter((r) => topProdKeySet.has(r.prodKey));

    const priorRows = topProdKeys.length
      ? await loadCustomerProductSales(prevOrderYear, prevMajor, { prodKeys: topProdKeys })
      : [];

    return {
      priceDecreaseCandidates: detectPriceDecreaseCandidates(currentRows, priorRows),
      lowPriceMixCandidates: detectLowPriceCustomerMixCandidates(currentRows, priorRows),
    };
  } catch {
    // 후보 탐지 실패는 전체 응답을 막지 않는다 — 빈 목록 + provisional 판정에는 별도로 반영하지 않음
    // (trend/drivers 쪽 결측 신호로 이미 provisional이 충분히 드러난다).
    return { priceDecreaseCandidates: [], lowPriceMixCandidates: [] };
  }
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, message: 'Method not allowed' });
    }

    const major = parseMajor(req.query.week);
    if (!major) return res.status(400).json({ ok: false, message: 'week 필요 (예: 27)' });
    const orderYear = resolveActiveOrderYear(`${major}-01`, req.query.year);

    const [rateTrend, priceMix] = await Promise.all([
      loadRateTrend(orderYear, major),
      loadPriceMixCandidates(orderYear, major),
    ]);

    // driver 델타 — loadRateTrend()가 이미 조회해 둔 totals를 재사용한다(DB 재조회 없음).
    const currentTotals = rateTrend._detail.currentTotals || {};
    const priorAvgTotals = averageTotals(rateTrend._detail.priorTotalsList);
    const drivers = explainDrivers(currentTotals, priorAvgTotals);

    // provisional 판정 — 현재 주차의 감사 오류 + (현재+최대 4개 prior) 중 R 결측/재고 스냅샷 갭 +
    // K 자체를 구하지 못한(source==='missing') 주차를 모두 반영한다.
    const allWeeksDetail = [
      { major: rateTrend.currentWeek.major, auditIssues: rateTrend._detail.currentAuditIssues },
      ...rateTrend._detail.priorWeeksDetail,
    ];
    const { missingRateWeeks, stockGapWeeks } = findRateAndStockGapWeeks(allWeeksDetail);
    const missingDataWeeks = [rateTrend.currentWeek, ...rateTrend.priorWeeks]
      .filter((w) => w.source === 'missing')
      .map((w) => w.major);

    const provisional = isProvisional({
      auditIssues: rateTrend._detail.currentAuditIssues,
      missingRateWeeks,
      stockGapWeeks,
    }) || missingDataWeeks.length > 0;

    const provisionalReasons = [];
    if (missingRateWeeks.length) provisionalReasons.push(`과세환율(R) 미확정 주차: ${missingRateWeeks.join(', ')}차`);
    if (stockGapWeeks.length) provisionalReasons.push(`재고 스냅샷 결측 주차: ${stockGapWeeks.join(', ')}차`);
    if (missingDataWeeks.length) provisionalReasons.push(`손익 데이터를 계산하지 못한 주차: ${missingDataWeeks.join(', ')}차`);
    const currentErrorCount = (rateTrend._detail.currentAuditIssues || []).filter((i) => i?.severity === 'error').length;
    if (currentErrorCount > 0) provisionalReasons.push(`이번 차수 검증 오류 ${currentErrorCount}건 미해결`);

    return res.status(200).json({
      ok: true,
      orderYear,
      major,
      trend: {
        currentWeek: rateTrend.currentWeek,
        priorWeeks: rateTrend.priorWeeks,
        trend: rateTrend.trend,
      },
      drivers,
      priceDecreaseCandidates: priceMix.priceDecreaseCandidates,
      lowPriceMixCandidates: priceMix.lowPriceMixCandidates,
      provisional,
      provisionalReasons,
    });
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ ok: false, message: e?.message || '이익률 분석 처리 중 오류가 발생했습니다.' });
  }
});
