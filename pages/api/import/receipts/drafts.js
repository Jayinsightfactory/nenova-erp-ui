import { withAuth } from '../../../../lib/auth';
import { query, sql, withTransaction } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { InvoiceReceiptDocumentError, listInvoiceDocuments, saveInvoiceDraft } from '../../../../lib/invoiceReceiptDocuments';

function sendError(res, error) {
  if (error instanceof InvoiceReceiptDocumentError || (error?.code && error?.statusCode)) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  }
  console.error('[invoice-receipt-drafts]', error);
  return res.status(500).json({ success: false, code: 'INVOICE_DRAFT_SERVER_ERROR', error: '인보이스 초안을 처리하지 못했습니다.' });
}

export function createInvoiceReceiptDraftsHandler({ queryFn = query, withTransactionFn = withTransaction, types = sql } = {}) {
  return async function invoiceReceiptDraftsHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!canManageInvoiceReceipt(req.user)) {
      return res.status(403).json({ success: false, code: 'INVOICE_RECEIPT_FORBIDDEN', error: '인보이스 입고 관리 권한이 없습니다.' });
    }
    try {
      if (req.method === 'GET') {
        const documents = await listInvoiceDocuments({ queryFn, types, orderYear: req.query?.orderYear, orderWeek: req.query?.orderWeek });
        return res.status(200).json({ success: true, documents });
      }
      if (req.method === 'POST') {
        const document = await saveInvoiceDraft({ withTransactionFn, types, input: req.body, actor: req.user.userId });
        return res.status(201).json({ success: true, document });
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 POST만 허용됩니다.' });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default withAuth(createInvoiceReceiptDraftsHandler());
