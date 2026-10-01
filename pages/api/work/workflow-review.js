// pages/api/work/workflow-review.js — 직원 본인 업무흐름 확인(맞다/틀리다/수정).
//   GET  → { reviews:[{workflowName,verdict,correctedSteps,comment,reviewedAt}] }  (본인 것만)
//   POST { workflowName, verdict:'ok'|'fix'|'reject', correctedSteps?:string[], comment?, generatedAt? } → { ok }
// 누구의 판정인지는 로그인 토큰(req.user.userId)으로만 정한다. 바디의 이름·ID 는 무시. 웹 전용 테이블만 쓴다.
import { withAuth } from '../../../lib/auth';
import { workflowOwnerOf } from '../../../lib/workFlowOwners';
import { getReviewsFor, upsertReview } from '../../../lib/workflowReviewStore';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const owner = workflowOwnerOf(req.user);
  if (!owner) return res.status(403).json({ success: false, error: '확인 대상 계정이 아닙니다.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ success: true, reviews: await getReviewsFor(owner.erpUserId) });
    if (req.method === 'POST') {
      const body = req.body || {};
      try { return res.status(200).json({ success: true, ...(await upsertReview(owner, body)) }); }
      catch (e) { if (e.code === 'MIGRATION_REQUIRED') throw e; return res.status(400).json({ success: false, error: e.message }); }
    }
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (e) {
    if (e.code === 'MIGRATION_REQUIRED') return res.status(503).json({ success: false, error: '저장 준비 중입니다(관리자 설정 필요).' });
    throw e;
  }
}
export default withAuth(handler);
