import {withAuth} from '../../../../lib/auth';
import {query,sql} from '../../../../lib/db';
import {canManageInvoiceReceipt} from '../../../../lib/invoiceReceiptAccess';
import {createColombiaWeekCostHandler} from '../../../../lib/colombiaWeekCostApi';
export const config={api:{bodyParser:{sizeLimit:'1mb'},responseLimit:'14mb'}};
export default withAuth(createColombiaWeekCostHandler({queryFn:query,types:sql,authorize:canManageInvoiceReceipt}));
