import {withAuth} from '../../../../lib/auth';
import {query,sql} from '../../../../lib/db';
import {canManageInvoiceReceipt} from '../../../../lib/invoiceReceiptAccess';
import {createCloudCostReviewHandler} from '../../../../lib/cloudCostReviewHttp';
export default withAuth(createCloudCostReviewHandler({queryFn:query,types:sql,authorize:canManageInvoiceReceipt}));
