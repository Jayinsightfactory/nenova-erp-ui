import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createSharedAwbHandler } from '../../../../lib/invoiceSharedAwbApi';
export const config={api:{bodyParser:{sizeLimit:'1mb'}}};
export default withAuth(createSharedAwbHandler({queryFn:query,types:sql,authorize:canManageInvoiceReceipt}));
