// 그외통관비 입력 API — 국가별(백상창고료/관세/선율/월드운송료/한국방역) + 콜롬비아 4품목 무게배분 공유입력.
// H(그외통관비) 자동값의 소스. 단가표(백상/트럭/검역대행/콜롬비아 박스무게)는 관리자 수정 가능.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  COUNTRY_CATEGORIES, COLOMBIA_ALLOC_CATEGORIES,
  getRateConfig, saveRateConfig,
  loadCustomsWeekly, saveCustomsWeekly,
  loadColombiaWeekly, saveColombiaWeekly,
  weeksForMajor, colombiaBoxQtyByCategory, loadWarehouseGw, activeCustomsCategories,
  mergeCountryGw, mergeColombiaGw,
  computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaAllocation,
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
        getRateConfig(),
        loadCustomsWeekly(major, orderYear),
        loadCustomsWeekly(prevMajor, orderYear),
        weeksForMajor(major, orderYear),
        weeksForMajor(prevMajor, orderYear),
        loadWarehouseGw(major, orderYear), // 입고관리 GW — 무게 기준값(없으면 화면에서 '확인 필요' 표시)
      ]);
      const activeCategories = await activeCustomsCategories(major, orderYear); // 이 차수 입고 존재 국가만 기본 노출

      const [colombia, prevColombia] = await Promise.all([
        Promise.all(subWeeks.map(async (wk) => {
          const [row, boxQty] = await Promise.all([loadColombiaWeekly(wk, orderYear), colombiaBoxQtyByCategory(wk, orderYear)]);
          return { orderWeek: wk, row, boxQty };
        })),
        Promise.all(prevSubWeeks.map((wk) => loadColombiaWeekly(wk, orderYear))),
      ]);

      const countries = COUNTRY_CATEGORIES.map((cat) => {
        const row = countryRows[cat] || null;
        const prevRow = prevCountryRows[cat] || null;
        return {
          category: cat,
          saved: row,
          carry: !row && prevRow ? prevRow : null, // 저장값 없을 때만 전차수 값을 기본값으로 제안(사장님 지정)
          // 합계는 입고 GW 기준 병합값으로 — 수기 무게가 없어도 백상창고료가 잡힘 (수기 우선)
          total: computeCountryCustomsTotal(mergeCountryGw(row, autoGw.countries?.[cat]), rates, cat),
        };
      });

      const colombiaOut = colombia.map((c, i) => {
        const effRow = mergeColombiaGw(c.row, autoGw.colombia?.[c.orderWeek]);
        const total = computeColombiaCustomsTotal(effRow, rates);
        const alloc = computeColombiaAllocation(effRow, c.boxQty, rates);
        return {
          orderWeek: c.orderWeek,
          saved: c.row,
          carry: !c.row && prevColombia[i] ? prevColombia[i] : null,
          boxQty: c.boxQty,
          total,
          allocationH: Object.fromEntries(COLOMBIA_ALLOC_CATEGORIES.map((cat) => [cat, Math.round(alloc[cat].H)])),
        };
      });

      return res.status(200).json({ success: true, major, orderYear, rates, countries, colombia: colombiaOut, autoGw, activeCategories });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';

      if (req.body?.action === 'saveRates') {
        await saveRateConfig(req.body?.rates || {}, actor);
        return res.status(200).json({ success: true });
      }
      if (req.body?.action === 'saveCountry') {
        if (!req.body?.category) return res.status(400).json({ success: false, error: 'category 필요' });
        await saveCustomsWeekly(major, orderYear, req.body.category, req.body?.row || {}, actor);
        return res.status(200).json({ success: true });
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
    return res.status(500).json({ success: false, error: e.message });
  }
});
