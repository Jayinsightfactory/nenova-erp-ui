// pages/api/m/usage.js — API 사용량 통계 조회
import { withAuth } from '../../../lib/auth';
import { getTopEndpoints, getUserTopEndpoints, getHourlyDistribution, getStats } from '../../../lib/apiLogger';

async function handler(req, res) {
  const stats = getStats();
  const globalTop = getTopEndpoints(20);
  const userTop = getUserTopEndpoints(req.user?.userId, 10);
  const hourly = getHourlyDistribution();

  return res.status(200).json({
    success: true,
    stats,
    globalTop,
    userTop,
    hourly,
  });
}

export default withAuth(handler);
