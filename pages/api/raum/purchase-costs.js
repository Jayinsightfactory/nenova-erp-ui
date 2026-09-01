import { withAuth } from '../../../lib/auth';
import { PNL_PARTNERS } from '../../../lib/raumPnlPartner';
import { loadRaumPnlPurchaseCostRows } from '../../../lib/raumPnlCostComparisonServer';
import {
  loadRaumPnlPurchaseCostYears,
  saveRaumSharedPurchaseCosts,
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

// 라움·초이문 공통 매입단가 관리 화면 전용: 거래처 선택 없이 연도만 명시한다.
// 요청에 partner가 실려와도 저장 범위에는 사용하지 않는다(양쪽 활성 결산을 항상 함께 처리).
export default withAuth(async function handler(req, res) {
  try {
    const orderYear = explicitYear(req.method === 'GET' ? req.query.year : req.body?.orderYear);

    if (req.method === 'GET') {
      const [rows, years] = await Promise.all([
        loadRaumPnlPurchaseCostRows({ orderYear }),
        loadRaumPnlPurchaseCostYears(),
      ]);
      return res.status(200).json({
        success: true,
        orderYear,
        years,
        rows,
        partners: Object.values(PNL_PARTNERS).map(p => ({ code: p.code, label: p.label })),
      });
    }

    if (req.method === 'POST') {
      const actor = req.user?.userName || req.user?.userId || 'user';
      const result = await saveRaumSharedPurchaseCosts({
        orderYear,
        updates: req.body?.updates,
        actor,
      });
      const rows = await loadRaumPnlPurchaseCostRows({ orderYear });
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
