import { withAuth } from '../../../lib/auth.js';
import { requirePnlPartner } from '../../../lib/pnlHotelRegistry.js';
import { loadRaumPnlCostComparisonRows } from '../../../lib/raumPnlCostComparisonServer.js';
import { loadRaumPnlPurchaseCostYears, saveRaumPnlPurchaseCosts } from '../../../lib/raumPnlPurchaseCost.js';

// Shilla and registered hotels keep independent costs. Raum/Choimun must use
// the shared endpoint so a client cannot bypass the shared-cost contract.
export default withAuth(async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: '조회 또는 저장만 가능합니다.' });
    const partner = await requirePnlPartner(req.method === 'GET' ? req.query.partner : req.body?.partnerCode);
    if (['raum', 'choimun'].includes(partner.code)) return res.status(400).json({ success: false, error: '라움·초이문 단가는 공통 매입단가에서 저장하세요.' });
    const orderYear = String(req.method === 'GET' ? req.query.year || '' : req.body?.orderYear || '').trim();
    if (!/^\d{4}$/.test(orderYear)) return res.status(400).json({ success: false, error: `${partner.label} 결산 연도를 선택하세요.` });
    let saved = {};
    if (req.method === 'POST') {
      saved = await saveRaumPnlPurchaseCosts({
        orderYear,
        partnerCode: partner.code,
        updates: req.body?.updates,
        actor: req.user?.userName || req.user?.userId || 'user',
      });
    }
    const [rows, years] = await Promise.all([
      loadRaumPnlCostComparisonRows({ orderYear, partnerCode: partner.code }),
      loadRaumPnlPurchaseCostYears(partner.code),
    ]);
    return res.status(200).json({ success: true, ...saved, rows, years, orderYear, partner });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ success: false, error: error.message, code: error.code || null });
  }
});
