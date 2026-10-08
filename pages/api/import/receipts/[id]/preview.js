import {withAuth} from '../../../../../lib/auth';
import {query,sql} from '../../../../../lib/db';
import {receiptApiHandler} from '../../../../../lib/invoiceReceiptApi';
import {previewInvoiceReceipt} from '../../../../../lib/invoiceReceiptWriter';
export const config={api:{bodyParser:{sizeLimit:'16kb'}}};
export default withAuth(receiptApiHandler('POST',async req=>({preview:await previewInvoiceReceipt({queryFn:query,types:sql,documentId:req.query.id,revision:req.body?.revision})})));
