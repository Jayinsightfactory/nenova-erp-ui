const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const nonZero = (v) => Math.abs(n0(v)) > 0.001;

/** 주차별 매출이익 보고서의 원천 완전성 검사.
 * 계산 결과를 막지는 않지만, 엑셀에서 사람이 입력했던 H/R/F와 미분류 데이터를 정상 자동값처럼 숨기지 않는다. */
export function buildProfitReportAudit(rows = []) {
  const issues = [];
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

    if (row.category === '기타(미분류)' && active) {
      add('error', 'UNCLASSIFIED_DATA', row, ['C', 'Q', 'S'],
        '국가·화종 매핑에 들지 않은 거래가 있습니다. 원본 품목의 국가/화종을 정정해야 합니다.');
      continue;
    }
    if (row.category === '공제' || !active) continue;

    if (n0(stock.endQty) < -0.001 || n0(stock.negativeQty) > 0.001) {
      add('error', 'NEGATIVE_STOCK', row, ['F'],
        '전산 기말재고에 음수 품목이 있습니다. 재고조정 이력과 해당 품목의 실재고를 확인해야 합니다.');
    }

    if (manual.H == null && (source.H === 'missing' || source.H === 'partial')) {
      add('error', 'CUSTOMS_INCOMPLETE', row, ['H'],
        source.H === 'partial' ? '그외통관비가 일부 반차수만 저장되었습니다.' : '그외통관비 원천값이 없어 H가 0으로 계산됩니다.');
    }
    if (manual.H == null && source.H === 'gw_auto') {
      add('warning', 'CUSTOMS_GW_AUTO', row, ['H'],
        '무게는 입고관리 Gross weight 로 자동 계산했습니다(기준값). 관세·선율·월드운송료 등 나머지 항목은 [📦 그외통관비 입력]에서 입력이 필요합니다.');
    }

    if ((nonZero(auto.Q) || nonZero(auto.S)) && manual.R == null) {
      add('warning', 'INVOICE_RATE_REQUIRED', row, ['R'],
        `청구서 환율이 없어 현재 ${row.currency || 'USD'} 기준환율을 사용 중입니다. 해당 차수 인보이스 환율을 확인해야 합니다.`);
    }

    if (nonZero(stock.endQty) && manual.F == null && source.F === 'auto_unverified_snapshot') {
      add('warning', 'STOCK_SNAPSHOT_UNVERIFIED', row, ['F'],
        '기말재고 실사 앵커가 없어 전산 스냅샷으로 자동 평가했습니다. 실제 재고수량과 대조가 필요합니다.');
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
