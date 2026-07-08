// 주차별 매출이익 보고서 API — 자동열은 SQL, 수기열은 WebProfitReport 저장.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  CATEGORIES, EXTRA_CATEGORY,
  salesByCategory, estimateByCategory, purchaseByCategory, forwardingByCategory,
  currencyRates, loadManual, saveManual,
} from '../../../lib/profitReport';

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

      const [N, est, Q, S, rates, cur, prev] = await Promise.all([
        salesByCategory(major, orderYear),
        estimateByCategory(major, orderYear),
        purchaseByCategory(major, orderYear),
        forwardingByCategory(major, orderYear),
        currencyRates(),
        loadManual(major, orderYear),
        loadManual(prevMajor, orderYear), // 전차수 기말재고(F) → 이번 기초(E) 기본값
      ]);

      const keys = [...CATEGORIES.map(c => c.key)];
      const extraHasData = [N, est.L, est.O, Q, S].some(m => Math.abs(Number(m?.[EXTRA_CATEGORY] || 0)) > 0.001);
      if (extraHasData) keys.push(EXTRA_CATEGORY);

      const rows = keys.map(key => {
        const def = CATEGORIES.find(c => c.key === key) || {};
        const man = cur.manual[key] || {};
        const prevF = prev.manual[key]?.F;
        return {
          category: key,
          variant: def.variant || 'normal',
          auto: {
            N: Number(N[key] || 0),
            L: Number(est.L[key] || 0),
            O: Number(est.O[key] || 0),
            Q: Number(Q[key] || 0),
            S: Number(S[key] || 0),
          },
          manual: {
            E: man.E ?? (prevF ?? null),   // 기초 = 전차수 기말 이월(수정 가능)
            F: man.F ?? null,
            H: man.H ?? null,
            R: man.R ?? null,
            S: man.S ?? null,              // 포워딩 수기 오버라이드(있으면 auto.S 대신)
          },
          inheritedE: man.E == null && prevF != null,
        };
      });

      return res.status(200).json({
        success: true, major, orderYear, rows, note: cur.note, rates,
      });
    }

    if (req.method === 'POST') {
      const major = parseMajor(req.body?.week);
      if (!major) return res.status(400).json({ success: false, error: 'week 필요' });
      const orderYear = resolveActiveOrderYear(`${major}-01`, req.body?.year);
      const actor = req.user?.userName || req.user?.userId || 'user';
      await saveManual(major, orderYear, req.body?.values || {}, req.body?.note, actor);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
