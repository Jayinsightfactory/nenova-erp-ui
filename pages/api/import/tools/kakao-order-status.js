import sql from 'mssql';
import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createKakaoOrderStatusHandler } from '../../../../lib/kakaoOrderErpStatus.js';

export default withAuth(
  createKakaoOrderStatusHandler({
    queryFn: query,
    types: sql,
    allowUser: canManageInvoiceReceipt,
  }),
);
