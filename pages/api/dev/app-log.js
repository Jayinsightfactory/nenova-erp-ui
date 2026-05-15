// pages/api/dev/app-log.js
// GET ?limit&category&isError=1 — AppLog 최근 기록 조회

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    await query(`SELECT TOP 1 * FROM AppLog`);
  } catch {
    return res.status(200).json({ success: true, logs: [], total: 0 });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  const conditions = [];
  const params = { limit: { type: sql.Int, value: limit } };

  if (req.query.category) {
    conditions.push(`Category LIKE @category`);
    params.category = { type: sql.NVarChar, value: `%${req.query.category}%` };
  }
  if (req.query.isError === '1') {
    conditions.push(`IsError = 1`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT TOP (@limit)
       CONVERT(NVARCHAR(19), CreateDtm, 120) AS CreateDtm,
       Category, Step, Detail, IsError
     FROM AppLog
     ${where}
     ORDER BY CreateDtm DESC`,
    params
  );

  return res.status(200).json({
    success: true,
    total: result.recordset.length,
    logs: result.recordset,
  });
});
