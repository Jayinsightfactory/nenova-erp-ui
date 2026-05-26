// pages/api/m/chat-audit.js - inspect chatbot answer history and risk flags
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { ensureChatAuditTable } from '../../../lib/chat/audit';

async function ensureReadableTable() {
  try {
    await ensureChatAuditTable();
    await query(`SELECT TOP 1 AuditKey FROM _chat_audit`);
    return true;
  } catch {
    return false;
  }
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const exists = await ensureReadableTable();
  if (!exists) {
    return res.status(200).json({
      success: true,
      summary: { total: 0, errorCount: 0, riskCount: 0 },
      rows: [],
      note: 'chat audit table has not been created yet',
    });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const mineOnly = req.query.mine === '1';
  const where = mineOnly ? 'WHERE UserID=@uid' : '';
  const params = {
    limit: { type: sql.Int, value: limit },
    uid: { type: sql.NVarChar, value: req.user?.userId || '' },
  };

  const rows = await query(
    `SELECT TOP (@limit)
            AuditKey, UserID, UserName, UserMessage, BotText,
            RouteFlags, RiskFlags, Success, ErrorMessage, DurationMs, CreateDtm,
            DebugJson
       FROM _chat_audit
       ${where}
      ORDER BY AuditKey DESC`,
    params
  );

  const summary = await query(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN Success=0 THEN 1 ELSE 0 END) AS errorCount,
        SUM(CASE WHEN ISNULL(RiskFlags,'') <> '' THEN 1 ELSE 0 END) AS riskCount,
        SUM(CASE WHEN RouteFlags LIKE '%LLM_SQL%' THEN 1 ELSE 0 END) AS llmSqlCount,
        SUM(CASE WHEN RouteFlags LIKE '%RULE_HANDLER%' THEN 1 ELSE 0 END) AS ruleCount,
        SUM(CASE WHEN RouteFlags LIKE '%ASKBACK%' THEN 1 ELSE 0 END) AS askbackCount,
        AVG(CAST(DurationMs AS FLOAT)) AS avgDurationMs
       FROM _chat_audit
       ${where}`,
    params
  );

  const byRisk = await query(
    `SELECT TOP 20 RiskFlags, COUNT(*) AS cnt
       FROM _chat_audit
       ${where ? `${where} AND` : 'WHERE'} ISNULL(RiskFlags,'') <> ''
      GROUP BY RiskFlags
      ORDER BY COUNT(*) DESC`,
    params
  );

  return res.status(200).json({
    success: true,
    summary: summary.recordset[0] || {},
    byRisk: byRisk.recordset || [],
    rows: rows.recordset || [],
  });
}

export default withAuth(handler);
