// 차수 마감 체크리스트. GET ?orderYear=2026&orderWeek=42-1 / POST {orderYear, orderWeek, itemCode, status, note}
// 상태 저장은 web_mgmt.WeekCloseCheck 추가 전용. ERP 원장은 읽기만.
import { withAuth } from '../../../lib/auth.js';
import { validateWeekInput, validateCheckInput, isCloseable } from '../../../lib/mgmt/weekCloseCore.js';
import { getWeekCloseState, appendWeekCheck } from '../../../lib/mgmt/weekClose.js';

export default withAuth(async function handler(req, res) {
  try {
    const src = req.method === 'POST' ? (req.body || {}) : req.query;
    const v = validateWeekInput(src.orderYear, src.orderWeek);
    if (!v.ok) return res.status(400).json({ success: false, error: v.error });
    if (req.method === 'POST') {
      const c = validateCheckInput(src);
      if (!c.ok) return res.status(400).json({ success: false, error: c.error });
      const week = v.week.variants ? v.week.variants[0] : v.week.major;
      await appendWeekCheck({ year: v.year, week, itemCode: c.itemCode, status: c.status, note: c.note, actorId: req.user?.userId || '' });
    } else if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }
    const state = await getWeekCloseState(v.year, v.week);
    return res.status(200).json({ success: true, ...state, closeable: isCloseable(state.items) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
