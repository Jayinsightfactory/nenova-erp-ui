import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createNativeCostHandler } from '../../../../lib/nativeCostHttp';

export default withAuth(createNativeCostHandler({ queryFn: query, types: sql, authorize: canManageInvoiceReceipt }));
