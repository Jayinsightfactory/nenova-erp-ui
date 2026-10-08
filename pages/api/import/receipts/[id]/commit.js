import {withAuth} from '../../../../../lib/auth';
import {query,sql,withTransaction} from '../../../../../lib/db';
import {receiptApiHandler} from '../../../../../lib/invoiceReceiptApi';
import {createInvoiceReceipt} from '../../../../../lib/invoiceReceiptWriter';
export const config={api:{bodyParser:{sizeLimit:'16kb'}}};
export default withAuth(receiptApiHandler('POST',async req=>({result:await createInvoiceReceipt({queryFn:query,withTransactionFn:withTransaction,types:sql,
  documentId:req.query.id,revision:req.body?.revision,operationId:req.body?.operationId,receiptPartId:req.body?.receiptPartId,
  baselineDigest:req.body?.baselineDigest,reason:req.body?.reason,allowPendingCost:req.body?.allowPendingCost,actor:req.user.userId})})));
