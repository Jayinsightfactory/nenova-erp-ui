// 포워딩 입력 API — 네덜란드/중국/콜롬비아 수국/에콰도르/태국 국가별 USD 직접입력 + 콜롬비아 4품목 항공료단가(반차수 공유값).
// S(포워딩) 자동값의 소스.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  FORWARDING_DIRECT_CATEGORIES, COLOMBIA_ALLOC_CATEGORIES,
  getRateConfig, loadForwardingWeekly, saveForwardingWeekly,
  loadColombiaWeekly, saveColombiaWeekly,
  weeksForMajor, colombiaBoxQtyByCategory,
  computeColombiaAllocation,
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

      const [rates, fwd, prevFwd, subWeeks, prevSubWeeks] = await Promise.all([
        getRateConfig(),
        loadForwardingWeekly(major, orderYear),
        loadForwardingWeekly(prevMajor, orderYear),
        weeksForMajor(major, orderYear),
        weeksForMajor(prevMajor, orderYear),
      ]);

      const direct = FORWARDING_DIRECT_CATEGORIES.map((cat) => ({
        category: cat,
        saved: fwd[cat] != null ? fwd[cat] : null,
        carry: fwd[cat] == null && prevFwd[cat] != null ? prevFwd[cat] : null,
      }));

      const [colombia, prevColombia] = await Promise.all([
        Promise.all(subWeeks.map(async (wk) => {
          const [row, boxQty] = await Promise.all([loadColombiaWeekly(wk, orderYear), colombiaBoxQtyByCategory(wk, orderYear)]);
          return { orderWeek: wk, row, boxQty };
        })),
        Promise.all(prevSubWeeks.map((wk) => loadColombiaWeekly(wk, orderYear))),
      ]);

      const colombiaOut = colombia.map((c, i) => {
        const alloc = computeColombiaAllocation(c.row || {}, c.boxQty, rates);
        return {
          orderWeek: c.orderWeek,
          savedAirRateUSD: c.row?.AirRateUSD ?? null,
          carryAirRateUSD: (c.row?.AirRateUSD == null && prevColombia[i]?.AirRateUSD != null) ? prevColombia[i].AirRateUSD : null,
          gw: c.row?.GW ?? null, cw: c.row?.CW ?? null, // 그외통관비 입력 화면에서 저장한 값 참고 표시(여기선 읽기전용)
          boxQty: c.boxQty,
          allocationS: Object.fromEntries(COLOMBIA_ALLOC_CATEGORIES.map((cat) => [cat, Math.round(alloc[cat].S * 100) / 100])),
        };
      });

      return res.status(200).json({ success: true, major, orderYear, direct, colombia: colombiaOut });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';

      if (req.body?.action === 'saveDirect') {
        if (!req.body?.category) return res.status(400).json({ success: false, error: 'category 필요' });
        await saveForwardingWeekly(major, orderYear, req.body.category, req.body?.amountUSD, actor);
        return res.status(200).json({ success: true });
      }
      if (req.body?.action === 'saveColombiaAir') {
        if (!req.body?.orderWeek) return res.status(400).json({ success: false, error: 'orderWeek 필요' });
        await saveColombiaWeekly(req.body.orderWeek, orderYear, { AirRateUSD: req.body?.airRateUSD }, actor);
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ success: false, error: '알 수 없는 action' });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
