// pages/api/stats/pivot-data.js
// Pivot 통계 데이터 API

import { withAuth } from '../../../lib/auth';
import { getPivotStats } from '../../../lib/pivotStats';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { weekStart, weekEnd, orderYear } = req.query;

  try {
    const data = await getPivotStats({ weekStart, weekEnd, orderYear });
    return res.status(200).json(data);
  } catch (err) {
    const status = /필요|형식|범위/.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});
