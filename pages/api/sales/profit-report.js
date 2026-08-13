// 주차별 매출이익 보고서 API — 자동열은 SQL, 수기열은 WebProfitReport 저장.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  CATEGORIES, EXTRA_CATEGORY,
  salesByCategory, estimateByCategory, purchaseByCategory, forwardingByCategory,
  purchaseQtyByCategory, invoiceRatesByCategory, stockSnapshotByCategory, currencyRates, loadManual, saveManual,
  stockPriceRows, saveStockPrices, currencyCodeForCategory, unclassifiedDetailsByCategory, formatUnclassifiedNote, composeProfitReportNote,
  periodDayRangesByMajor,
  assertProfitReportReadSchema,
} from '../../../lib/profitReport';
import { computeAutoEndingStock, endingStockSourceKind, computeProfitRow, computeProfitTotals } from '../../../lib/profitReportCalc';
import { computeCustomsAndForwarding } from '../../../lib/customsForwarding';
import { getHistoricalTaxableRate } from '../../../lib/profitReportHistoricalCustoms';
import { loadTaxableRates, resolveTaxableRate, saveTaxableRate, RATE_SOURCE, kcsRatesByCategory } from '../../../lib/taxableExchangeRate';
import { buildProfitReportAudit } from '../../../lib/profitReportAudit';
import { buildMonthlyProfitSummary } from '../../../lib/profitReportMonthly.js';
import { getActiveConfirm } from '../../../lib/profitReportConfirm.js';

export function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}

// GET/엑셀 공용 — 보고서 행 데이터 구성
export async function loadReportData(major, orderYear) {
  const currentMajor = Number(major);
  // 27차 기초재고는 같은 매출연도의 26차 마지막 ProductStock 세부차수다.
  // 연도 경계인 01차에서만 전년도 52차를 사용한다.
  const prevOrderYear = currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear);
  const prevMajor = currentMajor <= 1 ? '52' : String(currentMajor - 1).padStart(2, '0');
  const [N, est, Q, S, rates, invoiceRates, cur, prev, stockEnd, stockBegin, purchQty, prevQ, prevS, prevPurchQty, customs, prevCustoms, unclassifiedDetails, prevConfirm, savedRates, kcsRates] = await Promise.all([
        salesByCategory(major, orderYear),
        estimateByCategory(major, orderYear),
        purchaseByCategory(major, orderYear),
        forwardingByCategory(major, orderYear),         // 레거시 FreightCost 추정치 — 구조화 입력값 없을 때만 fallback
        currencyRates(),
        invoiceRatesByCategory(major, orderYear),        // R 우선 원천: 입고별 과세환율 스냅샷(FreightCost.ExchangeRate)
        loadManual(major, orderYear),
        loadManual(prevMajor, prevOrderYear), // 전차수 기말재고(F) 저장값 → 이번 기초(E) 기본값(2순위)
        stockSnapshotByCategory(major, orderYear),      // F 재료: 이번 차수말 재고수량·최근원가·단가표평가
        stockSnapshotByCategory(prevMajor, prevOrderYear),  // E 재료: 전차수말 스냅샷
        purchaseQtyByCategory(major, orderYear),        // F 분모: 이번 차수 매입 총수량
        purchaseByCategory(prevMajor, prevOrderYear),       // E 자동계산용: 전차수 구매외화
        forwardingByCategory(prevMajor, prevOrderYear),     // E 자동계산용: 전차수 포워딩USD(레거시 fallback)
        purchaseQtyByCategory(prevMajor, prevOrderYear),    // E 자동계산용: 전차수 매입 총수량
        computeCustomsAndForwarding(major, orderYear),      // 그외통관비(H)+포워딩(S) — 그외통관비/포워딩/콜롬비아1·2차 시트 재현
        computeCustomsAndForwarding(prevMajor, prevOrderYear),  // E 자동계산용: 전차수 H/S
        unclassifiedDetailsByCategory(major, orderYear),       // 기타(미분류) 원본 품목을 비고에 자동 기록
        getActiveConfirm(prevOrderYear, prevMajor),         // E 이월 1순위: 전차수 활성 확정 스냅샷 F(REPORT_CONFIRM_SNAPSHOT)
        loadTaxableRates(orderYear, major),                 // R 원천: 이 주차에 저장/캐시된 과세환율(웹 전용, SELECT only)
        kcsRatesByCategory(major, orderYear),                // R 4순위(2026 28차 이후만): 관세청 공식 과세환율(KCS) 신고일자·TPrice 가중평균
      ]);

      const keys = [...CATEGORIES.map(c => c.key)];
      const extraHasData = [N, est.L, est.O, Q, S].some(m => Math.abs(Number(m?.[EXTRA_CATEGORY] || 0)) > 0.001);
      if (extraHasData) keys.push(EXTRA_CATEGORY);

      const rateByCode = Object.fromEntries((rates || []).map(r => [r.CurrencyCode, Number(r.ExchangeRate)]));
      const rows = keys.map(key => {
        const def = CATEGORIES.find(c => c.key === key) || {};
        const man = cur.manual[key] || {};
        const prevMan = prev.manual[key] || {};
        // 기초재고(E) 이월 우선순위(crossYearFixture 계약): 1순위 전차수 활성 확정 스냅샷 F,
        // 2순위 전차수 WebProfitReport 수기 입력 F, 3순위(둘 다 없을 때만) 전차수 자동계산(autoE).
        const prevConfirmF = prevConfirm?.rowsByCategory?.[key]?.calc?.F;
        const prevConfirmFValue = prevConfirmF != null ? Number(prevConfirmF) : null;
        const prevF = prevConfirmFValue != null ? prevConfirmFValue : prevMan.F;
        const curCode = currencyCodeForCategory(key);
        // R 과세환율(2026-08-12 원천 정정, 2026-08-12 KCS 4순위 추가) — 자동 적용은 "정확히 이
        // OrderYear+MajorWeek" 원천만, 행별 수기 오버라이드(man.R, 아래 autoF/beginInputs/source.R)가
        // 항상 이 자동값보다 우선한다:
        //   1) 당주 입고 통관 스냅샷 FreightCost.ExchangeRate
        //   2) 이 주차에 저장/캐시된 과세환율(WebTaxableExchangeRate — 카테고리 지정 > 통화 기본)
        //   3) 2026 22~27차 원본 엑셀 본표 R열(historical snapshot) — 그 범위 밖은 항상 null
        //   4) (2026 28차 이후만) 관세청 공식 과세환율 API(KCS) — 입고 신고일자별(InputDate→ArrivalDtm→
        //      UploadDtm) 환율을 wd.TPrice로 가중평균(lib/kcsRateDateWeights.js)
        // 현재 CurrencyMaster 환율과 전차수 R은 **자동 적용하지 않고** 제안(rateSuggestions)으로만
        // 내려보낸다. 과거 차수에 오늘 환율을 자동으로 채우면 확정 손익이 조용히 바뀌기 때문이다.
        const resolvedRate = resolveTaxableRate({
          snapshotRate: invoiceRates?.[key] != null ? Number(invoiceRates[key]) : null,
          savedByCategory: savedRates.byCategory?.[key] || null,
          savedByCurrency: curCode ? savedRates.byCurrency?.[curCode] || null : null,
          historicalRate: getHistoricalTaxableRate(orderYear, major, key),
          currency: curCode,
          currencyMasterRate: curCode && rateByCode[curCode] != null ? rateByCode[curCode] : null,
          previousWeekRate: prevMan.R != null ? Number(prevMan.R) : null,
          previousWeekLabel: `${Number(prevMajor)}차`,
          kcsRate: kcsRates.byCategory?.[key]?.rate ?? null,
          kcsDetail: kcsRates.byCategory?.[key]?.detail ?? null,
        });
        const autoR = resolvedRate.rate;
        const autoRSource = resolvedRate.source;
        // H 그외통관비 — 그외통관비 입력/포워딩 입력 화면에서 저장한 구조화 값(2026-07-10). 미입력 카테고리는 0.
        const autoH = customs.H[key] ?? 0;
        const prevAutoH = prevCustoms.H[key] ?? 0;
        // S 포워딩 — 구조화 입력값이 실제로 감지/저장됐으면 0도 유효값으로 존중하고, 원천 자체가 없을 때만 레거시 추정치로 fallback
        const structuredSSource = customs.sources?.S?.[key];
        const prevStructuredSSource = prevCustoms.sources?.S?.[key];
        const hasStructuredS = structuredSSource != null && structuredSSource !== 'missing';
        const hasPrevStructuredS = prevStructuredSSource != null && prevStructuredSSource !== 'missing';
        const autoS = hasStructuredS ? Number(customs.S[key] || 0) : Number(S[key] || 0);
        const prevAutoS = hasPrevStructuredS ? Number(prevCustoms.S[key] || 0) : Number(prevS[key] || 0);
        // F 재료 — 1순위는 재고평가단가 기반 평가액(tableF = 마지막 확정 세부차수 ProductStock 수량 ×
        // 품목별 재고평가단가 ÷1.1). H/R/S 수정 시 하위 폴백만 즉시 재계산된다.
        const stock = {
          week: stockEnd.week,
          purchQty: purchQty[key] != null ? Number(purchQty[key]) : 0,
          endQty: stockEnd.qtys[key] != null ? Number(stockEnd.qtys[key]) : 0,
          recentCost: stockEnd.recentCost[key] != null ? Number(stockEnd.recentCost[key]) : 0,
          tableF: stockEnd.values[key] != null ? stockEnd.values[key] : null,
          negativeQty: stockEnd.negativeQtys?.[key] != null ? Number(stockEnd.negativeQtys[key]) : 0,
          // 27차 호주처럼 카테고리 안에 매입단위(박스)와 재고단위(단/송이)가 섞이면 category 평균단가
          // 공식이 무효라 품목별 recentCost fallback으로 건너뛴다(2026-08-11 결함수정 6).
          unitMismatch: Boolean(stockEnd.unitMismatch?.[key]),
          // 재고는 있는데 최근 매입단가를 찾지 못해 recentCost 합계에 0으로 조용히 반영된 수량.
          // 값을 추정해 채우지 않고 audit이 needs_input으로 명시하게 한다(2026-08-11 결함수정 7).
          recentCostMissingQty: stockEnd.recentCostMissingQty?.[key] != null ? Number(stockEnd.recentCostMissingQty[key]) : 0,
        };
        // 서버 기준 자동 F (저장된 수기 H/R/S 반영) — 화면 실값·엑셀생성 기본값
        const autoF = computeAutoEndingStock(stock, {
          Q: Number(Q[key] || 0),
          S: man.S ?? autoS,
          H: man.H ?? autoH,
          R: man.R ?? autoR,
        });
        const stockFSourceKind = endingStockSourceKind(stock, {
          Q: Number(Q[key] || 0), S: man.S ?? autoS, H: man.H ?? autoH, R: man.R ?? autoR,
        });
        // 자동 E = 전차수 기말재고를 같은 규칙으로 계산(전차수 저장 수기값 반영). E는 항상
        // "같은 매출연도의 전차수" 스냅샷이며, 01차에서만 전년도 52차로 넘어간다(호출부 prevOrderYear/prevMajor).
        const beginStock = {
          purchQty: prevPurchQty[key] != null ? Number(prevPurchQty[key]) : 0,
          endQty: stockBegin.qtys[key] != null ? Number(stockBegin.qtys[key]) : 0,
          recentCost: stockBegin.recentCost[key] != null ? Number(stockBegin.recentCost[key]) : 0,
          tableF: stockBegin.values[key] != null ? stockBegin.values[key] : null,
          unitMismatch: Boolean(stockBegin.unitMismatch?.[key]),
        };
        const beginInputs = {
          Q: Number(prevQ[key] || 0),
          S: prevMan.S ?? prevAutoS,
          H: prevMan.H ?? prevAutoH,
          R: prevMan.R ?? autoR,
        };
        const autoE = computeAutoEndingStock(beginStock, beginInputs);
        const stockESourceKind = endingStockSourceKind(beginStock, beginInputs);
        const source = {
          // E 이월 우선순위: 이번차수 수기 > 전차수 활성 확정 스냅샷 F > 전차수 수기 F > 전차수 자동계산.
          // 확정 스냅샷이 있으면 이후 DB가 바뀌어도 그 값이 그대로 이월된다(확정본 불변).
          E: man.E != null
            ? 'manual'
            : prevConfirmFValue != null
              ? 'prior_confirmed_snapshot'
              : prevF != null
                ? 'inherited_manual'
                : stockBegin.week ? `auto_${stockESourceKind}` : 'missing_stock_snapshot',
          F: man.F != null
            ? 'manual'
            : stockEnd.week
              ? (stockFSourceKind === 'missing' ? 'missing_stock_valuation' : `auto_${stockFSourceKind}`)
              : 'missing_stock_snapshot',
          H: man.H != null ? 'manual' : (customs.sources?.H?.[key] || 'missing'),
          R: man.R != null ? 'manual_invoice' : autoRSource,
          S: man.S != null ? 'manual' : hasStructuredS ? structuredSSource : autoS ? 'legacy_auto' : 'missing',
        };
        return {
          currency: curCode,
          category: key,
          variant: def.variant || 'normal',
          stock,
          // 재고수량이 실사 앵커 기반인지(신뢰) 아니면 ProductStock 스냅샷에만 의존(확인 필요)인지 —
          // 값이 없는 카테고리(그 주 재고 자체가 0)는 null(확인 불필요)
          stockAnchored: {
            begin: stockBegin.anchored?.[key] ?? null,
            end: stockEnd.anchored?.[key] ?? null,
          },
          auto: {
            N: Number(N[key] || 0),
            L: Number(est.L[key] || 0),
            O: Number(est.O[key] || 0),
            Q: Number(Q[key] || 0),
            S: autoS,
            H: autoH,                                    // 그외통관비 자동값(그외통관비/포워딩 입력 화면 연동)
            E: autoE != null ? Math.round(autoE) : null, // 전차수 기말재고 자동계산
            F: autoF != null ? Math.round(autoF) : null, // 이번 차수 기말재고 자동계산
            R: autoR,                                    // 당주 통관 스냅샷 → 이 주차 저장/캐시 → 원본 엑셀
          },
          // 자동 적용하지 않는 참고 제안(전차수 R·통화마스터 현재환율) — 사용자가 적용·저장해야 계산에 들어간다.
          rateSuggestions: resolvedRate.suggestions,
          rateDetail: resolvedRate.detail,
          // H 구성요소(백상 GW/관세/선율/월드운송료/방역) — 화면이 "왜 이 금액인지"를 그대로 보여준다.
          customsComponents: customs.components?.H?.[key] || null,
          manual: {
            E: man.E ?? (prevF ?? null),   // 우선순위: 이번차수 저장값 > 전차수 활성 확정 스냅샷 F > 전차수 저장 기말 > (auto)
            F: man.F ?? null,
            H: man.H ?? null,
            R: man.R ?? null,
            S: man.S ?? null,              // 포워딩 수기 오버라이드(있으면 auto.S 대신)
          },
          inheritedE: man.E == null && prevF != null,
          stockSourceKind: { begin: stockESourceKind, end: stockFSourceKind },
          source,
        };
      });

  return {
    rows,
    note: cur.note,
    autoNote: formatUnclassifiedNote(unclassifiedDetails),
    unclassifiedDetails,
    rates,
    stockWeeks: {
      begin: stockBegin.week,
      end: stockEnd.week,
      beginOrderYear: prevOrderYear,
      endOrderYear: String(orderYear),
      // begin/end 스냅샷 좌표 {OrderYear, OrderWeek, StockKey} — REPORT_CONFIRM_SNAPSHOT(task 5)이
      // 확정 시 그대로 박제할 수 있도록 StockKey까지 명시적으로 노출한다(2026-08-11 결함수정 4).
      beginStockKey: stockBegin.stockKey,
      endStockKey: stockEnd.stockKey,
      selection: 'latest_stock_subweek',
      beginStockMasterIsFix: stockBegin.stockMasterIsFix,
      endStockMasterIsFix: stockEnd.stockMasterIsFix,
    },
    audit: buildProfitReportAudit(rows, { major: currentMajor }),
  };
}

/** 확정된 활성 스냅샷을 GET 응답 형태로 재구성 — 화면/엑셀이 loadReportData()와 동일한 rows/stockWeeks/audit
 * 모양을 기대하므로 shape을 맞춘다. row.calc는 확정 시점 값 그대로(재계산 금지) — 화면은 이 calc를 그대로 써야 한다. */
async function buildConfirmedPayload(major, orderYear, activeConfirmResult) {
  const { confirm, rowsByCategory, totalsCalc } = activeConfirmResult;
  const [manual, rates] = await Promise.all([loadManual(major, orderYear), currencyRates()]);
  const rows = Object.keys(rowsByCategory).map((key) => {
    const def = CATEGORIES.find(c => c.key === key) || {};
    const calc = rowsByCategory[key].calc || {};
    const sourceTag = rowsByCategory[key].sourceTag || {};
    return {
      currency: currencyCodeForCategory(key),
      category: key,
      variant: def.variant || 'normal',
      stock: {},
      stockAnchored: { begin: null, end: null },
      auto: { N: calc.N, L: calc.L, O: calc.O, Q: calc.Q, S: calc.S, H: calc.H, E: calc.E, F: calc.F, R: calc.R },
      manual: { E: null, F: null, H: null, R: null, S: null },
      inheritedE: false,
      source: {
        E: 'confirmed_snapshot', F: 'confirmed_snapshot',
        H: sourceTag.H || 'confirmed_snapshot', R: sourceTag.R || 'confirmed_snapshot', S: sourceTag.S || 'confirmed_snapshot',
      },
      calc, // 확정 스냅샷 — 화면/엑셀 모두 이 값을 그대로 쓰고 재계산하지 않는다.
      confirmed: true,
    };
  });
  const auditIssues = confirm.auditIssues || [];
  const errorCount = auditIssues.filter(i => i.severity === 'error').length;
  const warningCount = auditIssues.filter(i => i.severity === 'warning').length;
  return {
    rows,
    note: manual.note,
    autoNote: '',
    unclassifiedDetails: [],
    rates,
    confirmed: {
      confirmKey: confirm.confirmKey,
      revisionNo: confirm.revisionNo,
      confirmedBy: confirm.confirmedBy,
      confirmedByName: confirm.confirmedByName,
      confirmedAt: confirm.confirmedAt,
      isForced: confirm.isForced,
      forceReason: confirm.forceReason,
    },
    confirmedTotals: totalsCalc,
    stockWeeks: {
      begin: confirm.beginOrderWeek,
      end: confirm.endOrderWeek,
      beginOrderYear: confirm.beginOrderYear,
      endOrderYear: confirm.endOrderYear,
      beginStockKey: confirm.beginStockKey,
      endStockKey: confirm.endStockKey,
      selection: 'confirmed_snapshot',
      beginStockMasterIsFix: null,
      endStockMasterIsFix: null,
    },
    audit: { status: confirm.auditStatus || 'ready', errorCount, warningCount, issues: auditIssues },
  };
}

/** GET/엑셀/월별 보기 공용 진입점 — 활성 확정 스냅샷이 있으면 그 저장값만 반환하고,
 * 없으면 loadReportData()의 라이브 미리보기를 반환한다. */
export async function loadWeeklyReportPayload(major, orderYear) {
  const activeConfirm = await getActiveConfirm(orderYear, major);
  if (activeConfirm.initialized && activeConfirm.confirm) {
    return buildConfirmedPayload(major, orderYear, activeConfirm);
  }
  return loadReportData(major, orderYear);
}

/**
 * 1~12월 연속 월별 보기용 읽기 전용 집계.
 * 각 주차를 loadWeeklyReportPayload로 계산한 뒤(확정 주차는 확정값을 그대로 재사용 — 중복 계산하지 않음),
 * PeriodDay 종료일이 속한 달에 차수 전체를 귀속한다. E/F는 월별로 합산하지 않고 주차 원장에만 남긴다.
 */
export async function loadAnnualMonthlyReportData(orderYear) {
  const periods = await periodDayRangesByMajor(orderYear);
  const activePeriods = periods.filter(period => period.hasData);
  const weeks = [];
  const concurrency = 3;
  for (let i = 0; i < activePeriods.length; i += concurrency) {
    const batch = activePeriods.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async period => {
      try {
        const data = await loadWeeklyReportPayload(period.major, orderYear);
        const totals = data.confirmed ? data.confirmedTotals : computeProfitTotals((data.rows || []).map(row => ({ ...row, calc: computeProfitRow(row) })));
        return {
          major: period.major,
          period,
          totals,
        };
      } catch (error) {
        return { major: period.major, period, error: error.message || '주차 보고서 조회 실패' };
      }
    }));
    weeks.push(...results);
  }
  const summary = buildMonthlyProfitSummary(weeks, orderYear);
  return { ...summary, periods, weeks };
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // GET은 SELECT 전용이다. 스키마 생성은 POST/배포 마이그레이션에서만 수행한다.
      await assertProfitReportReadSchema();
      if (String(req.query.period || '').toLowerCase() === 'annual' || req.query.monthly === '1') {
        const orderYear = resolveActiveOrderYear('', req.query.year);
        const data = await loadAnnualMonthlyReportData(orderYear);
        return res.status(200).json({ success: true, ...data });
      }
      const major = parseMajor(req.query.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 27)' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.query.year);

      // 재고 평가단가표 (기초/기말 스냅샷에 재고 있는 품목만)
      if (req.query.stockPrices === '1') {
        const currentMajor = Number(major);
        const prevOrderYear = currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear);
        const prevMajor = currentMajor <= 1 ? '52' : String(currentMajor - 1).padStart(2, '0');
        const list = await stockPriceRows(major, prevMajor, orderYear, prevOrderYear);
        return res.status(200).json({ success: true, ...list });
      }

      // 활성 확정 스냅샷이 있으면 그 저장값만 반환하고, 없으면 라이브 미리보기를 반환한다(화면과 동일 소스).
      const data = await loadWeeklyReportPayload(major, orderYear);

      // 엑셀 다운로드 — 원본 양식 템플릿에 값만 채워 100% 동일 구성으로. 화면과 동일하게
      // 확정본이 있으면 그 저장값(재계산 금지)을, 없으면 라이브 계산값을 쓴다.
      if (req.query.excel === '1') {
        const { buildProfitReportXlsx } = await import('../../../lib/profitReportExcel');
        const visibleCols = String(req.query.cols || '').split(',').map(s => s.trim()).filter(Boolean);
        const buf = buildProfitReportXlsx({
          major, rows: data.rows, note: composeProfitReportNote(data.note, data.autoNote), audit: data.audit, visibleCols,
          confirmedTotals: data.confirmed ? data.confirmedTotals : null,
        });
        const filename = `주차별 매출이익 보고서-${Number(major)}차.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="profit-report-${major}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.status(200).send(buf);
      }

      return res.status(200).json({ success: true, major, orderYear, ...data });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      if (req.body?.action === 'stockPrices') {
        await saveStockPrices(req.body?.prices || {}, actor);
        return res.status(200).json({ success: true });
      }
      // 과세환율(R) 저장 — 정확한 OrderYear+MajorWeek(+Currency/Category) 키로 웹 전용 테이블에만 쓴다.
      // 담당자가 관세청 고시 환율을 입력하거나, 전차수 참고값/통화마스터 제안을 "적용"해 확정할 때 호출.
      if (req.body?.action === 'saveTaxableRate') {
        const rate = Number(req.body?.rate);
        if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ success: false, error: '과세환율 값이 올바르지 않습니다' });
        await saveTaxableRate({
          orderYear, major,
          currency: req.body?.currency || '',
          category: req.body?.category || '',
          rate,
          rateSource: req.body?.rateSource || RATE_SOURCE.MANUAL_INPUT,
          sourceDate: req.body?.sourceDate || null,
          sourceRangeStart: req.body?.sourceRangeStart || null,
          sourceRangeEnd: req.body?.sourceRangeEnd || null,
          sourceNote: req.body?.sourceNote || null,
        }, actor);
        return res.status(200).json({ success: true });
      }
      if (req.body?.action === 'saveNote') {
        const note = String(req.body?.note ?? '').slice(0, 2000);
        await saveManual(major, orderYear, {}, note, actor);
        return res.status(200).json({ success: true });
      }
      await saveManual(major, orderYear, req.body?.values || {}, req.body?.note, actor);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code });
  }
});
