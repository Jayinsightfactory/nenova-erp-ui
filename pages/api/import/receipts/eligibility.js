import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { isAdminUser, hasFullWebAccess } from '../../../../lib/userAccess';
import { readInvoiceReceiptEligibility } from '../../../../lib/invoiceReceiptEligibility';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

function canInspectReceipt(user) {
  if (!String(user?.userId || '').trim() || user?.accountActive === false) return false;
  const department = String(user?.deptName ?? user?.DeptName ?? '');
  const authority = user?.authority ?? user?.Authority;
  // Number(null/blank) is zero; missing authority must not grant admin access.
  const hasAuthority = authority != null && String(authority).trim() !== '';
  return /수입/.test(department) || department === '대표' || hasFullWebAccess(user)
    || (hasAuthority && isAdminUser(user));
}

// POST transports a bounded list of item keys. It performs no ERP/document writes.
export function createEligibilityHandler({ queryFn = query, types = sql } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, error: 'POST 요청만 지원합니다.' });
    }
    if (!canInspectReceipt(req.user)) {
      return res.status(403).json({ success: false, code: 'WAREHOUSE_WRITE_FORBIDDEN',
        error: '입고 등록 사전검사는 관리자 또는 수입부 계정만 가능합니다.' });
    }
    const { orderYear, orderWeek, prodKeys } = req.body || {};
    try {
      const eligibility = await readInvoiceReceiptEligibility({ queryFn, types, orderYear, orderWeek, prodKeys });
      return res.status(200).json({ success: true, eligibility,
        commitAvailable: false, erpWritePerformed: false,
        message: '확정 상태 조회 결과입니다. 입고 저장·재고 변경은 수행하지 않았습니다.' });
    } catch (error) {
      const inputError = ['INVOICE_RECEIPT_SCOPE_INVALID', 'INVOICE_RECEIPT_PRODUCTS_REQUIRED',
        'NATIVE_RECEIPT_YEAR_BLOCKED'].includes(error.code);
      return res.status(inputError ? 400 : 503).json({ success: false,
        code: inputError ? error.code : 'INVOICE_RECEIPT_CHECK_UNAVAILABLE',
        error: inputError ? error.message : '입고 가능 여부를 확인하지 못했습니다. 초안을 유지하고 다시 조회하세요.',
        commitAvailable: false, erpWritePerformed: false });
    }
  };
}

export default withAuth(createEligibilityHandler());
