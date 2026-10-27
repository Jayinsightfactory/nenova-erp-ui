import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { listCostWarehouse } from '../../../../lib/invoiceWarehouseBrowse';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 가능합니다.' }); }
  if (!canManageInvoiceReceipt(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
  try { return res.status(200).json({ success: true, ...await listCostWarehouse({ queryFn: query, types: sql, input: req.query }) }); }
  catch (error) { return res.status(error.statusCode === 400 ? 400 : 503).json({ success: false, error: error.statusCode === 400 ? error.message : '입고내역을 조회하지 못했습니다. 다시 조회하세요.' }); }
});
