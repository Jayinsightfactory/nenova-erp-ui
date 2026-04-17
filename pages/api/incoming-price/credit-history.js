// pages/api/incoming-price/credit-history.js
// GET ?farm=X&week=Y  → FarmCredit 전체 이력 (삭제 포함)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { farm, week } = req.query;

    let where = '1=1';
    const params = {};
    if (farm) {
      where += ' AND FarmName=@farm';
      params.farm = { type: sql.NVarChar, value: farm };
    }
    if (week) {
      where += ' AND OrderWeek=@week';
      params.week = { type: sql.NVarChar, value: week };
    }

    const r = await query(
      `SELECT FarmName, OrderWeek, CreditUSD, Memo, isDeleted,
              ISNULL(UpdateDtm, CreatedDtm) AS ChangeDtm
       FROM FarmCredit
       WHERE ${where}
       ORDER BY ISNULL(UpdateDtm, CreatedDtm) DESC`,
      params
    );

    return res.status(200).json({ success: true, history: r.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
