import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createSharedAwbHandler } from '../../../../lib/invoiceSharedAwbApi';
import { prepareNativeShared } from '../../../../lib/nativeSharedCost';

// 기존 입고(읽기 전용)의 같은 차수 콜롬비아 농장 전체를 한 번에 계산·다운로드한다.
// 일반 다운로드는 해당 차수 원가시트 단일 1장만 반환한다(누적 반영은 appendToMaster=true일 때만 수행).
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
export default withAuth(createSharedAwbHandler({ queryFn: query, types: sql, authorize: canManageInvoiceReceipt, prepare: prepareNativeShared }));
