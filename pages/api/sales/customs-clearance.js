// 그외통관비 입력 API — 국가별(백상창고료/관세/선율/월드운송료/한국방역) + 콜롬비아 4품목 무게배분 공유입력.
// H(그외통관비) 자동값의 소스. 단가표(백상/트럭/검역대행/콜롬비아 박스무게)는 관리자 수정 가능.
import { withAuth } from '../../../lib/auth';
import { requireOrderYear, resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  COUNTRY_CATEGORIES,
  getRateConfig, saveRateConfig,
  loadCustomsWeekly, saveCustomsWeekly, saveCustomsWeeklyBatch,
  loadColombiaWeekly, saveColombiaWeekly,
  weeksForMajor, colombiaBoxQtyByCategory, colombiaHydrangeaBoxQty, loadWarehouseGw, activeCustomsCategories,
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
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.query.year);
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

      const [colombia, prevColombia] = await Promise.all([
        Promise.all(subWeeks.map(async (wk) => {
          const [row, boxQty, hydrangeaBoxQty] = await Promise.all([
            loadColombiaWeekly(wk, orderYear),
            colombiaBoxQtyByCategory(wk, orderYear),
            colombiaHydrangeaBoxQty(wk, orderYear),
          ]);
          return { orderWeek: wk, row, boxQty, hydrangeaBoxQty };
        })),
        Promise.all(prevSubWeeks.map((wk) => loadColombiaWeekly(wk, orderYear))),
      ]);

      // 국가/콜롬비아 모두 resolveCountryCustomsTotal/resolveColombiaCustomsAllocation을 거친다 —
      // 이 화면의 "합계"·박스수량이 실제 매출이익보고서 H 계산(computeCustomsAndForwarding)과
      // 항상 같은 값을 보이도록 두 API가 같은 함수 하나만 공유한다.
      //
      // 값의 출처는 3가지로 화면에서 구분된다.
      //  · saved       — 담당자가 이 차수에 실제로 저장한 값(항상 최우선)
      //  · historical  — 2026 22~27차 원본 엑셀 historical snapshot의 **구성요소**(저장행이 없을 때만
      //                  자동 적용, totalSource='excel_historical_snapshot'). 합계에 이미 반영돼 있다.
      //  · carry       — 전차수 참고값 제안. 합계 계산에 전혀 들어가지 않으며, 사용자가 "적용"을
      //                  눌러야만 저장 대상이 된다.
      const countries = COUNTRY_CATEGORIES.map((cat) => {
        const row = countryRows[cat] || null;
        const prevRow = prevCountryRows[cat] || null;
        const resolved = resolveCountryCustomsTotal({ row, gwDef: autoGw.countries?.[cat], rates, category: cat, orderYear, major });
        const historical = resolved.source === HISTORICAL_CUSTOMS_SOURCE ? resolved.row : null;
        return {
          category: cat,
          saved: row,
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
        const gwDef = autoGw.colombia?.[c.orderWeek];
        const resolved = resolveColombiaCustomsAllocation({
          orderWeek: c.orderWeek, orderYear, major, colRow: c.row, boxQty: c.boxQty,
          hydrangeaBoxes: c.hydrangeaBoxQty, gwDef, airTotal: 0, rates,
        });
        const historical = resolved.source === HISTORICAL_CUSTOMS_SOURCE ? resolved.row : null;
        return {
          orderWeek: c.orderWeek,
          saved: c.row,
          historical,
          carry: !c.row && !historical && prevColombia[i] ? prevColombia[i] : null, // 합계에는 미반영
          boxQty: resolved.boxQty,
          liveBoxQty: c.boxQty,                      // 현재 입고 DB 기준(원본과 다를 수 있어 비교용)
          hydrangeaBoxQty: Number(c.hydrangeaBoxQty) || 0,
          allocPool: resolved.allocPool,
          suggestedHydrangea: Boolean(gwDef?.includeHydrangea),
          ratioMode: resolved.ratioMode,
          total: resolved.total,
          totalSource: resolved.source,
          effectiveBakSangRate: resolved.effectiveRates?.BakSangRate ?? null,
          truckActual: resolved.truckActual,         // 실제 차량 대수(저장값/원본) — 합계에 반영된 값
          truckAuto: resolved.truckAuto,             // 합산 GW 용량분해 추천값(참고 표시 전용)
          truckSource: resolved.truckSource,
          allocationH: Object.fromEntries(Object.entries(resolved.allocation || {}).map(([cat, v]) => [cat, Math.round(v.H)])),
        };
      });

      return res.status(200).json({ success: true, major, orderYear, rates, countries, colombia: colombiaOut, autoGw, activeCategories });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const { orderYear } = requireOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';

      if (req.body?.action === 'saveRates') {
        await saveRateConfig(req.body?.rates || {}, actor, orderYear, major);
        return res.status(200).json({ success: true });
      }
      if (req.body?.action === 'saveCountry') {
        if (!req.body?.category) return res.status(400).json({ success: false, error: 'category 필요' });
        await saveCustomsWeekly(major, orderYear, req.body.category, req.body?.row || {}, actor);
        return res.status(200).json({ success: true });
      }
      if (req.body?.action === 'saveCountries') {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (!rows.length) return res.status(400).json({ success: false, error: '저장할 국가 입력값이 없습니다' });
        await saveCustomsWeeklyBatch(major, orderYear, rows, actor);
        return res.status(200).json({ success: true, saved: rows.length });
      }
      if (req.body?.action === 'saveColombia') {
        if (!req.body?.orderWeek) return res.status(400).json({ success: false, error: 'orderWeek 필요' });
        await saveColombiaWeekly(req.body.orderWeek, orderYear, req.body?.row || {}, actor);
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ success: false, error: '알 수 없는 action' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code });
  }
});
