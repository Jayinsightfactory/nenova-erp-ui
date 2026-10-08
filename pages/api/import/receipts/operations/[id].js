import {withAuth} from '../../../../../lib/auth';
import {query,sql} from '../../../../../lib/db';
import {receiptApiHandler} from '../../../../../lib/invoiceReceiptApi';
import {getInvoiceReceiptOperation} from '../../../../../lib/invoiceReceiptWriter';
export default withAuth(receiptApiHandler('GET',async req=>({operation:await getInvoiceReceiptOperation({queryFn:query,types:sql,operationId:req.query.id})})));
