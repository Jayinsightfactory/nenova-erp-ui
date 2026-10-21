// 거래처별 이익·월 목표 API. GET ?month=YYYY-MM / POST {custKey, targetMonth, targetSalesKRW, targetProfitKRW} 목표 추가(이력).
import { withAuth } from '../../../lib/auth.js';
import { denyIfNotMgmtAdmin } from '../../../lib/mgmt/access.js';
import { loadCustomerProfitMonth, appendTarget } from '../../../lib/mgmt/customerProfit.js';
import { validateTargetInput } from '../../../lib/mgmt/customerProfitCore.js';

export default withAuth(async function handler(req, res) {
  if (denyIfNotMgmtAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const month = String(req.query.month || '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ success: false, error: 'month 형식 YYYY-MM' });
      return res.status(200).json({ success: true, ...(await loadCustomerProfitMonth(month)) });
    }
    if (req.method === 'POST') {
      const v = validateTargetInput(req.body);
      if (v.error) return res.status(400).json({ success: false, error: v.error });
      const targetKey = await appendTarget({ ...v, actorId: req.user?.userId || '' });
      return res.status(200).json({ success: true, targetKey });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
