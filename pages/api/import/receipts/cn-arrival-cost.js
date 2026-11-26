import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createCnArrivalCostHandler } from '../../../../lib/cnArrivalCostHttp';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default withAuth(createCnArrivalCostHandler({ queryFn: query, types: sql, authorize: canManageInvoiceReceipt }));
