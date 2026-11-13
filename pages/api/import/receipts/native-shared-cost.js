import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { createSharedAwbHandler } from '../../../../lib/invoiceSharedAwbApi';
import { prepareNativeShared } from '../../../../lib/nativeSharedCost';
import { exportWithCostHistory } from '../../../../lib/invoiceCostHistoryService';

// 기존 입고(읽기 전용)의 같은 차수 콜롬비아 농장 전체를 한 번에 계산·다운로드한다.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
export default withAuth(createSharedAwbHandler({ queryFn: query, types: sql, authorize: canManageInvoiceReceipt, prepare: prepareNativeShared,
  // 다른 원가 다운로드와 같이 업무드라이브 원본에서 시작한 과거 차수 시트 보존을 거친다(서버 누적 파일을 직접 쓰는 appendToMaster는 예외).
  preserveHistory: exportWithCostHistory }));
