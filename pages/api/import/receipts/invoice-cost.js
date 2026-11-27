import {withAuth} from '../../../../lib/auth';
import {query,sql} from '../../../../lib/db';
import {canManageInvoiceReceipt} from '../../../../lib/invoiceReceiptAccess';
import {createInvoiceCostPreviewHandler} from '../../../../lib/invoiceCostPreview';
export const config={api:{bodyParser:{sizeLimit:'3mb'}}};
export default withAuth(createInvoiceCostPreviewHandler({queryFn:query,types:sql,authorize:canManageInvoiceReceipt}));
