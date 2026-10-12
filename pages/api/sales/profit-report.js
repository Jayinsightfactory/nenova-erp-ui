// 주차별 매출이익 보고서 API — 자동열은 SQL, 수기열은 WebProfitReport 저장.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  EXTRA_CATEGORY, profitReportCategoriesForWeek,
  salesByCategory, estimateByCategory, purchaseByCategory, forwardingByCategory,
  invoiceRatesByCategory, stockSnapshotByCategory, currencyRates, loadManual, saveManual,
  stockPriceRows, saveStockPrices, currencyCodeForCategory, unclassifiedDetailsByCategory, formatUnclassifiedNote, composeProfitReportNote,
  periodDayRangesByMajor,
} from '../../../lib/profitReport';
import { computeAutoEndingStock, computeProfitRow, computeProfitTotals } from '../../../lib/profitReportCalc';
import { computeCustomsAndForwarding } from '../../../lib/customsForwarding';
import { buildProfitReportAudit } from '../../../lib/profitReportAudit';
import { buildMonthlyProfitSummary } from '../../../lib/profitReportMonthly.js';
import {
  assertProfitReportMutable,
  confirmProfitReportSnapshot,
  liveSnapshotMeta,
  loadConfirmedProfitReportSnapshot,
} from '../../../lib/profitReportSnapshot.js';
import { REPORT_STOCK_SELECTION, resolveProfitReportInventoryPeriods } from '../../../lib/profitReportStockPolicy.js';
import { resolveProfitReportRate } from '../../../lib/profitReportCountryResolver.js';
import manualInputManifest from '../../../data/profit-report-evidence/manual-input-manifest.v1.json';

export function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}

// GET/엑셀 공용 — 보고서 행 데이터 구성
export async function loadReportData(major, orderYear, options = {}) {
  if (!options.ignoreConfirmedSnapshot) {
    const confirmed = await loadConfirmedProfitReportSnapshot(orderYear, major);
    if (confirmed) return confirmed;
  }
  const currentMajor = Number(major);
  const inventoryPeriods = resolveProfitReportInventoryPeriods(orderYear, major);
  const prevOrderYear = inventoryPeriods.begin.orderYear;
  const prevMajor = inventoryPeriods.begin.major;
  const [N, est, Q, S, rates, invoiceRates, cur, prev, stockEnd, stockBegin, customs, unclassifiedDetails] = await Promise.all([
        salesByCategory(major, orderYear),
        estimateByCategory(major, orderYear),
        purchaseByCategory(major, orderYear),
        forwardingByCategory(major, orderYear),         // 레거시 FreightCost 추정치 — 구조화 입력값 없을 때만 fallback
        currencyRates(),
        invoiceRatesByCategory(major, orderYear),        // R 우선 원천: BILL 시점 FreightCost.ExchangeRate 스냅샷
        loadManual(major, orderYear),
        loadManual(prevMajor, prevOrderYear), // 전차수 기말재고(F) 저장값 → 이번 기초(E) 기본값
        stockSnapshotByCategory(major, orderYear),      // F 재료: 이번 차수말 재고수량·최근원가·단가표평가
        stockSnapshotByCategory(prevMajor, prevOrderYear),  // E 재료: 전차수말 스냅샷
        computeCustomsAndForwarding(major, orderYear),      // 그외통관비(H)+포워딩(S) — 그외통관비/포워딩/콜롬비아1·2차 시트 재현
        unclassifiedDetailsByCategory(major, orderYear),       // 기타(미분류) 원본 품목을 비고에 자동 기록
      ]);

      const reportCategories = profitReportCategoriesForWeek(major);
      const keys = [...reportCategories.map(c => c.key)];
      const extraHasData = [N, est.L, est.O, Q, S].some(m => Math.abs(Number(m?.[EXTRA_CATEGORY] || 0)) > 0.001);
      if (extraHasData) keys.push(EXTRA_CATEGORY);

      const rateByCode = Object.fromEntries((rates || []).map(r => [r.CurrencyCode, Number(r.ExchangeRate)]));
      const rows = keys.map(key => {
        const def = reportCategories.find(c => c.key === key) || {};
        const man = cur.manual[key] || {};
        const prevMan = prev.manual[key] || {};
        const curCode = currencyCodeForCategory(key);
        const snapshotR = invoiceRates?.[key] != null ? Number(invoiceRates[key]) : null;
        const resolvedRate = resolveProfitReportRate({
          category: key,
          currentMajor,
          manualRate: man.R,
          invoiceRate: snapshotR,
          previousConfirmedRate: prevMan.R,
          currencyMasterRate: curCode ? rateByCode[curCode] : null,
          sameOrderYear: String(prevOrderYear) === String(orderYear),
        });
        const autoR = resolvedRate.autoRate;
        const autoRSource = resolvedRate.autoSource;
        // H 그외통관비 — 그외통관비 입력/포워딩 입력 화면에서 저장한 구조화 값(2026-07-10). 미입력 카테고리는 0.
        const autoH = customs.H[key] ?? 0;
        // S 포워딩 — 구조화 입력값이 실제로 감지/저장됐으면 0도 유효값으로 존중하고, 원천 자체가 없을 때만 레거시 추정치로 fallback
        const structuredSSource = customs.sources?.S?.[key];
        const hasStructuredS = structuredSSource != null && structuredSSource !== 'missing';
        const autoS = hasStructuredS ? Number(customs.S[key] || 0) : Number(S[key] || 0);
        // F 재료 — 엑셀 방식: (구매+포워딩+통관비)÷매입총수량×기말수량. 클라이언트가 H/R/S 수정 시 즉시 재계산
        const stock = {
          week: stockEnd.week,
          endQty: stockEnd.qtys[key] != null ? Number(stockEnd.qtys[key]) : 0,
          evidenceValue: stockEnd.values[key] != null ? Number(stockEnd.values[key]) : null,
          snapshotConfirmed: stockEnd.stockMasterIsFix === 1,
          priceEvidenceStatus: stockEnd.priceEvidenceStatus?.[key] || (stockEnd.week ? 'INPUT_REQUIRED' : 'UNVERIFIED'),
          missingPriceCount: Number(stockEnd.missingPriceCounts?.[key] || 0),
          negativeQty: stockEnd.negativeQtys?.[key] != null ? Number(stockEnd.negativeQtys[key]) : 0,
        };
        const autoF = computeAutoEndingStock(stock);
        // 자동 E = 전차수 확정 ProductStock + 당시 VERIFIED 단가 근거
        const autoE = computeAutoEndingStock({
          endQty: stockBegin.qtys[key] != null ? Number(stockBegin.qtys[key]) : 0,
          evidenceValue: stockBegin.values[key] != null ? Number(stockBegin.values[key]) : null,
          snapshotConfirmed: stockBegin.stockMasterIsFix === 1,
          priceEvidenceStatus: stockBegin.priceEvidenceStatus?.[key] || (stockBegin.week ? 'INPUT_REQUIRED' : 'UNVERIFIED'),
        });
        const source = {
          E: autoE != null ? 'verified_product_stock_price' : stockBegin.week ? 'input_required_price_evidence' : 'unverified_stock_snapshot',
          F: autoF != null ? 'verified_product_stock_price' : stockEnd.week ? 'input_required_price_evidence' : 'unverified_stock_snapshot',
          H: man.H != null ? 'manual' : (customs.sources?.H?.[key] || 'missing'),
          R: resolvedRate.source,
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
            E: autoE != null ? Math.round(autoE) : null, // 전차수 기말재고 자동계산(엑셀 방식)
            F: autoF != null ? Math.round(autoF) : null, // 이번 차수 기말재고 자동계산(엑셀 방식)
            R: autoR,                                    // BILL 스냅샷 → 전차수 과세환율 → CurrencyMaster
          },
          manual: {
            H: man.H ?? null,
            R: resolvedRate.manualRate,
            S: man.S ?? null,              // 포워딩 수기 오버라이드(있으면 auto.S 대신)
          },
          inventoryEvidence: {
            E: { status: autoE != null ? 'VERIFIED' : stockBegin.week ? 'INPUT_REQUIRED' : 'UNVERIFIED', missingPriceCount: Number(stockBegin.missingPriceCounts?.[key] || 0) },
            F: { status: autoF != null ? 'VERIFIED' : stockEnd.week ? 'INPUT_REQUIRED' : 'UNVERIFIED', missingPriceCount: Number(stockEnd.missingPriceCounts?.[key] || 0) },
          },
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
      selection: REPORT_STOCK_SELECTION,
      beginStockMasterIsFix: stockBegin.stockMasterIsFix,
      endStockMasterIsFix: stockEnd.stockMasterIsFix,
    },
    audit: buildProfitReportAudit(rows, { major: currentMajor }),
    snapshot: liveSnapshotMeta(orderYear, major),
    manualInputManifest,
  };
}

/**
 * 1~12월 연속 월별 보기용 읽기 전용 집계.
 * 각 주차를 기존 loadReportData로 계산한 뒤, PeriodDay 종료일이 속한 달에
 * 차수 전체를 귀속한다. E/F는 월별로 합산하지 않고 주차 원장에만 남긴다.
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
        const data = await loadReportData(period.major, orderYear);
        const rows = (data.rows || []).map(row => ({ ...row, calc: computeProfitRow(row) }));
        return {
          major: period.major,
          period,
          totals: computeProfitTotals(rows),
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
        await assertProfitReportMutable(orderYear, major);
        const inventoryPeriods = resolveProfitReportInventoryPeriods(orderYear, major);
        const prevOrderYear = inventoryPeriods.begin.orderYear;
        const prevMajor = inventoryPeriods.begin.major;
        const list = await stockPriceRows(major, prevMajor, orderYear, prevOrderYear);
        return res.status(200).json({ success: true, ...list });
      }

      const data = await loadReportData(major, orderYear);

      // 엑셀 다운로드 — 원본 양식 템플릿에 값만 채워 100% 동일 구성으로
      if (req.query.excel === '1') {
        const { buildProfitReportXlsx } = await import('../../../lib/profitReportExcel');
        const visibleCols = String(req.query.cols || '').split(',').map(s => s.trim()).filter(Boolean);
        const buf = buildProfitReportXlsx({
          major, rows: data.rows, note: composeProfitReportNote(data.note, data.autoNote), audit: data.audit, visibleCols,
        });
        const filename = `주차별 매출이익 보고서-${Number(major)}차.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="profit-report-${major}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        return res.status(200).send(buf);
      }

      return res.status(200).json({ success: true, major, orderYear, ...data, manualInputManifest });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      if (req.body?.action === 'confirmSnapshot') {
        const liveData = await loadReportData(major, orderYear, { ignoreConfirmedSnapshot: true });
        const confirmed = await confirmProfitReportSnapshot({ orderYear, majorWeek: major, data: liveData, actor });
        return res.status(200).json({ success: true, snapshotKey: confirmed.SnapshotKey, snapshot: confirmed.payload.snapshot });
      }
      await assertProfitReportMutable(orderYear, major);
      if (req.body?.action === 'stockPrices') {
        await saveStockPrices(req.body?.prices || {}, actor, { orderYear, orderWeek: req.body?.orderWeek });
        return res.status(200).json({ success: true });
      }
      if (req.body?.action === 'saveNote') {
        const note = String(req.body?.note ?? '').slice(0, 2000);
        await saveManual(major, orderYear, {}, note, actor);
        return res.status(200).json({ success: true });
      }
      await saveManual(major, orderYear, req.body?.values || {}, req.body?.note, actor, req.body?.evidence || {});
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code || null });
  }
});
