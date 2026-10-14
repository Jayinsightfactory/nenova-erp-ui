import { withAuth } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import store from '../../../lib/userActivityStore.cjs';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
export async function activityHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (req.query.me === '1') return res.status(200).json({ success: true, userId: req.user.userId, record: true, canView: isOrbitReportViewer(req.user), health: store.getHealth() });
    if (!isOrbitReportViewer(req.user)) return res.status(404).json({ success: false, error: 'Not found' });
    try { return res.status(200).json({ success: true, ...await store.listEvents(req.query) }); }
    catch (error) { return res.status(error.message.startsWith('INVALID_') ? 400 : 503).json({ success: false, code: error.code === 'ACTIVITY_QUERY_TOO_LARGE' ? error.code : 'ACTIVITY_QUERY_FAILED', error: error.code === 'ACTIVITY_QUERY_TOO_LARGE' ? '조회량이 너무 많습니다. 날짜와 시간(hour, 한국시간 0~23)을 좁혀 주세요. 일부 기록을 생략하지 않고 조회를 중단했습니다.' : '활동 기록을 조회하지 못했습니다.' }); }
  }
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body?.expectedUserId !== req.user.userId) return res.status(409).json({ success: false, error: '로그인 계정이 변경되었습니다.', code: 'ACTIVITY_ACCOUNT_CHANGED' });
      const result = store.appendEvents(req.user, body?.events, store.sourceFromRequest(req));
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      const invalid = error instanceof SyntaxError || error.message.startsWith('INVALID_');
      if (!invalid) console.error('[user-activity] write_failed', error.code || 'STORE_ERROR');
      return res.status(invalid ? 400 : 503).json({ success: false, error: invalid ? '활동 기록 형식이 올바르지 않습니다.' : '활동 기록 저장을 재시도해 주세요.' });
    }
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
export default withAuth(activityHandler);

