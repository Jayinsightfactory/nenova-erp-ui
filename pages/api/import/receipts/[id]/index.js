import { withAuth } from '../../../../../lib/auth';
import { query, sql, withTransaction } from '../../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../../lib/invoiceReceiptAccess';
import { getInvoiceDocument, InvoiceReceiptDocumentError, saveInvoiceDraft } from '../../../../../lib/invoiceReceiptDocuments';

function routeId(req) {
  return Array.isArray(req.query?.id) ? null : req.query?.id;
}

function sendError(res, error) {
  if (error instanceof InvoiceReceiptDocumentError || (error?.code && error?.statusCode)) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  }
  console.error('[invoice-receipt-document]', error);
  return res.status(500).json({ success: false, code: 'INVOICE_DOCUMENT_SERVER_ERROR', error: '인보이스 문서를 처리하지 못했습니다.' });
}

export function createInvoiceReceiptDocumentHandler({ queryFn = query, withTransactionFn = withTransaction, types = sql } = {}) {
  return async function invoiceReceiptDocumentHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!canManageInvoiceReceipt(req.user)) {
      return res.status(403).json({ success: false, code: 'INVOICE_RECEIPT_FORBIDDEN', error: '인보이스 입고 관리 권한이 없습니다.' });
    }
    try {
      const documentId = routeId(req);
      if (req.method === 'GET') {
        const document = await getInvoiceDocument({ queryFn, types, documentId });
        if (!document) return res.status(404).json({ success: false, code: 'INVOICE_DOCUMENT_NOT_FOUND', error: '인보이스 문서를 찾을 수 없습니다.' });
        return res.status(200).json({ success: true, document });
      }
      if (req.method === 'PATCH') {
        const document = await saveInvoiceDraft({ withTransactionFn, types, input: req.body, actor: req.user.userId, documentId });
        return res.status(200).json({ success: true, document });
      }
      res.setHeader('Allow', 'GET, PATCH');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 PATCH만 허용됩니다.' });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default withAuth(createInvoiceReceiptDocumentHandler());
