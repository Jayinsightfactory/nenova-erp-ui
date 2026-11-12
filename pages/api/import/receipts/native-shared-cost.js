import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createSharedAwbHandler } from '../../../../lib/invoiceSharedAwbApi';
import { prepareNativeShared } from '../../../../lib/nativeSharedCost';

// 기존 입고(읽기 전용)의 같은 차수 콜롬비아 농장 전체를 한 번에 계산·다운로드한다.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
export default withAuth(createSharedAwbHandler({ queryFn: query, types: sql, authorize: canManageInvoiceReceipt, prepare: prepareNativeShared }));
