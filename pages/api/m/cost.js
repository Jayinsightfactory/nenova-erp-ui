// pages/api/m/cost.js — Claude API 비용 모니터링
import { withAuth } from '../../../lib/auth';
import { getCostStats } from '../../../lib/chat/costTracker';

async function handler(req, res) {
  const stats = getCostStats();
  return res.status(200).json({ success: true, ...stats });
}

export default withAuth(handler);
