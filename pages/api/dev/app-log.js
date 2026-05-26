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

  const colsResult = await query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AppLog'`
  );
  const cols = new Set((colsResult.recordset || []).map(r => String(r.COLUMN_NAME || '')));
  const pick = (...names) => names.find(n => cols.has(n));
  const dateCol = pick('CreateDtm', 'ActionDtm', 'LogDtm', 'CreatedAt', 'CreateDate', 'RegDtm', 'Dtm');
  const categoryCol = pick('Category', 'LogCategory', 'Type');
  const stepCol = pick('Step', 'Action', 'Title', 'Name');
  const detailCol = pick('Detail', 'Message', 'Descr', 'Description', 'Memo', 'LogText');
  const isErrorCol = pick('IsError', 'Error', 'IsErr');

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  const conditions = [];
  const params = { limit: { type: sql.Int, value: limit } };

  if (req.query.category && categoryCol) {
    conditions.push(`${categoryCol} LIKE @category`);
    params.category = { type: sql.NVarChar, value: `%${req.query.category}%` };
  }
  if (req.query.isError === '1' && isErrorCol) {
    conditions.push(`${isErrorCol} = 1`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = dateCol ? `${dateCol} DESC` : '1';
  const result = await query(
    `SELECT TOP (@limit)
       ${dateCol ? `CONVERT(NVARCHAR(19), ${dateCol}, 120)` : `N''`} AS CreateDtm,
       ${categoryCol || `N''`} AS Category,
       ${stepCol || `N''`} AS Step,
       ${detailCol || `N''`} AS Detail,
       ${isErrorCol || `0`} AS IsError
     FROM AppLog
     ${where}
     ORDER BY ${orderBy}`,
    params
  );

  return res.status(200).json({
    success: true,
    total: result.recordset.length,
    logs: result.recordset,
  });
});
