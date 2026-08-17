import { CATEGORY_AVERAGE_INVENTORY_KEYS } from './profitReportCalc.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const nonZero = (v) => Math.abs(n0(v)) > 0.001;

/**
 * 국가별 "그외통관비(H) 입력 화면" 도입 차수.
 *
 * 2026-08-12 정정: 이 표는 **H에만** 적용한다. 과세환율 R은 그 국가에 구매(매입 Q)나 포워딩(S)이
 * 있으면 차수와 무관하게 반드시 있어야 하는 값이다 — 원본 엑셀 22~27차에도 호주 구매가 있는 차수
 * (23/24/27차)에는 AUD R이 존재한다(각각 1079.48 / 1083.36 / 1068.23). 이전 구현은 호주 R까지
 * 28차 전이면 감사하지 않아, 구매가 있는데 환율이 없는 행을 조용히 통과시켰다.
 */
const CUSTOMS_ENTRY_START_MAJOR = {
  호주: 28,
  베트남: 29,
};

/** 원본 엑셀 본표에 행 자체가 없는 웹 전용 audit 행 — 본표 합계에 넣지 않고 검증 목록에만 남긴다. */
export const AUDIT_ONLY_CATEGORY = '기타(미분류)';

/** 주차별 매출이익 보고서의 원천 완전성 검사.
 * 자동 원천값이 있으면 정상으로 인정하고, 실제로 원천이 비어 계산할 수 없는 경우만 검증 대상으로 남긴다.
 * E/F는 확정 재고+시점 단가 전용이고 H/R/S만 외부 증거를 갖춘 예외 입력을 허용한다. */
export function buildProfitReportAudit(rows = [], context = {}) {
  const issues = [];
  const reportMajor = Number(context.major);
  const forwardingLedger = context.forwardingLedger || null;
  const strictForwarding = Number.isFinite(reportMajor) && reportMajor >= 29;
  const shouldAuditCustoms = (category) => {
    const startMajor = CUSTOMS_ENTRY_START_MAJOR[category];
    return !(Number.isFinite(reportMajor) && Number.isFinite(startMajor) && reportMajor < startMajor);
  };
  const usesCategoryAverageInventory = (category) => CATEGORY_AVERAGE_INVENTORY_KEYS.includes(String(category || ''));
  const add = (severity, code, row, columns, message) => issues.push({
    severity, code, category: row.category, columns, message,
  });

  for (const row of rows) {
    const auto = row.auto || {};
    const manual = row.manual || {};
    const source = row.source || {};
    const stock = row.stock || {};
    const active = [auto.N, auto.L, auto.O, auto.Q, auto.S, auto.E, auto.F, stock.endQty]
      .some(nonZero);

    if (row.category === AUDIT_ONLY_CATEGORY && active) {
      add('error', 'UNCLASSIFIED_DATA', row, ['C', 'Q', 'S'],
        '국가·화종 매핑에 들지 않은 거래가 있습니다. 이 행은 본표 합계(C/D/I/J/K)에 포함되지 않으며, 원본 품목의 국가/화종을 정정해야 정식 카테고리로 반영됩니다.');
      continue;
    }
    if (row.category === '공제' || !active) continue;

    if (n0(stock.endQty) < -0.001 || n0(stock.negativeQty) > 0.001) {
      add('error', 'NEGATIVE_STOCK', row, ['F'],
        '전산 기말재고에 음수 품목이 있습니다. 재고조정 이력과 해당 품목의 실재고를 확인해야 합니다.');
    }

    if (row.variant !== 'noEnding' && source.E === 'missing_stock_snapshot') {
      add('error', 'STOCK_BEGIN_SNAPSHOT_MISSING', row, ['E'],
        '전차수의 ProductStock 재고 스냅샷이 없어 기초재고를 자동 계산할 수 없습니다. 전차수 재고계산을 확인해야 합니다.');
    }
    if (row.variant !== 'noEnding' && source.F === 'missing_stock_snapshot') {
      add('error', 'STOCK_END_SNAPSHOT_MISSING', row, ['F'],
        '이번 차수의 ProductStock 재고 스냅샷이 없어 기말재고를 자동 계산할 수 없습니다. 해당 차수 재고계산을 확인해야 합니다.');
    }
    const beginConversionMissing = Number(row.beginStock?.conversionMissingCount || 0);
    const endConversionMissing = Number(stock.conversionMissingCount || 0);
    const formatConversionIssues = (items) => (items || []).slice(0, 5)
      .map(item => `품목번호 ${item.prodKey}(${item.outUnit || '?'}→${item.estUnit || '?'})`).join(', ');
    if (row.variant !== 'noEnding' && source.E === 'missing_price_evidence' && beginConversionMissing > 0) {
      add('error', 'STOCK_BEGIN_UNIT_CONVERSION_MISSING', row, ['E'],
        `기초재고 품목 ${beginConversionMissing.toLocaleString()}건의 단위 환산 근거가 없습니다: ${formatConversionIssues(row.beginStock?.conversionIssues)}. 품목 마스터의 박스·단·송이 환산값을 확인해야 합니다.`);
    } else if (row.variant !== 'noEnding' && source.E === 'missing_price_evidence'
      && usesCategoryAverageInventory(row.category) && row.beginStock?.unitMismatch) {
      add('error', 'STOCK_BEGIN_UNIT_MIXED', row, ['E'],
        '기초재고와 매입수량의 금액단위가 혼재되어 카테고리 평균원가 공식을 적용할 수 없습니다. 품목별 검증 단가 근거가 필요합니다.');
    } else if (row.variant !== 'noEnding' && source.E === 'missing_price_evidence') {
      add('error', 'STOCK_BEGIN_PRICE_EVIDENCE_MISSING', row, ['E'],
        '기초 재고수량은 있지만 전차수 확정 스냅샷 시점의 VERIFIED 품목 단가 근거가 부족합니다. E 최종값을 직접 입력하지 말고 품목 단가 근거를 등록해야 합니다.');
    }
    if (row.variant !== 'noEnding' && source.F === 'missing_price_evidence' && nonZero(stock.endQty) && endConversionMissing > 0) {
      add('error', 'STOCK_END_UNIT_CONVERSION_MISSING', row, ['F'],
        `기말재고 품목 ${endConversionMissing.toLocaleString()}건의 단위 환산 근거가 없습니다: ${formatConversionIssues(stock.conversionIssues)}. 품목 마스터의 박스·단·송이 환산값을 확인해야 합니다.`);
    } else if (row.variant !== 'noEnding' && source.F === 'missing_price_evidence' && nonZero(stock.endQty)
      && usesCategoryAverageInventory(row.category) && stock.unitMismatch) {
      add('error', 'STOCK_END_UNIT_MIXED', row, ['F'],
        '기말재고와 매입수량의 금액단위가 혼재되어 카테고리 평균원가 공식을 적용할 수 없습니다. 품목별 검증 단가 근거가 필요합니다.');
    } else if (row.variant !== 'noEnding' && source.F === 'missing_price_evidence' && nonZero(stock.endQty)) {
      add('error', 'STOCK_END_PRICE_EVIDENCE_MISSING', row, ['F'],
        `기말 재고수량은 있지만 동일 스냅샷 시점의 VERIFIED 품목 단가 근거가 ${Number(stock.missingPriceCount || 0).toLocaleString()}건 부족합니다. F 최종값을 직접 입력하지 말고 품목 단가 근거를 등록해야 합니다.`);
    }

    if (manual.H == null && shouldAuditCustoms(row.category) && (source.H === 'missing' || source.H === 'partial')) {
      if (source.H === 'missing' && !nonZero(auto.Q)) {
        // 이 차수 구매(입고)가 아예 없는 국가 — 재고 판매분이라 통관비 0 이 정상일 수 있음 (예: 28차 호주)
        add('warning', 'CUSTOMS_NO_PURCHASE', row, ['H'],
          '이 차수 구매(입고)가 없어 그외통관비 0으로 계산됩니다 — 이전 차수 재고 판매분이면 정상입니다.');
      } else {
        add('error', 'CUSTOMS_INCOMPLETE', row, ['H'],
          source.H === 'partial' ? '그외통관비가 일부 반차수만 저장되었습니다.' : '그외통관비 원천값이 없어 H가 0으로 계산됩니다. (구매는 있는데 입고 GW 라인도 없음 — 입고관리 확인 필요)');
      }
    }
    // R 과세환율 — 구매(Q)나 포워딩(S)이 있으면 차수와 무관하게 반드시 필요하다(호주 AUD 포함).
    // 현재 CurrencyMaster 값은 자동 적용하지 않으므로, 원천이 없으면 여기서 반드시 드러난다.
    if ((nonZero(auto.Q) || nonZero(auto.S)) && manual.R == null && !nonZero(auto.R)) {
      const hint = (row.rateSuggestions || []).length
        ? ' 화면의 참고값(전차수·통화마스터)은 제안일 뿐이라 적용·저장해야 계산에 들어갑니다.'
        : '';
      add('error', 'TAXABLE_RATE_MISSING', row, ['R'],
        `이 차수의 ${row.currency || 'USD'} 과세환율(관세청 신고환율) 원천이 없어 매입원가(P/T)를 계산할 수 없습니다. 통관 신고 환율을 입력해야 합니다.${hint}`);
    }

    // 29차 이후에는 항공료 전표가 입고 원장에 존재한다는 운영 계약이다. 구매가 있는데 S 원천이
    // missing/partial이면 수기 0으로 통과시키지 않고 자동분류 결함으로 중단한다.
    if (strictForwarding && nonZero(auto.Q) && manual.S == null && (source.S === 'missing' || source.S === 'partial')) {
      add('error', 'FORWARDING_INCOMPLETE', row, ['S'],
        source.S === 'partial'
          ? '항공료 전표가 일부 반차수·품목군만 자동 분류되었습니다. 아래 포워딩 원천 대조 내역의 누락 범위를 확인해야 합니다.'
          : '이 차수에 구매가 있지만 자동 분류된 항공료 전표가 없습니다. 입고 원장의 전표는 존재하므로 품목명·BILL·AWB 국가 매칭을 확인해야 합니다.');
    }

  }

  if (strictForwarding && forwardingLedger) {
    const rowLabel = (item) => `${item.orderWeek || '-'} · ${item.farmName || '-'} · ${item.invoiceNo || item.awb || '-'} · ${item.prodName || '-'} · ${n0(item.amount).toLocaleString()}`;
    const summarizeRows = (items) => (items || []).slice(0, 5).map(rowLabel).join(' / ');
    const extraCount = (items) => Math.max(0, Number(items?.length || 0) - 5);
    const unmatched = forwardingLedger.unmatchedRows || [];
    const zeroValue = forwardingLedger.zeroValueRows || [];
    const missingScopes = forwardingLedger.missingExpectedScopes || [];
    const currencyMismatches = Object.entries(forwardingLedger.totalsByCurrency || {})
      .filter(([, item]) => Math.abs(n0(item.delta)) > 0.01);

    if (unmatched.length) {
      add('error', 'FORWARDING_UNCLASSIFIED', { category: '포워딩 자동분류' }, ['S'],
        `항공료 전표 ${unmatched.length.toLocaleString()}건을 국가·품종에 연결하지 못했습니다. ${summarizeRows(unmatched)}${extraCount(unmatched) ? ` / 외 ${extraCount(unmatched).toLocaleString()}건` : ''}`);
    }
    if (zeroValue.length) {
      add('error', 'FORWARDING_ZERO_VALUE', { category: '포워딩 자동분류' }, ['S'],
        `항공료 품목인데 금액이 0인 전표가 ${zeroValue.length.toLocaleString()}건 있습니다. ${summarizeRows(zeroValue)}${extraCount(zeroValue) ? ` / 외 ${extraCount(zeroValue).toLocaleString()}건` : ''}`);
    }
    if (missingScopes.length) {
      const summary = missingScopes.slice(0, 8).map((item) => `${item.orderWeek} ${item.category}`).join(', ');
      add('error', 'FORWARDING_SCOPE_MISSING', { category: '포워딩 자동분류' }, ['S'],
        `구매는 있는데 항공료 전표가 연결되지 않은 범위가 ${missingScopes.length.toLocaleString()}건입니다: ${summary}${missingScopes.length > 8 ? ` 외 ${(missingScopes.length - 8).toLocaleString()}건` : ''}`);
    }
    if (Math.abs(n0(forwardingLedger.delta)) > 0.01
      || Math.abs(n0(forwardingLedger.classificationDelta)) > 0.01
      || currencyMismatches.length) {
      const details = currencyMismatches.map(([currency, item]) => `${currency} ${n0(item.delta).toLocaleString()}`).join(', ');
      add('error', 'FORWARDING_RECONCILIATION_MISMATCH', { category: '포워딩 자동분류' }, ['S'],
        `항공료 원천행과 분류 합계가 일치하지 않습니다${details ? ` (${details})` : ''}. 전표를 누락하거나 중복 집계한 분류 로직을 확인해야 합니다.`);
    }
  }

  const previousForwardingLedger = context.previousForwardingLedger || null;
  const previousMajor = Number(context.previousMajor);
  if (Number.isFinite(previousMajor) && previousMajor >= 29
    && previousForwardingLedger?.status === 'incomplete') {
    const unmatchedCount = Number(previousForwardingLedger.unmatchedRows?.length || 0);
    const zeroCount = Number(previousForwardingLedger.zeroValueRows?.length || 0);
    const missingCount = Number(previousForwardingLedger.missingExpectedScopes?.length || 0);
    add('error', 'PREVIOUS_FORWARDING_INCOMPLETE', { category: '기초재고 원천' }, ['E'],
      `기초재고 계산 기준인 ${context.previousOrderYear || ''}년 ${previousMajor}차 항공료 원천이 완전하지 않습니다. 미분류 ${unmatchedCount}건, 0원 ${zeroCount}건, 구매범위 누락 ${missingCount}건을 먼저 확인해야 현재 차수 기초재고를 확정할 수 있습니다.`);
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
