// 단가 변경이력(스냅샷 비교). 기존 단가 저장 API 는 수정하지 않는다. web_mgmt 만 쓴다.
// GET  ?prodKey=&custKey=&q=   이력 + 마지막 스냅샷 시각
// POST {action:'snapshot'}     수동 스냅샷(자동 스케줄 없음)
import { withAuth } from '../../../lib/auth.js';
import { takeSnapshot, lastSnapshotAt, listPriceHistory } from '../../../lib/mgmt/priceSnapshot.js';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [rows, last] = await Promise.all([
        listPriceHistory({ prodKey: req.query.prodKey, custKey: req.query.custKey, q: req.query.q, limit: req.query.limit }),
        lastSnapshotAt(),
      ]);
      return res.status(200).json({ success: true, rows, last });
    }
    if (req.method === 'POST') {
      if ((req.body || {}).action !== 'snapshot') return res.status(400).json({ success: false, error: "action 은 'snapshot'" });
      const out = await takeSnapshot({ actorId: req.user?.userId || '' });
      return res.status(200).json({ success: true, ...out });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
