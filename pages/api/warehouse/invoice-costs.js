import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { readInvoiceCosts } from '../../../lib/invoiceReceiptCost';

export function createInvoiceCostReadHandler({ queryFn = query, types = sql } = {}) {
  return async function invoiceCostReadHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
    }
    try {
      const costs = await readInvoiceCosts({ queryFn, types, warehouseKey: req.query.warehouseKey });
      return res.status(200).json({ success: true, costs });
    } catch (error) {
      const known = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
      return res.status(known ? error.statusCode : 503).json({
        success: false,
        code: known ? error.code : 'INVOICE_COST_READ_UNAVAILABLE',
        error: known ? error.message : '입고 원가를 조회하지 못했습니다.',
      });
    }
  };
}

export default withAuth(createInvoiceCostReadHandler());
