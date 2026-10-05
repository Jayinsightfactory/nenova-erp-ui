import { withAuth } from '../../../lib/auth';
import { loadPnlHotelCostHistory } from '../../../lib/pnlHotelCostHistory.js';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '조회만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const result = await loadPnlHotelCostHistory({ orderYear: req.query.year });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(Number(error.statusCode) || 503).json({
      success: false, code: error.code || 'HOTEL_COST_HISTORY_UNAVAILABLE',
      error: error.statusCode ? error.message : '호텔별 매입단가를 조회하지 못했습니다. 다시 조회하세요.',
    });
  }
});
