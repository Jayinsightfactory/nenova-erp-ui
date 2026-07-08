// GET /api/shipment/distribute-import-apply-progress?jobId=... — 적용 실시간 진행상황 (읽기 전용)
import { withAuth } from '../../../lib/auth';
import { getApplyProgress } from '../../../lib/importApplyProgress';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const jobId = String(req.query.jobId || '').slice(0, 80);
  if (!jobId) return res.status(400).json({ success: false, error: 'jobId 필요' });
  return res.status(200).json({ success: true, progress: getApplyProgress(jobId) });
});
