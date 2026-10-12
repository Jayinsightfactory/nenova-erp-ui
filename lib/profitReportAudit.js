import { EXTRA_CATEGORY } from './profitReportClassification.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const nonZero = (v) => Math.abs(n0(v)) > 0.001;

const SOURCE_ENTRY_START_MAJOR = {
  호주: { H: 28, R: 28 },
  베트남: { H: 29, R: 29 },
};

/** 주차별 매출이익 보고서의 원천 완전성 검사.
 * 자동 원천값이 있으면 정상으로 인정하고, 실제로 원천이 비어 계산할 수 없는 경우만 검증 대상으로 남긴다.
 * E/F/H/R/S 수기 보정은 예외 입력이며 자동값 자체를 오류로 취급하지 않는다.
 * 국가별 원천 입력 시작 차수 전에는 해당 국가의 H/R 미입력을 정상적인 미적용 상태로 본다. */
export function buildProfitReportAudit(rows = [], context = {}) {
  const issues = [];
  const reportMajor = Number(context.major);
  const shouldAuditSource = (category, column) => {
    const startMajor = SOURCE_ENTRY_START_MAJOR[category]?.[column];
    return !(Number.isFinite(reportMajor) && Number.isFinite(startMajor) && reportMajor < startMajor);
  };
  const add = (severity, code, row, columns, message) => issues.push({
    severity, code, category: row.category, columns, message,
  });

  for (const row of rows) {
    const auto = row.auto || {};
    const manual = row.manual || {};
    const source = row.source || {};
    const stock = row.stock || {};
    const active = [auto.N, auto.L, auto.O, auto.Q, auto.S, stock.endQty, manual.E, manual.F]
      .some(nonZero);

    if (row.category === EXTRA_CATEGORY && active) {
      // 미분류는 원본 본표에 없는 행이다. 검증 목록·비고에는 보이되 공식 합계(C/D/I/J/K)에는
      // 절대 넣지 않는다(lib/profitReportCalc.js computeProfitTotals). 자동으로 정식 카테고리에
      // 합산하지도 않으며, 분류를 고치기 전까지 audit-only 영역으로만 남긴다.
      add('error', 'UNCLASSIFIED_DATA', row, ['C', 'Q', 'S'],
        '국가·화종 매핑에 들지 않은 거래가 있습니다. 이 금액은 보고서 공식 합계에서 제외되어 있으니, 원본 품목의 국가/화종을 정정해야 합니다.');
      continue;
    }
    if (row.category === '공제' || !active) continue;

    if (n0(stock.endQty) < -0.001 || n0(stock.negativeQty) > 0.001) {
      add('error', 'NEGATIVE_STOCK', row, ['F'],
        '전산 기말재고에 음수 품목이 있습니다. 재고조정 이력과 해당 품목의 실재고를 확인해야 합니다.');
    }

    if (row.variant !== 'noEnding' && manual.E == null && source.E === 'missing_stock_snapshot') {
      add('error', 'STOCK_BEGIN_SNAPSHOT_MISSING', row, ['E'],
        '전차수의 ProductStock 재고 스냅샷이 없어 기초재고를 자동 계산할 수 없습니다. 전차수 재고계산을 확인해야 합니다.');
    }
    if (row.variant !== 'noEnding' && manual.F == null && source.F === 'missing_stock_snapshot') {
      add('error', 'STOCK_END_SNAPSHOT_MISSING', row, ['F'],
        '이번 차수의 ProductStock 재고 스냅샷이 없어 기말재고를 자동 계산할 수 없습니다. 해당 차수 재고계산을 확인해야 합니다.');
    }

    if (manual.H == null && shouldAuditSource(row.category, 'H') && (source.H === 'missing' || source.H === 'partial')) {
      if (source.H === 'missing' && !nonZero(auto.Q)) {
        // 이 차수 구매(입고)가 아예 없는 국가 — 재고 판매분이라 통관비 0 이 정상일 수 있음 (예: 28차 호주)
        add('warning', 'CUSTOMS_NO_PURCHASE', row, ['H'],
          '이 차수 구매(입고)가 없어 그외통관비 0으로 계산됩니다 — 이전 차수 재고 판매분이면 정상입니다.');
      } else {
        add('error', 'CUSTOMS_INCOMPLETE', row, ['H'],
          source.H === 'partial' ? '그외통관비가 일부 반차수만 저장되었습니다.' : '그외통관비 원천값이 없어 H가 0으로 계산됩니다. (구매는 있는데 입고 GW 라인도 없음 — 입고관리 확인 필요)');
      }
    }
    if (shouldAuditSource(row.category, 'R') && (nonZero(auto.Q) || nonZero(auto.S)) && manual.R == null && !nonZero(auto.R)) {
      // 과세환율은 통관 신고 주차 기준이라 CurrencyMaster 현재값이나 전차수 값으로 자동 상속하지
      // 않는다. 원천이 없으면 그대로 누락으로 남기고 담당자가 그 주차 과세환율을 입력하게 한다.
      add('warning', 'INVOICE_RATE_MISSING', row, ['R'],
        `${row.currency || 'USD'} 과세환율 원천(입고 통관 스냅샷·그 주차 저장값)이 없어 매입원가를 계산할 수 없습니다. 해당 차수 관세청 과세환율을 입력해야 합니다.`);
    }

    if (nonZero(stock.endQty) && manual.F == null && source.F === 'auto_unverified_snapshot') {
      add('warning', 'STOCK_SNAPSHOT_UNVERIFIED', row, ['F'],
        '기말재고 실사 앵커가 없어 전산 스냅샷으로 자동 평가했습니다. 실제 재고수량과 대조가 필요합니다.');
    }

    // F는 Σ(기말수량 × 품목별 재고평가단가) ÷ 1.1 로 계산한다. 재고평가단가를 하나도 찾지 못해
    // 최근 매입단가(recentCost) fallback으로 넘어간 경우, 그 fallback에서도 단가를 못 찾은 품목은
    // 수량만큼 0으로 조용히 빠진다. 값을 추정해 채우지 않고 needs_input으로 명시한다.
    const usesRecentCostFallback = !nonZero(stock.tableF);
    if (usesRecentCostFallback && manual.F == null && n0(stock.recentCostMissingQty) > 0.001) {
      add('error', 'RECENT_COST_MISSING_ITEMS', row, ['F'],
        `기말재고 평가(F)에 재고평가단가도 최근 매입단가도 찾지 못한 품목이 있어 수량 약 ${Math.round(n0(stock.recentCostMissingQty)).toLocaleString()} 만큼 0으로 누락되었습니다. 재고단가표에서 단가를 지정하거나 해당 품목의 입고 이력을 확인해야 합니다.`);
    }
    // 재고수량은 있는데 평가금액이 0이면 평가단가 원천 자체가 없다는 뜻이다 — 조용히 0으로 두지 않는다.
    if (nonZero(stock.endQty) && manual.F == null && !nonZero(stock.tableF) && !nonZero(stock.recentCost)) {
      add('error', 'STOCK_VALUATION_PRICE_MISSING', row, ['F'],
        '기말재고 수량은 있는데 품목별 재고평가단가 원천이 없습니다. 재고단가표(WebStockPrice)나 품목 원가를 확인해야 합니다.');
    }
  }

  const errorCount = issues.filter((x) => x.severity === 'error').length;
  const warningCount = issues.filter((x) => x.severity === 'warning').length;
  return {
    status: errorCount ? 'needs_input' : warningCount ? 'needs_review' : 'ready',
    errorCount,
    warningCount,
    issues,
  };
}
