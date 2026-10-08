// /api/finance/voucher — 지출결의서 목록(GET, 읽기 전용) / 생성(POST)
// 명세 §7-1~7-3·§11. 웹 전용 dbo.WebVoucher/WebVoucherLine 만 쓴다. ERP 테이블 preserve.
// GET  ?dateFrom&dateTo&voucherType&status&custKey&custName&amountMin&amountMax&descr&voucherNo
// POST { voucherType, voucherDate, custKey, custName, period, manager, employeeName, fundCode, currency, fxRate, attachUrl, memo, lines[] }
import { withAuth } from '../../../../lib/auth';
import { withActionLog } from '../../../../lib/withActionLog';
import { listVouchers, createVoucher } from '../../../../lib/voucherStore';

const STATUS_BY_CODE = { VALIDATION: 400, NOT_FOUND: 404, LOCKED: 409, TRANSITION: 409, UNBALANCED: 422, EMPTY: 422 };

async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const r = await listVouchers(req.query || {});
      return res.status(200).json({ success: true, ...r });
    }
    if (req.method === 'POST') {
      const actor = req.user?.userId || req.user?.userName || 'unknown';
      const r = await createVoucher(req.body || {}, actor);
      return res.status(201).json({ success: true, ...r, affectedCount: 1 });
    }
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(STATUS_BY_CODE[e.code] || 500).json({ success: false, error: e.message, code: e.code });
  }
}

export default withAuth(withActionLog(handler, { actionType: 'WEB_VOUCHER', affectedTable: 'WebVoucher/WebVoucherLine', riskLevel: 'LOW' }));
