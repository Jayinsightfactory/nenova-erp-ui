import { withAuth } from '../../../../../lib/auth';
import { withTransaction, sql } from '../../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../../lib/invoiceReceiptAccess';
import { appendInvoiceReceiptStageEvent } from '../../../../../lib/invoiceReceiptStageLog';

export function createInvoiceReceiptStageEventsHandler({ withTransactionFn = withTransaction, types = sql, appendEventFn = appendInvoiceReceiptStageEvent } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const reject = (status, code, error) => res.status(status).json({ success: false, code, error, stageLogOnly: true, receiptRetryRequired: false });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reject(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.'); }
    if (!canManageInvoiceReceipt(req.user)) return reject(403, 'INVOICE_RECEIPT_FORBIDDEN', '단계 로그 기록 권한이 없습니다.');
    try {
      const result = await appendEventFn({ withTransactionFn, types, documentId: req.query.id, actor: req.user.userId, input: req.body });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      const known = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
      return reject(known ? error.statusCode : 503, known ? error.code : 'STAGE_LOG_UNAVAILABLE', known ? error.message : '단계 이력 기록을 확인하지 못했습니다. 입고 작업을 다시 실행하지 마세요.');
    }
  };
}
export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };
export default withAuth(createInvoiceReceiptStageEventsHandler());
