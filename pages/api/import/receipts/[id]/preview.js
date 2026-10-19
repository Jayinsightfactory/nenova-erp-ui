import {withAuth} from '../../../../../lib/auth';
import {withTransaction,sql} from '../../../../../lib/db';
import {receiptApiHandler} from '../../../../../lib/invoiceReceiptApi';
import {previewInvoiceWithAudit} from '../../../../../lib/invoiceValidationAudit';
export const config={api:{bodyParser:{sizeLimit:'16kb'}}};
export default withAuth(receiptApiHandler('POST',async req=>({preview:await previewInvoiceWithAudit({withTransactionFn:withTransaction,types:sql,documentId:req.query.id,revision:req.body?.revision,actor:req.user.userId})})));
