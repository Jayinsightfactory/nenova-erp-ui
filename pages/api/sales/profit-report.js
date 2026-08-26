// 주차별 매출이익 보고서 API — 자동열은 SQL, 수기열은 WebProfitReport 저장.
import { withAuth } from '../../../lib/auth';
import { requireOrderYear, resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  EXTRA_CATEGORY, CNF_CATEGORIES,
  salesByCategory, estimateByCategory, purchaseByCategory, purchaseQtyByCategory, forwardingByCategory,
  invoiceRatesByCategory, stockSnapshotByCategory, currencyRates, loadManual, saveManual,
  stockPriceRows, saveStockPrices, currencyCodeForCategory, unclassifiedDetailsByCategory, formatUnclassifiedNote, composeProfitReportNote,
  periodDayRangesByMajor, profitReportCategoriesForWeek, latestStockSnapshotWeek,
  assertProfitReportReadSchema,
} from '../../../lib/profitReport';
import {
  computeAutoEndingStock,
  endingStockSourceKind,
  computeProfitRow,
  computeProfitTotals,
  computeCategoryAverageInventoryValue,
} from '../../../lib/profitReportCalc';
import { computeCustomsAndForwarding } from '../../../lib/customsForwarding';
import { getHistoricalTaxableRate } from '../../../lib/profitReportHistoricalCustoms';
import { loadTaxableRates, resolveTaxableRate, saveTaxableRate, RATE_SOURCE, kcsRatesByCategory } from '../../../lib/taxableExchangeRate';
import { buildProfitReportAudit } from '../../../lib/profitReportAudit';
import { buildMonthlyProfitSummary } from '../../../lib/profitReportMonthly.js';
import { getActiveConfirm } from '../../../lib/profitReportConfirm.js';
import manualInputManifest from '../../../data/profit-report-evidence/manual-input-manifest.v1.json';
import { getHistoricalClosingInventoryEvidence } from '../../../lib/profitReportHistoricalInventory';
import { resolveCarriedRatesForCategories, createWeekContextCache, CARRIED_RATE_SOURCE } from '../../../lib/profitReportTaxableRateCarry.js';

export function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}

// 호주/AUD 재고 평가 근거 — 행별 R과 같은 우선순위(정확한 원천만)를 쓰되, missing이면서 이번(그) 차수에
// 재고화 대상 매입이 없을 때만 carry(호출부가 미리 계산해 넘긴다)를 적용한다. carry 자체는 이 함수가
// 계산하지 않는다(순수/동기 유지) — lib/profitReportTaxableRateCarry.js의 비동기 오케스트레이션 몫이다.
function buildInventoryRateEvidenceByCurrency({
  targetYear, targetMajor, manual = {}, invoice = {}, saved = {}, kcs = {}, rateByCode = {}, carry = null,
} = {}) {
  const category = '호주';
  const currency = 'AUD';
  const manualRate = manual?.[category]?.R;
  if (manualRate != null && Number(manualRate) > 0) {
    return { AUD: { rate: Number(manualRate), source: `profit-report:${targetYear}:${targetMajor}:호주:R:manual` } };
  }
  const resolved = resolveTaxableRate({
    snapshotRate: invoice?.[category] != null ? Number(invoice[category]) : null,
    savedByCategory: saved.byCategory?.[category] || null,
    savedByCurrency: saved.byCurrency?.[currency] || null,
    historicalRate: getHistoricalTaxableRate(targetYear, targetMajor, category),
    currency,
    currencyMasterRate: rateByCode[currency] != null ? rateByCode[currency] : null,
    previousWeekRate: null,
    previousWeekLabel: null,
    kcsRate: kcs.byCategory?.[category]?.rate ?? null,
    kcsDetail: kcs.byCategory?.[category]?.detail ?? null,
  });
  if (Number(resolved.rate) > 0) {
    return { AUD: { rate: Number(resolved.rate), source: `profit-report:${targetYear}:${targetMajor}:호주:R:${resolved.source || 'exact'}` } };
  }
  if (carry) {
    return {
      AUD: {
        rate: carry.rate,
        source: `profit-report:${targetYear}:${targetMajor}:호주:R:${CARRIED_RATE_SOURCE}`,
        carry,
      },
    };
  }
  return {};
}

async function loadInventoryRateEvidenceByCurrency(targetYear, targetMajor) {
  const [invoice, manualResult, saved, kcs, rates, purchaseQty] = await Promise.all([
    invoiceRatesByCategory(targetMajor, targetYear),
    loadManual(targetMajor, targetYear),
    loadTaxableRates(targetYear, targetMajor),
    kcsRatesByCategory(targetMajor, targetYear),
    currencyRates(),
    purchaseQtyByCategory(targetMajor, targetYear),
  ]);
  const rateByCode = Object.fromEntries((rates || []).map((row) => [row.CurrencyCode, Number(row.ExchangeRate)]));
  const currency = 'AUD';
  const category = '호주';
  const exact = resolveTaxableRate({
    snapshotRate: invoice?.[category] != null ? Number(invoice[category]) : null,
    savedByCategory: saved.byCategory?.[category] || null,
    savedByCurrency: saved.byCurrency?.[currency] || null,
    historicalRate: getHistoricalTaxableRate(targetYear, targetMajor, category),
    currency,
    currencyMasterRate: null,
    previousWeekRate: null,
    previousWeekLabel: null,
    kcsRate: kcs.byCategory?.[category]?.rate ?? null,
    kcsDetail: kcs.byCategory?.[category]?.detail ?? null,
  });
  const hasExact = manualResult.manual?.[category]?.R != null && Number(manualResult.manual[category].R) > 0
    ? true
    : (exact.source !== RATE_SOURCE.MISSING && Number(exact.rate) > 0);
  const qty = Number(purchaseQty?.[category] || 0);
  let carry = null;
  if (!hasExact && qty <= 0) {
    const fetchWeekContext = createWeekContextCache(async (y, m) => {
      const [invoiceRatesW, manualW, savedRatesW, purchaseQtyW] = await Promise.all([
        invoiceRatesByCategory(m, y),
        loadManual(m, y),
        loadTaxableRates(y, m),
        purchaseQtyByCategory(m, y),
      ]);
      const hasPurchase = Object.values(purchaseQtyW || {}).some((qty) => Number(qty) > 0);
      const kcsRatesW = hasPurchase ? await kcsRatesByCategory(m, y) : { byCategory: {} };
      return { manual: manualW.manual || {}, invoiceRates: invoiceRatesW, savedRates: savedRatesW, kcsRates: kcsRatesW, purchaseQty: purchaseQtyW };
    });
    const carried = await resolveCarriedRatesForCategories({
      orderYear: targetYear,
      major: targetMajor,
      categories: [{ key: category, currency }],
      currentExactByCategory: { [category]: null },
      currentPurchaseQtyByCategory: { [category]: qty },
      fetchWeekContext,
    });
    carry = carried[category] || null;
  }
  return buildInventoryRateEvidenceByCurrency({
    targetYear,
    targetMajor,
    manual: manualResult.manual,
    invoice,
    saved,
    kcs,
    rateByCode,
    carry,
  });
}

// GET/엑셀 공용 — 보고서 행 데이터 구성
export async function loadReportData(major, orderYear) {
  const currentMajor = Number(major);
  // 27차 기초재고는 같은 매출연도의 26차 마지막 ProductStock 세부차수다.
  // 연도 경계인 01차에서만 전년도 52차를 사용한다.
  const prevOrderYear = currentMajor <= 1 ? String(Number(orderYear) - 1) : String(orderYear);
  const prevMajor = currentMajor <= 1 ? '52' : String(currentMajor - 1).padStart(2, '0');
  const [N, est, Q, purchaseQty, S, rates, invoiceRates, cur, prev, customs, unclassifiedDetails, savedRates, kcsRates] = await Promise.all([
        salesByCategory(major, orderYear),
        estimateByCategory(major, orderYear),
        purchaseByCategory(major, orderYear),
        purchaseQtyByCategory(major, orderYear),
        forwardingByCategory(major, orderYear),         // 레거시 FreightCost 추정치 — 구조화 입력값 없을 때만 fallback
        currencyRates(),
        invoiceRatesByCategory(major, orderYear),        // R 우선 원천: 입고별 과세환율 스냅샷(FreightCost.ExchangeRate)
        loadManual(major, orderYear),
        loadManual(prevMajor, prevOrderYear), // 당차수 exact 제안 및 무매입 제한 이월 원천 판정에 사용
        computeCustomsAndForwarding(major, orderYear),      // 그외통관비(H)+포워딩(S) — 그외통관비/포워딩/콜롬비아1·2차 시트 재현
        unclassifiedDetailsByCategory(major, orderYear),       // 기타(미분류) 원본 품목을 비고에 자동 기록
        loadTaxableRates(orderYear, major),                 // R 원천: 이 주차에 저장/캐시된 과세환율(웹 전용, SELECT only)
        kcsRatesByCategory(major, orderYear),                // R 4순위(2026 28차 이후 및 그 다음 연도): KCS InputDate·TPrice 가중평균
      ]);

      // E는 "현재 보고서의 E 셀"을 이월하지 않고, 같은 연도의 직전 대차수 F를 같은 공식으로
      // 다시 계산한다. 이 때문에 26차 F와 불연속인 27차 workbook E(베트남 +3,658,862.88875)는
      // 웹 값에 섞이지 않는다. 01차만 전년도 52차를 사용한다.
      const [prevQ, prevPurchaseQty, prevLegacyS, prevInvoiceRates, prevCustoms, prevSavedRates, prevKcsRates] = await Promise.all([
        purchaseByCategory(prevMajor, prevOrderYear),
        purchaseQtyByCategory(prevMajor, prevOrderYear),
        forwardingByCategory(prevMajor, prevOrderYear),
        invoiceRatesByCategory(prevMajor, prevOrderYear),
        computeCustomsAndForwarding(prevMajor, prevOrderYear),
        loadTaxableRates(prevOrderYear, prevMajor),
        kcsRatesByCategory(prevMajor, prevOrderYear),
      ]);

      const categories = profitReportCategoriesForWeek(currentMajor);
      const keys = [...categories.map(c => c.key)];
      const extraHasData = [N, est.L, est.O, Q, S].some(m => Math.abs(Number(m?.[EXTRA_CATEGORY] || 0)) > 0.001);
      if (extraHasData) keys.push(EXTRA_CATEGORY);

      const rateByCode = Object.fromEntries((rates || []).map(r => [r.CurrencyCode, Number(r.ExchangeRate)]));

      // R 이월(carry) — 이번/전 차수 모두 "정확한 원천"만으로 먼저 계산해두고(resolveTaxableRate,
      // 카테고리별 반복 없이 이미 로드된 배치 결과만 사용), 그 결과가 missing이면서 그 차수 자체에
      // 재고화 대상 매입도 없는 카테고리만 walk-back 대상으로 넘긴다. 걷는 동안 만나는 과거 차수는
      // fetchCarryWeekContext가 (연도,차수) 조합당 한 번만 조회해 여러 호출(행 R + AUD 재고근거 +
      // 전차수 평가)이 같은 과거 차수를 다시 쿼리하지 않게 한다.
      const fetchCarryWeekContext = createWeekContextCache(async (y, m) => {
        const [invoiceRatesW, manualW, savedRatesW, purchaseQtyW] = await Promise.all([
          invoiceRatesByCategory(m, y),
          loadManual(m, y),
          loadTaxableRates(y, m),
          purchaseQtyByCategory(m, y),
        ]);
        const hasPurchase = Object.values(purchaseQtyW || {}).some((qty) => Number(qty) > 0);
        const kcsRatesW = hasPurchase ? await kcsRatesByCategory(m, y) : { byCategory: {} };
        return { manual: manualW.manual || {}, invoiceRates: invoiceRatesW, savedRates: savedRatesW, kcsRates: kcsRatesW, purchaseQty: purchaseQtyW };
      });

      const resolvedRateByKey = {};
      for (const key of keys) {
        const curCode = currencyCodeForCategory(key);
        const prevMan = prev.manual[key] || {};
        resolvedRateByKey[key] = {
          curCode,
          resolvedRate: resolveTaxableRate({
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
          }),
        };
      }
      const currentExactByCategory = Object.fromEntries(keys.map((key) => {
        const manualRate = Number(cur.manual[key]?.R);
        if (manualRate > 0) return [key, { rate: manualRate, source: RATE_SOURCE.MANUAL_INPUT }];
        const rr = resolvedRateByKey[key].resolvedRate;
        return [key, (rr.source !== RATE_SOURCE.MISSING && Number(rr.rate) > 0) ? { rate: rr.rate, source: rr.source } : null];
      }));
      const currentCarryByCategory = await resolveCarriedRatesForCategories({
        orderYear, major,
        categories: keys.map((key) => ({ key, currency: resolvedRateByKey[key].curCode })),
        currentExactByCategory,
        currentPurchaseQtyByCategory: purchaseQty,
        fetchWeekContext: fetchCarryWeekContext,
      });

      const prevResolvedRateByKey = {};
      for (const key of keys) {
        const curCode = currencyCodeForCategory(key);
        prevResolvedRateByKey[key] = {
          curCode,
          resolvedRate: resolveTaxableRate({
            snapshotRate: prevInvoiceRates?.[key] != null ? Number(prevInvoiceRates[key]) : null,
            savedByCategory: prevSavedRates.byCategory?.[key] || null,
            savedByCurrency: curCode ? prevSavedRates.byCurrency?.[curCode] || null : null,
            historicalRate: getHistoricalTaxableRate(prevOrderYear, prevMajor, key),
            currency: curCode,
            currencyMasterRate: curCode && rateByCode[curCode] != null ? rateByCode[curCode] : null,
            previousWeekRate: null,
            previousWeekLabel: null,
            kcsRate: prevKcsRates.byCategory?.[key]?.rate ?? null,
            kcsDetail: prevKcsRates.byCategory?.[key]?.detail ?? null,
          }),
        };
      }
      const prevExactByCategory = Object.fromEntries(keys.map((key) => {
        const manualRate = Number(prev.manual[key]?.R);
        if (manualRate > 0) return [key, { rate: manualRate, source: RATE_SOURCE.MANUAL_INPUT }];
        const rr = prevResolvedRateByKey[key].resolvedRate;
        return [key, (rr.source !== RATE_SOURCE.MISSING && Number(rr.rate) > 0) ? { rate: rr.rate, source: rr.source } : null];
      }));
      const prevCarryByCategory = await resolveCarriedRatesForCategories({
        orderYear: prevOrderYear, major: prevMajor,
        categories: keys.map((key) => ({ key, currency: prevResolvedRateByKey[key].curCode })),
        currentExactByCategory: prevExactByCategory,
        currentPurchaseQtyByCategory: prevPurchaseQty,
        fetchWeekContext: fetchCarryWeekContext,
      });

      const endRateEvidenceByCurrency = buildInventoryRateEvidenceByCurrency({
        targetYear: orderYear, targetMajor: major, manual: cur.manual,
        invoice: invoiceRates, saved: savedRates, kcs: kcsRates, rateByCode,
        carry: currentCarryByCategory['호주'] || null,
      });
      const beginRateEvidenceByCurrency = buildInventoryRateEvidenceByCurrency({
        targetYear: prevOrderYear, targetMajor: prevMajor, manual: prev.manual,
        invoice: prevInvoiceRates, saved: prevSavedRates, kcs: prevKcsRates, rateByCode,
        carry: prevCarryByCategory['호주'] || null,
      });
      const [stockEnd, stockBegin] = await Promise.all([
        stockSnapshotByCategory(major, orderYear, { rateEvidenceByCurrency: endRateEvidenceByCurrency }),
        stockSnapshotByCategory(prevMajor, prevOrderYear, { rateEvidenceByCurrency: beginRateEvidenceByCurrency }),
      ]);
      const previousValuation = Object.fromEntries(categories.map((definition) => {
        const key = definition.key;
        const previousManual = prev.manual[key] || {};
        const resolved = prevResolvedRateByKey[key].resolvedRate;
        const prevCarry = prevCarryByCategory[key] || null;
        const effectivePrevRate = Number(resolved.rate) > 0 ? resolved.rate : (prevCarry ? prevCarry.rate : resolved.rate);
        const structuredSource = prevCustoms.sources?.S?.[key];
        const hasStructured = structuredSource != null && structuredSource !== 'missing';
        const automaticS = hasStructured ? Number(prevCustoms.S[key] || 0) : Number(prevLegacyS[key] || 0);
        const previousConversionMissing = Number(stockBegin.conversionMissingCounts?.[key] || 0) > 0;
        const previousUnitMismatch = stockBegin.unitMismatch?.[key] === true;
        const averageInputs = {
          category: key,
          purchaseForeign: Number(prevQ[key] || 0),
          forwardingForeign: previousManual.S != null ? Number(previousManual.S) : automaticS,
          taxableRate: previousManual.R != null ? Number(previousManual.R) : effectivePrevRate,
          customsCost: previousManual.H != null ? Number(previousManual.H) : Number(prevCustoms.H[key] || 0),
          purchaseQty: Number(prevPurchaseQty[key] || 0),
          stockQty: Number(stockBegin.qtys[key] || 0),
        };
        const average = (!previousConversionMissing && !previousUnitMismatch)
          ? computeCategoryAverageInventoryValue(averageInputs) : null;
        // 원본공식 확대 fallback(2026-08-26) — workbook 확인 6키가 아니어도, 품목별 검증
        // 근거가 전무할 때 마지막 수단으로 같은 카테고리 평균원가 공식을 쓴다(정확 근거 후순위).
        const averageFallback = (!average && !previousConversionMissing && !previousUnitMismatch)
          ? computeCategoryAverageInventoryValue(averageInputs, { anyCategory: true }) : null;
        return [key, {
          average,
          averageFallback,
          historical: getHistoricalClosingInventoryEvidence(prevOrderYear, prevMajor, key),
          conversionMissing: previousConversionMissing,
          unitMismatch: previousUnitMismatch,
        }];
      }));
      // 매입 없는 전차수(E) 단가이월 fallback 준비 — F(w-1)를 공식/근거로 못 채우고
      // 그 주에 매입도 없으면, 전전차수(w-2) 평가 단가 × 전차수말 수량으로 근사한다.
      // 필요한 카테고리가 있을 때만 전전차수 원천을 1회 로드한다(과거 확정 주차 근사용).
      const prevPrevUnitCost = await (async () => {
        const needs = keys.filter((key) => {
          const previous = previousValuation[key] || {};
          const beginQty = Number(stockBegin.qtys[key] || 0);
          const directBeginValue = stockBegin.values[key] != null ? Number(stockBegin.values[key]) : null;
          return beginQty > 0 && !previous.average && !previous.averageFallback
            && directBeginValue == null && !previous.historical
            && Number(prevPurchaseQty[key] || 0) <= 0;
        });
        if (!needs.length || Number(prevMajor) <= 1) return {};
        const ppMajor = String(Number(prevMajor) - 1).padStart(2, '0');
        const ppYear = prevOrderYear;
        const [ppStock, ppQ, ppPurchaseQty, ppCustoms, ppLegacyS, ppManualResult, ppInvoiceRates, ppSavedRates, ppKcsRates] = await Promise.all([
          stockSnapshotByCategory(ppMajor, ppYear),
          purchaseByCategory(ppMajor, ppYear),
          purchaseQtyByCategory(ppMajor, ppYear),
          computeCustomsAndForwarding(ppMajor, ppYear),
          forwardingByCategory(ppMajor, ppYear),
          loadManual(ppMajor, ppYear),
          invoiceRatesByCategory(ppMajor, ppYear),
          loadTaxableRates(ppYear, ppMajor),
          kcsRatesByCategory(ppMajor, ppYear),
        ]);
        const out = {};
        for (const key of needs) {
          const man = ppManualResult.manual?.[key] || {};
          const curCode = currencyCodeForCategory(key);
          const resolved = resolveTaxableRate({
            snapshotRate: ppInvoiceRates?.[key] != null ? Number(ppInvoiceRates[key]) : null,
            savedByCategory: ppSavedRates.byCategory?.[key] || null,
            savedByCurrency: curCode ? ppSavedRates.byCurrency?.[curCode] || null : null,
            historicalRate: getHistoricalTaxableRate(ppYear, ppMajor, key),
            currency: curCode,
            currencyMasterRate: curCode && rateByCode[curCode] != null ? rateByCode[curCode] : null,
            previousWeekRate: null,
            previousWeekLabel: null,
            kcsRate: ppKcsRates.byCategory?.[key]?.rate ?? null,
            kcsDetail: ppKcsRates.byCategory?.[key]?.detail ?? null,
          });
          const structured = ppCustoms.sources?.S?.[key];
          const autoSpp = structured != null && structured !== 'missing'
            ? Number(ppCustoms.S[key] || 0) : Number(ppLegacyS[key] || 0);
          const qtyPP = Number(ppStock.qtys?.[key] || 0);
          const formula = computeCategoryAverageInventoryValue({
            category: key,
            purchaseForeign: Number(ppQ[key] || 0),
            forwardingForeign: man.S != null ? Number(man.S) : autoSpp,
            taxableRate: man.R != null ? Number(man.R) : (Number(resolved.rate) > 0 ? resolved.rate : null),
            customsCost: man.H != null ? Number(man.H) : Number(ppCustoms.H[key] || 0),
            purchaseQty: Number(ppPurchaseQty[key] || 0),
            stockQty: qtyPP,
          }, { anyCategory: true });
          const directPP = ppStock.values?.[key] != null ? Number(ppStock.values[key]) : null;
          const historicalPP = getHistoricalClosingInventoryEvidence(ppYear, ppMajor, key);
          const valuePP = formula ? formula.value : directPP != null ? directPP : historicalPP ? Number(historicalPP.value) : null;
          if (valuePP != null && qtyPP > 0 && Number.isFinite(valuePP / qtyPP)) {
            out[key] = { unitCost: valuePP / qtyPP, sourceWeek: `${ppYear}:${ppMajor}` };
          }
        }
        return out;
      })();

      const rows = keys.map(key => {
        const def = categories.find(c => c.key === key) || {};
        const man = cur.manual[key] || {};
        const curCode = resolvedRateByKey[key].curCode;
        // R 과세환율(2026-08-12 원천 정정, 2026-08-12 KCS 4순위 추가, 2026-08-24 이월 추가) — 자동 적용은
        // "정확히 이 OrderYear+MajorWeek" 원천만, 행별 수기 오버라이드(man.R, 아래 autoF/beginInputs/source.R)가
        // 항상 이 자동값보다 우선한다:
        //   1) 당주 입고 통관 스냅샷 FreightCost.ExchangeRate
        //   2) 이 주차에 저장/캐시된 과세환율(WebTaxableExchangeRate — 카테고리 지정 > 통화 기본)
        //   3) 2026 22~27차 원본 엑셀 본표 R열(historical snapshot) — 그 범위 밖은 항상 null
        //   4) (2026 28차 이후 및 그 다음 연도) 관세청 공식 과세환율 API(KCS) — 사용자가 입고에
        //      명시한 InputDate별 환율을 wd.TPrice로 가중평균(lib/kcsRateDateWeights.js)
        // 현재 CurrencyMaster 환율은 자동 적용하지 않고 제안(rateSuggestions)으로만 내려보낸다.
        // 전차수 R도 이 exact resolver에서는 제안이지만, 아래의 무매입 제한 이월 정책이 별도로 판정한다.
        // 위 네 원천이 모두 missing이고 이번 차수에 재고화 대상 매입도 없으면(=쓸 R 자체가 필요없는
        // 주차) lib/profitReportTaxableRateCarry.js가 직전 대차수들로 걸어가며 찾은 이월값만 예외적으로
        // 쓴다 — 매입이 있는데 원천이 없는 경우는 이 경로를 절대 타지 않는다(위 currentExactByCategory/
        // currentCarryByCategory 게이팅, 이미 이번 차수 매입수량으로 걸러졌다).
        const resolvedRate = resolvedRateByKey[key].resolvedRate;
        const carry = currentCarryByCategory[key] || null;
        const hasManualR = Number(man.R) > 0;
        const hasExactR = resolvedRate.source !== RATE_SOURCE.MISSING && Number(resolvedRate.rate) > 0;
        // 근사 환율(2026-08-26 사장님 방침 "근사치로라도 넣어놔") — 정확 원천도 이월값도 없으면
        // CurrencyMaster 현재 환율을 근사치로 자동 적용한다. 화면 R 입력칸은 계속 열려 있어
        // 통관 신고 환율 확인 후 수정·저장하면 수기값이 우선한다.
        const approxRate = currencyCodeForCategory(key) && rateByCode[currencyCodeForCategory(key)] > 0
          ? rateByCode[currencyCodeForCategory(key)] : null;
        const autoR = hasExactR ? resolvedRate.rate : (carry ? carry.rate : (approxRate != null ? approxRate : resolvedRate.rate));
        const autoRSource = hasExactR
          ? resolvedRate.source
          : carry
            ? CARRIED_RATE_SOURCE
            : approxRate != null ? 'approximate_currency_master' : resolvedRate.source;
        // H 그외통관비 — 그외통관비 입력/포워딩 입력 화면에서 저장한 구조화 값(2026-07-10). 미입력 카테고리는 0.
        const autoH = customs.H[key] ?? 0;
        // S 포워딩 — 구조화 입력값이 실제로 감지/저장됐으면 0도 유효값으로 존중하고, 원천 자체가 없을 때만 레거시 추정치로 fallback
        const structuredSSource = customs.sources?.S?.[key];
        const hasStructuredS = structuredSSource != null && structuredSSource !== 'missing';
        const autoS = hasStructuredS ? Number(customs.S[key] || 0) : Number(S[key] || 0);
        // F 1순위는 원본 workbook에 수식이 확인된 카테고리 평균원가 공식이다.
        //   (상품+포워딩 매입액 + 그외통관비) / 당주 매입수량 * 마지막 ProductStock 환산수량
        // 이 공식 대상이 아니거나 필요한 원천이 없을 때만 품목별 VERIFIED 단가를 사용하고,
        // 2026년 22~28차는 마지막 보조수단으로 사용자가 제공한 원본 workbook F 셀을 쓴다.
        const endConversionMissing = Number(stockEnd.conversionMissingCounts?.[key] || 0) > 0;
        const endUnitMismatch = stockEnd.unitMismatch?.[key] === true;
        const categoryAverageEnd = (!endConversionMissing && !endUnitMismatch) ? computeCategoryAverageInventoryValue({
          category: key,
          purchaseForeign: Number(Q[key] || 0),
          forwardingForeign: man.S != null ? Number(man.S) : autoS,
          taxableRate: man.R != null ? Number(man.R) : autoR,
          customsCost: man.H != null ? Number(man.H) : Number(autoH || 0),
          purchaseQty: Number(purchaseQty[key] || 0),
          stockQty: Number(stockEnd.qtys[key] || 0),
        }) : null;
        const historicalEnd = getHistoricalClosingInventoryEvidence(orderYear, major, key);
        const directEndValue = stockEnd.values[key] != null ? Number(stockEnd.values[key]) : null;
        // E(기초) 해석을 먼저 확정한다 — 매입 없는 주의 F 단가이월 fallback이 이 값을 쓴다.
        const previous = previousValuation[key] || {};
        const directBeginValue = stockBegin.values[key] != null ? Number(stockBegin.values[key]) : null;
        const beginQtyValue = Number(stockBegin.qtys[key] || 0);
        const carriedBegin = prevPrevUnitCost[key] && beginQtyValue > 0
          ? { value: prevPrevUnitCost[key].unitCost * beginQtyValue, sourceWeek: prevPrevUnitCost[key].sourceWeek }
          : null;
        const resolvedBegin = previous.average
          ? {
              value: previous.average.value,
              status: 'VERIFIED_CATEGORY_AVERAGE',
              sources: [`erp:${prevOrderYear}:${stockBegin.week || `${prevMajor}-last`}:category-average:(G+H)/purchaseQty*ProductStock`],
            }
          : directBeginValue != null
            ? {
                value: directBeginValue,
                status: stockBegin.priceEvidenceStatus?.[key] || 'VERIFIED',
                sources: stockBegin.priceEvidenceSources?.[key] || [],
              }
            : previous.historical
              ? { value: Number(previous.historical.value), status: previous.historical.status, sources: [previous.historical.sourceRef] }
              : previous.averageFallback
                ? {
                    value: previous.averageFallback.value,
                    status: 'VERIFIED_CATEGORY_AVERAGE_FALLBACK',
                    sources: [`erp:${prevOrderYear}:${stockBegin.week || `${prevMajor}-last`}:category-average-fallback:(G+H)/purchaseQty*ProductStock`],
                  }
                : carriedBegin
                  ? {
                      value: carriedBegin.value,
                      status: 'VERIFIED_CARRIED_UNIT_COST',
                      sources: [`erp:${carriedBegin.sourceWeek}:carried-unit-cost->${prevOrderYear}:${prevMajor}`],
                    }
                  : null;
        // F(기말) — 공식 6키(1순위) > 품목별 검증 > historical > 공식 fallback(전 카테고리)
        //           > 매입 없는 주 단가이월(전차수 평가 단가 × 이번 수량). 2026-08-26 방침.
        const categoryAverageEndFallback = (!categoryAverageEnd && !endConversionMissing && !endUnitMismatch)
          ? computeCategoryAverageInventoryValue({
              category: key,
              purchaseForeign: Number(Q[key] || 0),
              forwardingForeign: man.S != null ? Number(man.S) : autoS,
              taxableRate: man.R != null ? Number(man.R) : autoR,
              customsCost: man.H != null ? Number(man.H) : Number(autoH || 0),
              purchaseQty: Number(purchaseQty[key] || 0),
              stockQty: Number(stockEnd.qtys[key] || 0),
            }, { anyCategory: true }) : null;
        const endQtyValue = Number(stockEnd.qtys[key] || 0);
        const carriedEnd = endQtyValue > 0 && Number(purchaseQty[key] || 0) <= 0
          && resolvedBegin?.value != null && beginQtyValue > 0
          && Number.isFinite(resolvedBegin.value / beginQtyValue)
          ? { value: (resolvedBegin.value / beginQtyValue) * endQtyValue }
          : null;
        const resolvedEnd = categoryAverageEnd
          ? {
              value: categoryAverageEnd.value,
              status: 'VERIFIED_CATEGORY_AVERAGE',
              sources: [`erp:${orderYear}:${stockEnd.week || `${major}-last`}:category-average:(G+H)/purchaseQty*ProductStock`],
            }
          : directEndValue != null
            ? {
                value: directEndValue,
                status: stockEnd.priceEvidenceStatus?.[key] || 'VERIFIED',
                sources: stockEnd.priceEvidenceSources?.[key] || [],
              }
            : historicalEnd
              ? { value: Number(historicalEnd.value), status: historicalEnd.status, sources: [historicalEnd.sourceRef] }
              : categoryAverageEndFallback
                ? {
                    value: categoryAverageEndFallback.value,
                    status: 'VERIFIED_CATEGORY_AVERAGE_FALLBACK',
                    sources: [`erp:${orderYear}:${stockEnd.week || `${major}-last`}:category-average-fallback:(G+H)/purchaseQty*ProductStock`],
                  }
                : carriedEnd
                  ? {
                      value: carriedEnd.value,
                      status: 'VERIFIED_CARRIED_UNIT_COST',
                      sources: [`erp:${prevOrderYear}:${prevMajor}:carried-unit-cost->${orderYear}:${major}`],
                    }
                  : null;
        const stock = {
          week: stockEnd.week,
          endQty: stockEnd.qtys[key] != null ? Number(stockEnd.qtys[key]) : 0,
          evidenceValue: resolvedEnd?.value ?? null,
          snapshotConfirmed: stockEnd.snapshotAvailable === true,
          priceEvidenceStatus: resolvedEnd?.status || (stockEnd.week && Number(stockEnd.qtys[key] || 0) === 0 ? 'VERIFIED' : 'INPUT_REQUIRED'),
          priceEvidenceSources: resolvedEnd?.sources || [],
          missingPriceCount: resolvedEnd ? 0 : Number(stockEnd.missingPriceCounts?.[key] || 0),
          missingPriceItems: resolvedEnd ? [] : (stockEnd.missingPriceItems?.[key] || []),
          conversionMissingCount: Number(stockEnd.conversionMissingCounts?.[key] || 0),
          conversionIssues: stockEnd.conversionIssues?.[key] || [],
          unitMismatch: endUnitMismatch,
          negativeQty: stockEnd.negativeQtys?.[key] != null ? Number(stockEnd.negativeQtys[key]) : 0,
        };
        const autoF = computeAutoEndingStock(stock);
        const stockFSourceKind = endingStockSourceKind(stock);
        // E는 같은 연도 직전 대차수(01차만 전년도 52차)의 F 원천과 공식을 재사용한다.
        // resolvedBegin은 위(F 단가이월 fallback 이전)에서 이미 확정했다.
        const beginStock = {
          week: stockBegin.week,
          endQty: stockBegin.qtys[key] != null ? Number(stockBegin.qtys[key]) : 0,
          evidenceValue: resolvedBegin?.value ?? null,
          snapshotConfirmed: stockBegin.snapshotAvailable === true,
          priceEvidenceStatus: resolvedBegin?.status || (stockBegin.week && Number(stockBegin.qtys[key] || 0) === 0 ? 'VERIFIED' : 'INPUT_REQUIRED'),
          priceEvidenceSources: resolvedBegin?.sources || [],
          missingPriceCount: resolvedBegin ? 0 : Number(stockBegin.missingPriceCounts?.[key] || 0),
          missingPriceItems: resolvedBegin ? [] : (stockBegin.missingPriceItems?.[key] || []),
          conversionMissingCount: Number(stockBegin.conversionMissingCounts?.[key] || 0),
          conversionIssues: stockBegin.conversionIssues?.[key] || [],
          unitMismatch: previous.unitMismatch === true,
        };
        const autoE = computeAutoEndingStock(beginStock);
        const stockESourceKind = endingStockSourceKind(beginStock);
        const source = {
          E: stockESourceKind,
          F: stockFSourceKind,
          H: man.H != null ? 'manual' : (customs.sources?.H?.[key] || 'missing'),
          R: man.R != null ? 'manual_invoice' : autoRSource,
          // CNF(호주·베트남): 운임이 매입단가에 포함돼 운송료 전표가 없는 것이 정상 —
          // 'missing' 대신 별도 라벨로 표시해 항공료 누락 감사 대상에서 제외한다(2026-08-26).
          S: man.S != null ? 'manual' : hasStructuredS ? structuredSSource : autoS ? 'legacy_auto'
            : CNF_CATEGORIES.includes(key) ? 'cnf_included_in_purchase' : 'missing',
        };
        return {
          currency: curCode,
          category: key,
          variant: def.variant || 'normal',
          stock,
          beginStock,
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
            R: autoR,                                    // 당주 exact 원천 → 무매입일 때만 최근 exact R 이월
          },
          // exact resolver 참고 제안. 무매입 제한 이월은 rateCarry로 별도 표시한다.
          rateSuggestions: resolvedRate.suggestions,
          rateDetail: resolvedRate.detail,
          // 이번 차수에 재고화 대상 매입이 없어 과거 정확한 원천을 이어 쓴 경우에만 채워진다(그 외 null).
          // sourceYear/sourceMajor/originalSource/carryDepth/note — lib/profitReportTaxableRateCarry.js.
          rateCarry: (hasManualR || hasExactR) ? null : carry,
          // H 구성요소(백상 GW/관세/선율/월드운송료/방역) — 화면이 "왜 이 금액인지"를 그대로 보여준다.
          customsComponents: customs.components?.H?.[key] || null,
          manual: {
            E: null,
            F: null,
            H: man.H ?? null,
            R: man.R ?? null,
            S: man.S ?? null,              // 포워딩 수기 오버라이드(있으면 auto.S 대신)
            AC: man.AC ?? null,            // 매출조정 — 차수귀속을 원본 엑셀처럼 수동 반영(C·J 동시)
            AJ: man.AJ ?? null,            // 이익조정 — 매출은 두고 이익만 가감(원본 J셀 수정과 동일)
          },
          manualEvidence: cur.evidence?.[key] || {},
          inheritedE: false,
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
      selection: 'latest_product_stock_subweek',
      beginSnapshotAvailable: stockBegin.snapshotAvailable,
      endSnapshotAvailable: stockEnd.snapshotAvailable,
    },
    manualInputManifest,
    forwardingReconciliation: customs.sources?.forwardingLedger || null,
    audit: buildProfitReportAudit(rows, {
      major: currentMajor,
      forwardingLedger: customs.sources?.forwardingLedger || null,
      previousMajor: Number(prevMajor),
      previousOrderYear: prevOrderYear,
      previousForwardingLedger: prevCustoms.sources?.forwardingLedger || null,
      colombiaWeeks: customs.components?.colombiaWeeks || [],
      customsComponents: customs.components?.H || {},
      countryInbound: customs.sources?.countryInbound || {},
    }),
  };
}

/** 확정된 활성 스냅샷을 GET 응답 형태로 재구성 — 화면/엑셀이 loadReportData()와 동일한 rows/stockWeeks/audit
 * 모양을 기대하므로 shape을 맞춘다. row.calc는 확정 시점 값 그대로(재계산 금지) — 화면은 이 calc를 그대로 써야 한다. */
async function buildConfirmedPayload(major, orderYear, activeConfirmResult) {
  const { confirm, rowsByCategory, totalsCalc } = activeConfirmResult;
  const [manual, rates] = await Promise.all([loadManual(major, orderYear), currencyRates()]);
  const categories = profitReportCategoriesForWeek(Number(major));
  const rows = Object.keys(rowsByCategory).map((key) => {
    const def = categories.find(c => c.key === key) || {};
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
    manualInputManifest,
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
        const [endRateEvidenceByCurrency, beginRateEvidenceByCurrency] = await Promise.all([
          loadInventoryRateEvidenceByCurrency(orderYear, major),
          loadInventoryRateEvidenceByCurrency(prevOrderYear, prevMajor),
        ]);
        const list = await stockPriceRows(major, prevMajor, orderYear, prevOrderYear, {
          endRateEvidenceByCurrency,
          beginRateEvidenceByCurrency,
        });
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
      const { orderYear } = requireOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      const activeConfirm = await getActiveConfirm(orderYear, major);
      if (activeConfirm.initialized && activeConfirm.confirm) {
        return res.status(409).json({ success: false, error: '확정된 보고서는 취소 후 새 revision에서만 입력값을 변경할 수 있습니다.', code: 'REPORT_ALREADY_CONFIRMED' });
      }
      if (req.body?.action === 'stockPrices') {
        const endSnapshot = await latestStockSnapshotWeek(major, orderYear);
        const requestedWeek = String(req.body?.orderWeek || '');
        if (!endSnapshot.week || requestedWeek !== endSnapshot.week) {
          return res.status(409).json({ success: false, error: '현재 확정 기말 재고 스냅샷과 단가 근거의 OrderWeek가 일치하지 않습니다.', code: 'PRICE_EVIDENCE_SNAPSHOT_MISMATCH' });
        }
        await saveStockPrices(req.body?.prices || {}, actor, { orderYear, orderWeek: requestedWeek });
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
      await saveManual(major, orderYear, req.body?.values || {}, req.body?.note, actor, req.body?.evidence || {});
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code });
  }
});
