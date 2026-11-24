import {withAuth} from '../../../../lib/auth';
import {query,sql} from '../../../../lib/db';
import {canManageInvoiceReceipt} from '../../../../lib/invoiceReceiptAccess';
import {createCloudCostMappingHandler} from '../../../../lib/cloudCostMappingHttp';
export const config={api:{bodyParser:{sizeLimit:'256kb'}}};
export default withAuth(createCloudCostMappingHandler({authorize:canManageInvoiceReceipt,queryFn:query,types:sql}));
