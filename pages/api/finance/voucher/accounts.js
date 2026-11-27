// GET /api/finance/voucher/accounts — 계정과목 목록(읽기 전용). ?all=1 이면 비활성 포함.
import { withAuth } from '../../../../lib/auth';
import { listAccounts } from '../../../../lib/voucherStore';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
    const accounts = await listAccounts({ includeInactive: req.query.all === '1' });
    return res.status(200).json({ success: true, accounts, count: accounts.length });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
