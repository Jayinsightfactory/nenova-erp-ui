// /api/finance/voucher/[key] — 결의서 상세(GET, 읽기 전용) / 수정(PUT, 작성 상태만) / 삭제(DELETE, 작성 상태만·소프트)
import { withAuth } from '../../../../lib/auth';
import { withActionLog } from '../../../../lib/withActionLog';
import { getVoucher, updateVoucher, deleteVoucher } from '../../../../lib/voucherStore';

const STATUS_BY_CODE = { VALIDATION: 400, NOT_FOUND: 404, LOCKED: 409, TRANSITION: 409, UNBALANCED: 422, EMPTY: 422 };

async function handler(req, res) {
  const key = Number(req.query.key);
  if (!Number.isInteger(key) || key <= 0) return res.status(400).json({ success: false, error: 'voucherKey 필요' });
  const actor = req.user?.userId || req.user?.userName || 'unknown';
  try {
    if (req.method === 'GET') {
      const v = await getVoucher(key);
      if (!v) return res.status(404).json({ success: false, error: '결의서 없음' });
      return res.status(200).json({ success: true, voucher: v });
    }
    if (req.method === 'PUT') {
      const r = await updateVoucher(key, req.body || {}, actor);
      return res.status(200).json({ success: true, ...r, affectedCount: 1 });
    }
    if (req.method === 'DELETE') {
      const r = await deleteVoucher(key, actor);
      return res.status(200).json({ success: true, ...r, affectedCount: 1 });
    }
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(STATUS_BY_CODE[e.code] || 500).json({ success: false, error: e.message, code: e.code });
  }
}

export default withAuth(withActionLog(handler, { actionType: 'WEB_VOUCHER', affectedTable: 'WebVoucher/WebVoucherLine', riskLevel: 'LOW' }));
