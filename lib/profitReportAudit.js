import { CATEGORY_AVERAGE_INVENTORY_KEYS } from './profitReportCalc.js';
import {
  buildColombiaCustomsDetail, buildCountryCustomsDetail, buildStockPriceDetail, buildRateDetail,
  buildForwardingDetail, buildApproxStockDetail, buildFixLink, fmtNum,
} from './profitReportAuditDetails.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const nonZero = (v) => Math.abs(n0(v)) > 0.001;

function formatNamedList(items, render, limit = 8) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return '';
  const shown = rows.slice(0, limit).map(render).filter(Boolean);
  const extra = Math.max(0, rows.length - shown.length);
  return extra ? `${shown.join(', ')} 외 ${extra.toLocaleString()}건` : shown.join(', ');
}

function formatMissingProducts(items) {
  return formatNamedList(items, (item) => {
    const name = String(item.displayName || item.prodName || '').trim();
    const key = item.prodKey != null && String(item.prodKey).trim() !== '' ? String(item.prodKey) : '';
    if (name && key) return `${name}(${key})`;
    if (name) return name;
    if (key) return `품목번호 ${key}`;
    return '';
  });
}

function formatWeeks(weeks) {
  return [...new Set((weeks || []).map((week) => String(week || '').trim()).filter(Boolean))].join(', ');
}

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
  const colombiaSharedCategories = new Set(['콜롬비아 카네이션', '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로']);
  let sharedColombiaCustomsIssue = null;
  let sharedColombiaForwardingIssue = null;
  const reportMajor = Number(context.major);
  const forwardingLedger = context.forwardingLedger || null;
  const strictForwarding = Number.isFinite(reportMajor) && reportMajor >= 29;
  const shouldAuditCustoms = (category) => {
    const startMajor = CUSTOMS_ENTRY_START_MAJOR[category];
    return !(Number.isFinite(reportMajor) && Number.isFinite(startMajor) && reportMajor < startMajor);
  };
  const usesCategoryAverageInventory = (category) => CATEGORY_AVERAGE_INVENTORY_KEYS.includes(String(category || ''));
  const linkCtx = { orderYear: context.orderYear, major: context.major };
  // detail = 표시 전용 상세(요약·있음/없음·영향·고칠 화면). 판정(severity/code/message)은 그대로.
  const add = (severity, code, row, columns, message, detail = null) => issues.push({
    severity, code, category: row.category, columns, message, ...(detail ? { detail } : {}),
  });
  const colombiaHTotal = rows.filter((r) => colombiaSharedCategories.has(r.category))
    .reduce((s, r) => s + n0(r.manual?.H ?? r.auto?.H), 0);

  for (const row of rows) {
    const auto = row.auto || {};
    const manual = row.manual || {};
    const source = row.source || {};
    const stock = row.stock || {};
    const active = [auto.N, auto.L, auto.O, auto.Q, auto.S, auto.E, auto.F, stock.endQty]
      .some(nonZero);

    if (row.category === AUDIT_ONLY_CATEGORY && active) {
      add('error', 'UNCLASSIFIED_DATA', row, ['C', 'Q', 'S'],
        '국가·화종 매핑에 들지 않은 거래가 있습니다. 이 행은 본표 합계(C/D/I/J/K)에 포함되지 않으며, 원본 품목의 국가/화종을 정정해야 정식 카테고리로 반영됩니다.',
        unclassifiedDetail(row));
      continue;
    }
    if (row.category === '공제' || !active) continue;

    if (n0(stock.endQty) < -0.001 || n0(stock.negativeQty) > 0.001) {
      add('error', 'NEGATIVE_STOCK', row, ['F'],
        '전산 기말재고에 음수 품목이 있습니다. 재고조정 이력과 해당 품목의 실재고를 확인해야 합니다.',
        negativeStockDetail(row));
    }

    if (row.variant !== 'noEnding' && source.E === 'missing_stock_snapshot') {
      add('error', 'STOCK_BEGIN_SNAPSHOT_MISSING', row, ['E'],
        '전차수의 ProductStock 재고 스냅샷이 없어 기초재고를 자동 계산할 수 없습니다. 전차수 재고계산을 확인해야 합니다.',
        snapshotDetail(row, 'E'));
    }
    if (row.variant !== 'noEnding' && source.F === 'missing_stock_snapshot') {
      add('error', 'STOCK_END_SNAPSHOT_MISSING', row, ['F'],
        '이번 차수의 ProductStock 재고 스냅샷이 없어 기말재고를 자동 계산할 수 없습니다. 해당 차수 재고계산을 확인해야 합니다.',
        snapshotDetail(row, 'F'));
    }
    const beginConversionMissing = Number(row.beginStock?.conversionMissingCount || 0);
    const endConversionMissing = Number(stock.conversionMissingCount || 0);
    const formatConversionIssues = (items) => (items || []).slice(0, 5)
      .map(item => `품목번호 ${item.prodKey}(${item.outUnit || '?'}→${item.estUnit || '?'})`).join(', ');
    if (row.variant !== 'noEnding' && source.E === 'missing_price_evidence' && beginConversionMissing > 0) {
      add('error', 'STOCK_BEGIN_UNIT_CONVERSION_MISSING', row, ['E'],
        `기초재고 품목 ${beginConversionMissing.toLocaleString()}건의 단위 환산 근거가 없습니다: ${formatConversionIssues(row.beginStock?.conversionIssues)}. 품목 마스터의 박스·단·송이 환산값을 확인해야 합니다.`,
        buildStockPriceDetail(row, 'E', linkCtx));
    } else if (row.variant !== 'noEnding' && source.E === 'missing_price_evidence'
      && usesCategoryAverageInventory(row.category) && row.beginStock?.unitMismatch) {
      add('error', 'STOCK_BEGIN_UNIT_MIXED', row, ['E'],
        '기초재고와 매입수량의 금액단위가 혼재되어 카테고리 평균원가 공식을 적용할 수 없습니다. 품목별 검증 단가 근거가 필요합니다.',
        buildStockPriceDetail(row, 'E', linkCtx));
    } else if (row.variant !== 'noEnding' && source.E === 'missing_price_evidence') {
      const missingBegin = formatMissingProducts(row.beginStock?.missingPriceItems);
      add('error', 'STOCK_BEGIN_PRICE_EVIDENCE_MISSING', row, ['E'],
        missingBegin
          ? `기초 재고수량은 있지만 전차수 확정 스냅샷 시점의 VERIFIED 품목 단가 근거가 없습니다: ${missingBegin}. E 최종값을 직접 입력하지 말고 해당 품목 단가 근거를 등록해야 합니다.`
          : '기초 재고수량은 있지만 전차수 확정 스냅샷 시점의 VERIFIED 품목 단가 근거가 부족합니다. E 최종값을 직접 입력하지 말고 품목 단가 근거를 등록해야 합니다.',
        buildStockPriceDetail(row, 'E', linkCtx));
    }
    if (row.variant !== 'noEnding' && source.F === 'missing_price_evidence' && nonZero(stock.endQty) && endConversionMissing > 0) {
      add('error', 'STOCK_END_UNIT_CONVERSION_MISSING', row, ['F'],
        `기말재고 품목 ${endConversionMissing.toLocaleString()}건의 단위 환산 근거가 없습니다: ${formatConversionIssues(stock.conversionIssues)}. 품목 마스터의 박스·단·송이 환산값을 확인해야 합니다.`,
        buildStockPriceDetail(row, 'F', linkCtx));
    } else if (row.variant !== 'noEnding' && source.F === 'missing_price_evidence' && nonZero(stock.endQty)
      && usesCategoryAverageInventory(row.category) && stock.unitMismatch) {
      add('error', 'STOCK_END_UNIT_MIXED', row, ['F'],
        '기말재고와 매입수량의 금액단위가 혼재되어 카테고리 평균원가 공식을 적용할 수 없습니다. 품목별 검증 단가 근거가 필요합니다.',
        buildStockPriceDetail(row, 'F', linkCtx));
    } else if (row.variant !== 'noEnding' && source.F === 'missing_price_evidence' && nonZero(stock.endQty)) {
      const missingEnd = formatMissingProducts(stock.missingPriceItems);
      add('error', 'STOCK_END_PRICE_EVIDENCE_MISSING', row, ['F'],
        missingEnd
          ? `기말 재고수량은 있지만 동일 스냅샷 시점의 VERIFIED 품목 단가 근거가 없습니다: ${missingEnd}. F 최종값을 직접 입력하지 말고 해당 품목 단가 근거를 등록해야 합니다.`
          : `기말 재고수량은 있지만 동일 스냅샷 시점의 VERIFIED 품목 단가 근거가 ${Number(stock.missingPriceCount || 0).toLocaleString()}건 부족합니다. F 최종값을 직접 입력하지 말고 품목 단가 근거를 등록해야 합니다.`,
        buildStockPriceDetail(row, 'F', linkCtx));
    }

    // 근사치 안내(2026-08-26 방침 "근거 없으면 0 대신 원본공식/근사로 채움") — 값은 계산에
    // 반영됐지만 정확 근거가 아니므로, 단가 근거·통관 신고 환율 입력을 warning으로 권장한다.
    if (row.variant !== 'noEnding' && ['category_average_fallback', 'carried_category_unit_cost', 'sales_price_auto'].includes(source.E)) {
      add('warning', 'STOCK_BEGIN_APPROXIMATED', row, ['E'],
        source.E === 'sales_price_auto'
          ? '기초재고 일부를 판매단가 기준 자동평가로 채웠습니다(사장님 확정 자동처리). 실제 매입근거를 입력하면 정확값으로 대체됩니다.'
          : '기초재고를 근사치(원본공식 확대 또는 전차수 단가 이월)로 채웠습니다. 재고 매입단가 근거를 입력하면 정확값으로 대체됩니다.',
        buildApproxStockDetail(row, 'E', linkCtx));
    }
    if (row.variant !== 'noEnding' && ['category_average_fallback', 'carried_category_unit_cost', 'sales_price_auto'].includes(source.F) && nonZero(stock.endQty)) {
      add('warning', 'STOCK_END_APPROXIMATED', row, ['F'],
        source.F === 'sales_price_auto'
          ? '기말재고 일부를 판매단가 기준 자동평가로 채웠습니다(사장님 확정 자동처리). 실제 매입근거를 입력하면 정확값으로 대체됩니다.'
          : '기말재고를 근사치(원본공식 확대 또는 전차수 단가 이월)로 채웠습니다. 재고 매입단가 근거를 입력하면 정확값으로 대체됩니다.',
        buildApproxStockDetail(row, 'F', linkCtx));
    }
    if (manual.R == null && source.R === 'approximate_currency_master' && (nonZero(auto.Q) || nonZero(auto.S))) {
      add('warning', 'RATE_APPROXIMATED', row, ['R'],
        '정확한 과세환율 원천이 없어 통화마스터 현재 환율을 근사치로 적용했습니다. 통관 신고 환율 확인 후 R 입력칸에서 수정·저장하세요.',
        buildRateDetail(row, { ...linkCtx, approximated: true }));
    }

    if (manual.H == null && shouldAuditCustoms(row.category) && (source.H === 'missing' || source.H === 'partial')) {
      if (source.H === 'missing' && !nonZero(auto.Q)) {
        // 이 차수 구매가 없으면 H=0은 정상이다. 사용자가 처리할 일이 없으므로 검증 목록에 넣지 않는다.
      } else {
        const colombiaWeeks = context.colombiaWeeks || [];
        const missingColombiaGwWeeks = formatWeeks(colombiaWeeks.filter((item) => !(n0(item.gw) > 0) && item.inbound !== false).map((item) => item.orderWeek));
        const message = source.H === 'partial'
          ? `콜롬비아 4품목이 함께 쓰는 그외통관비 원천이 일부 반차수만 저장되었습니다.${missingColombiaGwWeeks ? ` 누락 반차수(입력 화면·전산 입고 모두 GW 없음): ${missingColombiaGwWeeks}.` : ''} 그외통관비 입력 화면에서 해당 반차수 GW/CW와 구성요소를 한 번만 확인하세요.`
          : `콜롬비아 4품목이 함께 쓰는 그외통관비 원천이 없습니다.${missingColombiaGwWeeks ? ` 누락 반차수(입력 화면·전산 입고 모두 GW 없음): ${missingColombiaGwWeeks}.` : ''} 그외통관비 입력 화면에서 누락된 반차수 GW/CW와 구성요소를 한 번만 확인하세요.`;
        if (colombiaSharedCategories.has(row.category)) {
          sharedColombiaCustomsIssue = sharedColombiaCustomsIssue || {
            severity: 'error', code: 'CUSTOMS_INCOMPLETE', category: '콜롬비아 4품목', columns: ['H'], message,
            detail: buildColombiaCustomsDetail(colombiaWeeks, { ...linkCtx, currentH: colombiaHTotal }),
          };
        } else {
          const inboundWeeks = context.countryInbound?.[row.category] || [];
          const inboundText = formatWeeks(inboundWeeks);
          const onlyFirstHalf = inboundWeeks.length > 0
            && inboundWeeks.every((week) => /-0?1$/.test(String(week)));
          const countryGw = context.customsComponents?.[row.category];
          const hasAnyGw = n0(countryGw?.GW1) > 0 || n0(countryGw?.GW2) > 0;
          let gwHint = ' 입고관리에서 해당 국가 GW 라인을 확인하세요.';
          if (onlyFirstHalf) {
            gwHint = ` ${row.category}은(는) 22~28차 원본도 -01만 입고하고 GW2=0이 정상입니다. -02가 없다고 H를 비우지 말고, ${inboundText} Gross weight(또는 입고 마스터 GW)만 확인하세요.`;
          } else if (!hasAnyGw && inboundText) {
            gwHint = ` 입고 반차수 ${inboundText}의 Gross weight 행 또는 입고 마스터 GW를 확인하세요.`;
          }
          add('error', 'CUSTOMS_INCOMPLETE', row, ['H'],
            source.H === 'partial'
              ? '그외통관비가 일부 반차수만 저장되었습니다.'
              : `그외통관비 원천값이 없어 H가 0으로 계산됩니다.${inboundText ? ` 입고 반차수: ${inboundText}.` : ''}${gwHint}`,
            buildCountryCustomsDetail(row, { ...linkCtx, inboundWeeks, components: countryGw }));
        }
      }
    }
    // R 과세환율 — 구매(Q)나 포워딩(S)이 있으면 차수와 무관하게 반드시 필요하다(호주 AUD 포함).
    // 현재 CurrencyMaster 값은 자동 적용하지 않으므로, 원천이 없으면 여기서 반드시 드러난다.
    if ((nonZero(auto.Q) || nonZero(auto.S)) && manual.R == null && !nonZero(auto.R)) {
      const hint = (row.rateSuggestions || []).length
        ? ' 화면의 참고값(전차수·통화마스터)은 제안일 뿐이라 적용·저장해야 계산에 들어갑니다.'
        : '';
      add('error', 'TAXABLE_RATE_MISSING', row, ['R'],
        `이 차수의 ${row.currency || 'USD'} 과세환율(관세청 신고환율) 원천이 없어 매입원가(P/T)를 계산할 수 없습니다. 통관 신고 환율을 입력해야 합니다.${hint}`,
        buildRateDetail(row, linkCtx));
    }

    // 29차 이후에는 항공료 전표가 입고 원장에 존재한다는 운영 계약이다. 구매가 있는데 S 원천이
    // missing/partial이면 수기 0으로 통과시키지 않고 자동분류 결함으로 중단한다.
    if (strictForwarding && nonZero(auto.Q) && manual.S == null && (source.S === 'missing' || source.S === 'partial')) {
      const colombiaWeeks = context.colombiaWeeks || [];
      const missingColombiaAirWeeks = formatWeeks(colombiaWeeks.filter((item) => item.forwardingDetected !== true).map((item) => item.orderWeek));
      const message = source.S === 'partial'
        ? `콜롬비아 4품목 공유 항공료 전표가 일부 반차수만 자동 분류되었습니다.${missingColombiaAirWeeks ? ` 누락 반차수: ${missingColombiaAirWeeks}.` : ''} 포워딩 원천 확인에서 해당 반차수만 확인하세요.`
        : `콜롬비아 4품목 공유 항공료 전표가 연결되지 않았습니다.${missingColombiaAirWeeks ? ` 누락 반차수: ${missingColombiaAirWeeks}.` : ''} 포워딩 원천 확인에서 누락된 BILL/AWB를 확인하세요.`;
      if (colombiaSharedCategories.has(row.category)) {
        sharedColombiaForwardingIssue = sharedColombiaForwardingIssue || {
          severity: 'error', code: 'FORWARDING_INCOMPLETE', category: '콜롬비아 4품목', columns: ['S'], message,
          detail: buildForwardingDetail({ category: '콜롬비아 4품목', colombiaWeeks, ...linkCtx }),
        };
      } else {
        add('error', 'FORWARDING_INCOMPLETE', row, ['S'],
          source.S === 'partial'
            ? '항공료 전표가 일부 반차수·품목군만 자동 분류되었습니다. 아래 포워딩 원천 대조 내역의 누락 범위를 확인해야 합니다.'
            : '이 차수에 구매가 있지만 자동 분류된 항공료 전표가 없습니다. 입고 원장의 전표는 존재하므로 품목명·BILL·AWB 국가 매칭을 확인해야 합니다.',
          buildForwardingDetail({ category: row.category, ...linkCtx,
            missingScopes: (forwardingLedger?.missingExpectedScopes || []).filter((m) => m.category === row.category) }));
      }
    }

  }

  if (sharedColombiaCustomsIssue) issues.push(sharedColombiaCustomsIssue);
  if (sharedColombiaForwardingIssue) issues.push(sharedColombiaForwardingIssue);

  if (strictForwarding && forwardingLedger) {
    const rowLabel = (item) => `${item.orderWeek || '-'} · ${item.farmName || '-'} · ${item.invoiceNo || item.awb || '-'} · ${item.prodName || '-'} · ${n0(item.amount).toLocaleString()}`;
    const summarizeRows = (items) => (items || []).slice(0, 5).map(rowLabel).join(' / ');
    const extraCount = (items) => Math.max(0, Number(items?.length || 0) - 5);
    const unmatched = forwardingLedger.unmatchedRows || [];
    const zeroValue = forwardingLedger.zeroValueRows || [];
    const missingScopes = (forwardingLedger.missingExpectedScopes || []).filter((item) =>
      !(sharedColombiaForwardingIssue && colombiaSharedCategories.has(item.category)));
    const currencyMismatches = Object.entries(forwardingLedger.totalsByCurrency || {})
      .filter(([, item]) => Math.abs(n0(item.delta)) > 0.01);

    if (unmatched.length) {
      add('error', 'FORWARDING_UNCLASSIFIED', { category: '포워딩 자동분류' }, ['S'],
        `항공료 전표 ${unmatched.length.toLocaleString()}건을 국가·품종에 연결하지 못했습니다. ${summarizeRows(unmatched)}${extraCount(unmatched) ? ` / 외 ${extraCount(unmatched).toLocaleString()}건` : ''}`,
        buildForwardingDetail({ category: '미분류 항공료 전표', rows: unmatched, ...linkCtx }));
    }
    if (zeroValue.length) {
      add('error', 'FORWARDING_ZERO_VALUE', { category: '포워딩 자동분류' }, ['S'],
        `항공료 품목인데 금액이 0인 전표가 ${zeroValue.length.toLocaleString()}건 있습니다. ${summarizeRows(zeroValue)}${extraCount(zeroValue) ? ` / 외 ${extraCount(zeroValue).toLocaleString()}건` : ''}`,
        buildForwardingDetail({ category: '0원 항공료 전표', rows: zeroValue, ...linkCtx }));
    }
    if (missingScopes.length) {
      const summary = missingScopes.slice(0, 8).map((item) => `${item.orderWeek} ${item.category}`).join(', ');
      add('error', 'FORWARDING_SCOPE_MISSING', { category: '포워딩 자동분류' }, ['S'],
        `구매는 있는데 항공료 전표가 연결되지 않은 범위가 ${missingScopes.length.toLocaleString()}건입니다: ${summary}${missingScopes.length > 8 ? ` 외 ${(missingScopes.length - 8).toLocaleString()}건` : ''}`,
        buildForwardingDetail({ category: '항공료 구매범위', missingScopes, ...linkCtx }));
    }
    if (Math.abs(n0(forwardingLedger.delta)) > 0.01
      || Math.abs(n0(forwardingLedger.classificationDelta)) > 0.01
      || currencyMismatches.length) {
      const details = currencyMismatches.map(([currency, item]) => `${currency} ${n0(item.delta).toLocaleString()}`).join(', ');
      add('error', 'FORWARDING_RECONCILIATION_MISMATCH', { category: '포워딩 자동분류' }, ['S'],
        `항공료 원천행과 분류 합계가 일치하지 않습니다${details ? ` (${details})` : ''}. 전표를 누락하거나 중복 집계한 분류 로직을 확인해야 합니다.`,
        reconciliationDetail(forwardingLedger, currencyMismatches, linkCtx));
    }
  }

  const previousForwardingLedger = context.previousForwardingLedger || null;
  const previousMajor = Number(context.previousMajor);
  if (Number.isFinite(previousMajor) && previousMajor >= 29
    && previousForwardingLedger?.status === 'incomplete') {
    const unmatchedCount = Number(previousForwardingLedger.unmatchedRows?.length || 0);
    const zeroCount = Number(previousForwardingLedger.zeroValueRows?.length || 0);
    const missingCount = Number(previousForwardingLedger.missingExpectedScopes?.length || 0);
    const missingScopes = formatNamedList(previousForwardingLedger.missingExpectedScopes, (item) => `${item.orderWeek} ${item.category}`);
    add('error', 'PREVIOUS_FORWARDING_INCOMPLETE', { category: '기초재고 원천' }, ['E'],
      `기초재고 계산 기준인 ${context.previousOrderYear || ''}년 ${previousMajor}차 항공료 원천이 완전하지 않습니다. 미분류 ${unmatchedCount}건, 0원 ${zeroCount}건, 구매범위 누락 ${missingCount}건${missingScopes ? `(${missingScopes})` : ''}을 먼저 확인해야 현재 차수 기초재고를 확정할 수 있습니다.`,
      buildForwardingDetail({ category: `${context.previousOrderYear || ''}년 ${previousMajor}차`, previous: true,
        missingScopes: previousForwardingLedger.missingExpectedScopes || [],
        rows: [...(previousForwardingLedger.unmatchedRows || []), ...(previousForwardingLedger.zeroValueRows || [])],
        orderYear: context.previousOrderYear, major: previousMajor }));
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

function unclassifiedDetail(row) {
  const auto = row.auto || {};
  const fields = [
    ['순수매출(N)', auto.N, '원'], ['불량(L)', auto.L, '원'], ['그 외 매출(O)', auto.O, '원'],
    ['구매금액(Q, 외화)', auto.Q, ''], ['포워딩(S, 외화)', auto.S, ''],
    ['기초재고액(E)', auto.E, '원'], ['기말재고액(F)', auto.F, '원'], ['기말 재고수량', row.stock?.endQty, ''],
  ];
  const nz = fields.filter(([, v]) => nonZero(v));
  const sales = n0(auto.N) + n0(auto.L) + n0(auto.O);
  return {
    summary: `기타(미분류) — 본표 합계 밖 값: ${nz.map(([l, v, u]) => `${l} ${fmtNum(v)}${u}`).join(', ') || '없음'}`,
    sections: [{ title: '미분류 행의 값(0이 아닌 것만 missing 표시)', status: 'missing',
      items: fields.map(([l, v, u]) => ({ label: l, status: nonZero(v) ? 'missing' : 'info', value: `${fmtNum(v)}${u}` })) }],
    impact: nonZero(sales)
      ? { columns: ['C', 'I', 'J'], amount: Math.round(sales), text: `본표 매출액(C)에서 약 ${fmtNum(Math.round(sales))}원이 빠져 있습니다(분류 저장 후 해당 카테고리로 합산).` }
      : { columns: ['E', 'F'], amount: null, text: `매출 영향 없음 — 재고/매입 값(${nz.map(([l]) => l).join('·') || '-'})만 본표 밖에 있어 해당 카테고리 기초·기말재고에 빠져 있습니다(금액 영향은 분류 후 확정).` },
    fix: buildFixLink('classification', {}),
  };
}

function negativeStockDetail(row) {
  const stock = row.stock || {};
  return {
    summary: `${row.category} 기말재고 음수 — 합계 수량 ${fmtNum(stock.endQty)}${n0(stock.negativeQty) ? `, 음수 품목 수량 ${fmtNum(stock.negativeQty)}` : ''}${stock.week ? ` (스냅샷 ${stock.week})` : ''}`,
    sections: [{ title: '재고 수량', status: 'missing', items: [
      { label: '기말 재고수량', status: n0(stock.endQty) < 0 ? 'missing' : 'info', value: fmtNum(stock.endQty) },
      { label: '음수 품목 수량 합', status: 'missing', value: fmtNum(stock.negativeQty) },
    ] }],
    impact: { columns: ['F', 'I', 'J'], amount: null, text: '영향 계산 불가 — 음수 수량만큼 기말재고액(F)이 줄어 매출원가(I)가 커져 있을 수 있습니다.' },
    fix: buildFixLink('stock', {}),
  };
}

function snapshotDetail(row, col) {
  const s = col === 'E' ? (row.beginStock || {}) : (row.stock || {});
  const label = col === 'E' ? '기초재고(전차수)' : '기말재고(이번 차수)';
  return {
    summary: `${row.category} ${label} ProductStock 스냅샷 없음${s.week ? ` — 기준 세부차수 ${s.week}` : ''}`,
    sections: [{ title: '스냅샷', status: 'missing', items: [
      { label: `${label} 스냅샷`, status: 'missing', value: s.week ? `${s.week} 없음` : '없음' },
    ] }],
    impact: { columns: [col, 'I', 'J'], amount: null, text: `영향 계산 불가 — ${col === 'E' ? '기초상품재고액(E)' : '기말상품재고액(F)'}을 계산하지 못했습니다.` },
    fix: buildFixLink('stock', {}),
  };
}

function reconciliationDetail(ledger, currencyMismatches, linkCtx) {
  const items = [
    { label: '원천행 − 분류합계', status: Math.abs(n0(ledger?.delta)) > 0.01 ? 'missing' : 'present', value: fmtNum(ledger?.delta) },
    { label: '분류 차이', status: Math.abs(n0(ledger?.classificationDelta)) > 0.01 ? 'missing' : 'present', value: fmtNum(ledger?.classificationDelta) },
    ...currencyMismatches.map(([cur, it]) => ({ label: `${cur} 차이`, status: 'missing', value: fmtNum(it.delta) })),
  ];
  return {
    summary: `항공료 원천 대조 불일치 — ${items.filter((i) => i.status === 'missing').map((i) => `${i.label} ${i.value}`).join(', ')}`,
    sections: [{ title: '대조 결과', status: 'missing', items }],
    impact: { columns: ['S', 'T', 'G'], amount: null, text: '영향 계산 불가 — 차이 금액(외화)만큼 포워딩(S)이 누락 또는 중복되었습니다.' },
    fix: buildFixLink('forwarding', linkCtx),
  };
}
