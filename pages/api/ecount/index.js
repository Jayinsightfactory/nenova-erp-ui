// GET /api/ecount — 스냅샷 목록(?dataset=) 또는 상세(?snapshot=)
import { withAuth } from '../../../lib/auth';
import { listEcountSnapshots, getEcountSnapshot, DATASETS } from '../../../lib/ecountIngest';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    if (req.query.snapshot) {
      const snap = await getEcountSnapshot(req.query.snapshot);
      if (!snap) return res.status(404).json({ success: false, error: '스냅샷 없음' });
      return res.status(200).json({ success: true, snapshot: snap });
    }
    const dataset = req.query.dataset || null;
    const snapshots = await listEcountSnapshots(dataset, Number(req.query.limit) || 30);
    return res.status(200).json({ success: true, datasets: DATASETS, snapshots });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
