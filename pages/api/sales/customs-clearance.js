// 그외통관비 입력 API — 국가별(백상창고료/관세/선율/월드운송료/한국방역) + 콜롬비아 4품목 무게배분 공유입력.
// H(그외통관비) 자동값의 소스. 단가표(백상/트럭/검역대행/콜롬비아 박스무게)는 관리자 수정 가능.
import { withAuth } from '../../../lib/auth';
import { applyProfitReportColombiaRates } from '../../../lib/profitReportCustomsPolicy';
import { requireOrderYear } from '../../../lib/orderUtils';
import { loadSettlementContext } from '../../../lib/customsSettlementContext';
import { phase03View, savePhase03 } from '../../../lib/customsPhase03Service';
import { safeAutoRefreshUnconfirmedProfitSnapshot } from '../../../lib/profitReportAutoRefresh';
import { loadSettlementEvidence, settlementCountryRow, settlementColombiaRow, settlementCountryValues, settlementColombiaValues } from '../../../lib/customsSettlementEvidence';
import { resolveCountryWeight, resolveColombiaWeight, isHistoricalWeightScope, assertInboundWeightUnchanged } from '../../../lib/customsWeightPolicy';
import {
  COUNTRY_CATEGORIES, COLOMBIA_POOLED_HYDRANGEA,
  getRateConfig, saveRateConfig,
  loadCustomsWeekly, saveCustomsWeekly, saveCustomsWeeklyBatch,
  loadColombiaWeekly, saveColombiaWeekly,
  weeksForMajor, colombiaBoxQtyByCategory, loadWarehouseGw, activeCustomsCategories,
  resolveCountryCustomsTotal, resolveColombiaCustomsAllocation, HISTORICAL_CUSTOMS_SOURCE,
} from '../../../lib/customsForwarding';

function parseMajor(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(-\d{2})?$/);
  return m ? m[1].padStart(2, '0') : null;
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const major = parseMajor(req.query.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 27)' });
      const { orderYear } = requireOrderYear(`${major}-01`, req.query.year);
      const prevMajor = String(Number(major) - 1).padStart(2, '0');

      const [rates, countryRows, prevCountryRows, subWeeks, prevSubWeeks, autoGw] = await Promise.all([
        getRateConfig(orderYear, major),
        loadCustomsWeekly(major, orderYear),
        loadCustomsWeekly(prevMajor, orderYear),
        weeksForMajor(major, orderYear),
        weeksForMajor(prevMajor, orderYear),
        loadWarehouseGw(major, orderYear), // 입고관리 GW — 무게 기준값(없으면 화면에서 '확인 필요' 표시)
      ]);
      const activeCategories = await activeCustomsCategories(major, orderYear); // 이 차수 입고 존재 국가만 기본 노출
      const settlement = await loadSettlementEvidence(orderYear, major);
      const settlementContext = await loadSettlementContext(orderYear, major);
      const phase03 = phase03View(settlementContext, settlement);

      const [colombia, prevColombia] = await Promise.all([
        Promise.all(subWeeks.map(async (wk) => {
          const [row, boxQty] = await Promise.all([loadColombiaWeekly(wk, orderYear), colombiaBoxQtyByCategory(wk, orderYear)]);
          return { orderWeek: wk, row, boxQty };
        })),
        Promise.all(prevSubWeeks.map((wk) => loadColombiaWeekly(wk, orderYear))),
      ]);

      // 국가/콜롬비아 모두 resolveCountryCustomsTotal/resolveColombiaCustomsAllocation을 거친다 —
      // 이 화면의 "합계"·박스수량이 실제 매출이익보고서 H 계산(computeCustomsAndForwarding)과
      // 항상 같은 값을 보이도록 두 API가 같은 함수 하나만 공유한다.
      //
      // 값의 출처는 3가지로 화면에서 구분된다.
      //  · saved       — 담당자가 이 차수에 저장한 비용 원본(중량 계산은 effectiveRow 사용)
      //  · historical  — 2026 22~27차 원본 엑셀 historical snapshot의 **구성요소**(저장행이 없을 때만
      //                  자동 적용, totalSource='excel_historical_snapshot'). 합계에 이미 반영돼 있다.
      //  · carry       — 전차수 참고값 제안. 합계 계산에 전혀 들어가지 않으며, 사용자가 "적용"을
      //                  눌러야만 저장 대상이 된다.
      const countries = COUNTRY_CATEGORIES.map((cat) => {
        const originalRow = countryRows[cat] || null;
        const row = settlementCountryRow(originalRow, settlement, cat, { year: orderYear, major, awbSources: settlementContext.candidates.filter(c => c.categories.includes(cat)) });
        const prevRow = prevCountryRows[cat] || null;
        const resolved = resolveCountryCustomsTotal({ row, gwDef: autoGw.countries?.[cat], rates, category: cat, orderYear, major });
        const historical = resolved.source === HISTORICAL_CUSTOMS_SOURCE ? resolved.row : null;
        return {
          category: cat,
          saved: originalRow,
          settlement: row !== originalRow ? { revision: settlement.revision, source: 'sun_yul_settlement_file', values: settlementCountryValues(originalRow,settlement,cat) } : null,
          effectiveRow: resolved.row,
          weightSource: resolved.weight.source,
          historical,                                // 원본 엑셀 구성요소(저장값이 없을 때만 채워짐)
          carry: !row && !historical && prevRow ? prevRow : null, // 합계 미반영, 참고 제안일 뿐
          worldFreightAuto: resolved.world.auto,
          worldFreightSource: resolved.world.source,
          effectiveBakSangRate: resolved.effectiveRates?.BakSangRate ?? null,
          total: resolved.total,
          totalSource: resolved.source,
        };
      });

      const colombiaOut = colombia.map((c, i) => {
        const settlementValues=settlementColombiaValues(c.row,settlement,c.orderWeek);
        const gwDef = autoGw.colombia?.[c.orderWeek];
        const hydBoxes = Number(gwDef?.hydrangeaBoxes) || 0;
        const boxQty = hydBoxes > 0 ? { ...c.boxQty, [COLOMBIA_POOLED_HYDRANGEA]: hydBoxes } : c.boxQty;
        const resolved = resolveColombiaCustomsAllocation({
          orderWeek: c.orderWeek, orderYear, major, colRow: settlementColombiaRow(c.row, settlement, c.orderWeek), boxQty, gwDef, airTotal: 0,
          rates: applyProfitReportColombiaRates(rates),
        });
        const historical = resolved.source === HISTORICAL_CUSTOMS_SOURCE ? resolved.row : null;
        return {
          orderWeek: c.orderWeek,
          saved: c.row,
          settlement: Object.keys(settlementValues).length ? { revision: settlement.revision, source: 'sun_yul_settlement_file', values: settlementValues } : null,
          effectiveRow: resolved.row,
          weight: resolved.weight,
          historical,
          carry: !c.row && !historical && prevColombia[i] ? prevColombia[i] : null, // 합계에는 미반영
          boxQty: resolved.boxQty,
          liveBoxQty: c.boxQty,                      // 현재 입고 DB 기준(원본과 다를 수 있어 비교용)
          total: resolved.total,
          totalSource: resolved.source,
          effectiveBakSangRate: resolved.effectiveRates?.BakSangRate ?? null,
          truckActual: resolved.truckActual,         // 실제 차량 대수(저장값/원본) — 합계에 반영된 값
          truckAuto: resolved.truckAuto,             // 합산 GW 용량분해 추천값(참고 표시 전용)
          truckSource: resolved.truckSource,
          allocationH: Object.fromEntries(Object.entries(resolved.allocation).map(([cat, value]) => [cat, Math.round(value.H)])),
        };
      });

      return res.status(200).json({ success: true, major, orderYear, rates, countries, colombia: colombiaOut, autoGw, activeCategories, phase03 });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const { orderYear } = requireOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      if (req.body?.action === 'savePhase03') {
        const saved = await savePhase03({ year: orderYear, major, input: req.body.row, expectedDigest: req.body.expectedDigest, confirmed: req.body.confirmed, actor });
        const snapshotRefresh = await safeAutoRefreshUnconfirmedProfitSnapshot({ orderYear, major, actor, trigger: 'customs:savePhase03' });
        return res.status(200).json({ ...saved, snapshotRefresh });
      }

      if (['saveCountry', 'saveCountries', 'saveColombia'].includes(req.body?.action)) {
        const autoGw = await loadWarehouseGw(major, orderYear);
        const options = { preserveSaved: isHistoricalWeightScope(orderYear, major) };
        if (req.body.action === 'saveColombia') {
          const target = requireOrderYear(req.body.orderWeek, orderYear);
          if (parseMajor(req.body.orderWeek) !== major) return res.status(400).json({ success: false, error: '선택 대차수와 저장 차수가 다릅니다' });
          const saved = await loadColombiaWeekly(req.body.orderWeek, target.orderYear);
          const weight = resolveColombiaWeight(saved, autoGw.colombia?.[req.body.orderWeek], options);
          assertInboundWeightUnchanged(req.body.row, weight.row, { GW: weight.source, CW: weight.source });
        } else {
          const saved = await loadCustomsWeekly(major, orderYear);
          const inputs = req.body.action === 'saveCountry' ? [{ category: req.body.category, row: req.body.row }] : Array.isArray(req.body.rows) ? req.body.rows : [];
          for (const input of inputs) {
            const weight = resolveCountryWeight(saved[input.category], autoGw.countries?.[input.category], options);
            assertInboundWeightUnchanged(input.row, weight.row, weight.source);
          }
        }
      }

      if (req.body?.action === 'saveRates') {
        await saveRateConfig(req.body?.rates || {}, actor, orderYear, major);
        const snapshotRefresh = await safeAutoRefreshUnconfirmedProfitSnapshot({ orderYear, major, actor, trigger: 'customs:saveRates' });
        return res.status(200).json({ success: true, snapshotRefresh });
      }
      if (req.body?.action === 'saveCountry') {
        if (!req.body?.category) return res.status(400).json({ success: false, error: 'category 필요' });
        await saveCustomsWeekly(major, orderYear, req.body.category, req.body?.row || {}, actor);
        const snapshotRefresh = await safeAutoRefreshUnconfirmedProfitSnapshot({ orderYear, major, actor, trigger: 'customs:saveCountry' });
        return res.status(200).json({ success: true, snapshotRefresh });
      }
      if (req.body?.action === 'saveCountries') {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (!rows.length) return res.status(400).json({ success: false, error: '저장할 국가 입력값이 없습니다' });
        await saveCustomsWeeklyBatch(major, orderYear, rows, actor);
        const snapshotRefresh = await safeAutoRefreshUnconfirmedProfitSnapshot({ orderYear, major, actor, trigger: 'customs:saveCountries' });
        return res.status(200).json({ success: true, saved: rows.length, snapshotRefresh });
      }
      if (req.body?.action === 'saveColombia') {
        if (!req.body?.orderWeek) return res.status(400).json({ success: false, error: 'orderWeek 필요' });
        await saveColombiaWeekly(req.body.orderWeek, orderYear, req.body?.row || {}, actor);
        const snapshotRefresh = await safeAutoRefreshUnconfirmedProfitSnapshot({ orderYear, major, actor, trigger: 'customs:saveColombia' });
        return res.status(200).json({ success: true, snapshotRefresh });
      }
      return res.status(400).json({ success: false, error: '알 수 없는 action' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code });
  }
});
