import { withAuth } from '../../../lib/auth';
import { resolvePnlPartner } from '../../../lib/raumPnlPartner';
import { loadRaumPnlCostComparisonRows } from '../../../lib/raumPnlCostComparisonServer';
import {
  loadRaumPnlPurchaseCostYears,
  saveRaumPnlPurchaseCosts,
} from '../../../lib/raumPnlPurchaseCost';

function explicitYear(value) {
  const year = String(value || '').trim();
  if (!/^\d{4}$/.test(year)) {
    const error = new Error('조회할 연도를 직접 선택해 주세요.');
    error.statusCode = 400;
    throw error;
  }
  return year;
}

function explicitPartner(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!code) {
    const error = new Error('라움 또는 초이문을 직접 선택해 주세요.');
    error.statusCode = 400;
    throw error;
  }
  return resolvePnlPartner(code);
}

export default withAuth(async function handler(req, res) {
  try {
    const partner = explicitPartner(req.method === 'GET' ? req.query.partner : req.body?.partnerCode);
    const orderYear = explicitYear(req.method === 'GET' ? req.query.year : req.body?.orderYear);

    if (req.method === 'GET') {
      const [rows, years] = await Promise.all([
        loadRaumPnlCostComparisonRows({ orderYear, partnerCode: partner.code }),
        loadRaumPnlPurchaseCostYears(partner.code),
      ]);
      return res.status(200).json({ success: true, partner: { code: partner.code, label: partner.label }, orderYear, years, rows });
    }

    if (req.method === 'POST') {
      const actor = req.user?.userName || req.user?.userId || 'user';
      const result = await saveRaumPnlPurchaseCosts({
        orderYear,
        partnerCode: partner.code,
        updates: req.body?.updates,
        actor,
      });
      const rows = await loadRaumPnlCostComparisonRows({ orderYear, partnerCode: partner.code });
      return res.status(200).json({ success: true, ...result, rows });
    }

    return res.status(405).json({ success: false, error: 'GET 또는 POST만 사용할 수 있습니다.' });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      code: error?.code || null,
      error: error?.message || '차수별 매입단가 처리 중 오류가 발생했습니다.',
    });
  }
});
