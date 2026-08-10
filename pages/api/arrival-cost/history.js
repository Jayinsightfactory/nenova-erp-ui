// GET — 도착원가 한 행의 매칭·배분기준 변경 이력

import { withAuth } from '../../../lib/auth.js';
import { listArrivalCostHistory } from '../../../lib/arrivalCost.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const rows = await listArrivalCostHistory(req.query.arrivalLineKey);
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, error: error.message, code: error.code });
  }
});

