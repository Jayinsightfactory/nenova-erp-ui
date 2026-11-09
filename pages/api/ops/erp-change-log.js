// pages/api/ops/erp-change-log.js — Orbit 업무 기록(nenova.exe 저장 동작)과 실제 전산 변경을 시각·사용자로 대조하기 위한 읽기 전용 변경 로그.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { validateChangeLogRequest, erpChangeLogSql, ERP_CHANGE_LOG_MAX_ROWS } from '../../../lib/erpChangeLog';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 지원합니다.' }); }
  let scope;
  try { scope = validateChangeLogRequest(req.query); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  try {
    const result = await query(erpChangeLogSql, {
      since: { type: sql.NVarChar, value: scope.sinceText },
      until: { type: sql.NVarChar, value: scope.untilText },
      take: { type: sql.Int, value: ERP_CHANGE_LOG_MAX_ROWS + 1 },
    });
    const records = result.recordset || [];
    const rows = records.slice(0, ERP_CHANGE_LOG_MAX_ROWS).map(({ sortDtm, ...row }) => row);
    return res.status(200).json({ success: true, rows, truncated: records.length > ERP_CHANGE_LOG_MAX_ROWS });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
