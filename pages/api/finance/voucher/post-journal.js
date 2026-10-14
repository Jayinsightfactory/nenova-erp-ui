// POST /api/finance/voucher/post-journal — 결의서 상태 전이 + 전표 자동생성
// body: { voucherKey, action: 'approve' | 'remit' | 'post' | 'cancel' }
//   approve: 작성→결재완료, 자동분개 전표 생성(지출=비용 차변/보통예금 대변, 지급=외상매입금 차변/보통예금 대변+환차, 급여=급여 차변/보통예금 대변)
//   remit  : 결재완료→송금완료
//   post   : 송금완료→전표반영 (전표 확정=수정 불가)
//   cancel : →취소 (확정 전표는 역분개 전표로 상쇄, 미확정 전표는 취소 표시)
import { withAuth } from '../../../../lib/auth';
import { withActionLog } from '../../../../lib/withActionLog';
import { transitionVoucher } from '../../../../lib/voucherStore';

const STATUS_BY_CODE = { VALIDATION: 400, NOT_FOUND: 404, LOCKED: 409, TRANSITION: 409, UNBALANCED: 422, EMPTY: 422 };

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { voucherKey, action } = req.body || {};
  const key = Number(voucherKey);
  if (!Number.isInteger(key) || key <= 0) return res.status(400).json({ success: false, error: 'voucherKey 필요' });
  const actor = req.user?.userId || req.user?.userName || 'unknown';
  try {
    const r = await transitionVoucher(key, String(action || ''), actor);
    return res.status(200).json({ success: true, ...r, affectedCount: 1 });
  } catch (e) {
    return res.status(STATUS_BY_CODE[e.code] || 500).json({ success: false, error: e.message, code: e.code });
  }
}

export default withAuth(withActionLog(handler, { actionType: 'WEB_VOUCHER_POST_JOURNAL', affectedTable: 'WebVoucher/WebJournal/WebJournalLine', riskLevel: 'MEDIUM' }));
