import { withAuth } from '../../../../../lib/auth';
import { withTransaction, sql } from '../../../../../lib/db';
import { receiptApiHandler } from '../../../../../lib/invoiceReceiptApi';
import { saveInvoiceCostRevision } from '../../../../../lib/invoiceReceiptCost';

export function createInvoiceCostRevisionHandler({ withTransactionFn = withTransaction, types = sql } = {}) {
  return receiptApiHandler('POST', async req => ({
    cost: await saveInvoiceCostRevision({
      withTransactionFn,
      types,
      documentId: req.query.id,
      revision: req.body?.revision,
      actor: req.user.userId,
      input: req.body?.input,
      reason: req.body?.reason,
    }),
  }));
}

export default withAuth(createInvoiceCostRevisionHandler());
