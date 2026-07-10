// 그외통관비/포워딩 입력값 수정 이력 조회 — 필드별 이전값→새값+수정자+시각 (읽기전용, INSERT-only 로그).
import { withAuth } from '../../../lib/auth';
import { loadHistory } from '../../../lib/customsForwarding';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const { year, scopeType, scopeKey } = req.query;
    if (!year || !scopeType || !scopeKey) return res.status(400).json({ success: false, error: 'year, scopeType, scopeKey 필요' });
    const rows = await loadHistory(year, scopeType, scopeKey);
    return res.status(200).json({ success: true, rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
