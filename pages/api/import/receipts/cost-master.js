import { withAuth } from '../../../../lib/auth';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createCostMasterHandler } from '../../../../lib/costMasterHttp';

export const config = { api: { bodyParser: { sizeLimit: '16mb' } } };
export default withAuth(createCostMasterHandler({ authorize: canManageInvoiceReceipt }));
