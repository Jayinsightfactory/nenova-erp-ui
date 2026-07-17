// pages/api/raum/consigned-item.js — 수동 사입 지정/해제
// POST { name, consigned: true|false } — WebRaumConsignedItem (DB, 배포에도 유지)
// 지정된 품목은 업로드 시 원산지와 무관하게 사입(매출 포함·손익 제외)으로 분류된다.
import { withAuth } from '../../../lib/auth';
import { saveRaumConsigned } from '../../../lib/raumPnl';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const { name, consigned } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'name 필요' });
    const actor = req.user?.userName || req.user?.userId || 'user';
    const result = await saveRaumConsigned(name, !!consigned, actor);
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
