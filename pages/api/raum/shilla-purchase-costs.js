import { withAuth } from '../../../lib/auth';
import { loadRaumPnlCostComparisonRows } from '../../../lib/raumPnlCostComparisonServer';
import { loadRaumPnlPurchaseCostYears, saveRaumPnlPurchaseCosts } from '../../../lib/raumPnlPurchaseCost';

// 신라 단가는 라움·초이문 공통 단가와 독립. ERP/학습 원장 쓰기 없음.
export default withAuth(async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: '조회 또는 저장만 가능합니다.' });
    const orderYear = String(req.method === 'GET' ? req.query.year || '' : req.body?.orderYear || '').trim();
    if (!/^\d{4}$/.test(orderYear)) return res.status(400).json({ success: false, error: '신라 결산 연도를 선택하세요.' });
    let saved = {};
    if (req.method === 'POST') {
      saved = await saveRaumPnlPurchaseCosts({ orderYear, partnerCode: 'shilla', updates: req.body?.updates, actor: req.user?.userName || req.user?.userId || 'user' });
    }
    const [rows, years] = await Promise.all([
      loadRaumPnlCostComparisonRows({ orderYear, partnerCode: 'shilla' }),
      loadRaumPnlPurchaseCostYears('shilla'),
    ]);
    return res.status(200).json({ success: true, ...saved, rows, shillaRows: rows, years, orderYear });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ success: false, error: error.message, code: error.code || null });
  }
});
