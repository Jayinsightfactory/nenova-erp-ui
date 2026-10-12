import { withAuth } from '../../../../../lib/auth';
import { query, sql } from '../../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../../lib/invoiceReceiptAccess.js';
import { exportCurrentInvoiceCost } from '../../../../../lib/invoiceReceiptCostExport.js';

export function createInvoiceCostExportHandler({ queryFn = query, types = sql, exportFn = exportCurrentInvoiceCost } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET 요청만 지원합니다.' }); }
    if (!canManageInvoiceReceipt(req.user)) return res.status(403).json({ success: false, code: 'INVOICE_COST_EXPORT_FORBIDDEN', error: '원가 내보내기 권한이 없습니다.' });
    try {
      const { buffer, filename } = await exportFn({ queryFn, types, documentId: req.query.id,
        warehouseKey: req.query.warehouseKey, costRevisionId: req.query.costRevisionId });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(buffer);
    } catch (error) {
      const known = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
      return res.status(known ? error.statusCode : 503).json({ success: false,
        code: known ? error.code : 'INVOICE_COST_EXPORT_UNAVAILABLE', error: known ? error.message : '승인 원가 파일을 생성하지 못했습니다.' });
    }
  };
}
export default withAuth(createInvoiceCostExportHandler());
