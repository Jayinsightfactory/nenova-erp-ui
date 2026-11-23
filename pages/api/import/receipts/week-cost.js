import {withAuth} from '../../../../lib/auth';
import {query,sql} from '../../../../lib/db';
import {canManageInvoiceReceipt} from '../../../../lib/invoiceReceiptAccess';
import {createArrivalWeekCostHandler} from '../../../../lib/arrivalWeekCostHttp';
export default withAuth(createArrivalWeekCostHandler({queryFn:query,types:sql,authorize:canManageInvoiceReceipt}));
