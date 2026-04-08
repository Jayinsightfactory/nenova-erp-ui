// pages/api/dev/action-log.js
// GET  ?limit&offset&actor&riskLevel&actionType&startDate&endDate  → 로그 목록
// GET  ?mode=anomaly  → 이상 징후 감지 결과
// GET  ?mode=summary  → 통계 요약

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

const RISK_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

// ── 이상 감지 규칙
async function detectAnomalies() {
  const alerts = [];

  try {
    // 1. 최근 1시간 CRITICAL 작업
    const r1 = await query(`
      SELECT Actor, ActionType, COUNT(*) AS cnt, MAX(ActionDtm) AS lastAt
      FROM SystemActionLog
      WHERE RiskLevel = 'CRITICAL'
        AND ActionDtm >= DATEADD(hour, -1, GETDATE())
      GROUP BY Actor, ActionType
    `);
    for (const row of r1.recordset) {
      alerts.push({
        level: 'CRITICAL',
        type: 'CRITICAL_ACTION',
        message: `최근 1시간 내 CRITICAL 작업 발생`,
        detail: `${row.Actor} → ${row.ActionType} ${row.cnt}회 (최근: ${row.lastAt})`,
        count: row.cnt,
      });
    }

    // 2. 단시간 대량 호출 (5분 내 동일 Actor 20회 이상)
    const r2 = await query(`
      SELECT Actor, Endpoint, COUNT(*) AS cnt, MIN(ActionDtm) AS firstAt, MAX(ActionDtm) AS lastAt
      FROM SystemActionLog
      WHERE ActionDtm >= DATEADD(minute, -5, GETDATE())
        AND Method != 'GET'
      GROUP BY Actor, Endpoint
      HAVING COUNT(*) >= 20
    `);
    for (const row of r2.recordset) {
      alerts.push({
        level: 'HIGH',
        type: 'BULK_RAPID_CALL',
        message: `5분 내 대량 API 호출 감지`,
        detail: `${row.Actor} → ${row.Endpoint} ${row.cnt}회 (${row.firstAt} ~ ${row.lastAt})`,
        count: row.cnt,
      });
    }

    // 3. 외부 API 전송 누적 (오늘 이카운트 전송 건수)
    const r3 = await query(`
      SELECT Actor, SUM(AffectedCount) AS total, COUNT(*) AS calls,
             SUM(CASE WHEN Result='SUCCESS' THEN 1 ELSE 0 END) AS success,
             SUM(CASE WHEN Result='FAIL' THEN 1 ELSE 0 END) AS fail
      FROM SystemActionLog
      WHERE ActionType IN ('ECOUNT_PUSH','ECOUNT_SYNC')
        AND ActionDtm >= CAST(GETDATE() AS DATE)
      GROUP BY Actor
    `);
    for (const row of r3.recordset) {
      if (row.total > 0 || row.calls > 0) {
        alerts.push({
          level: row.total > 500 ? 'CRITICAL' : 'HIGH',
          type: 'ECOUNT_BULK_PUSH',
          message: `오늘 이카운트 외부 전송 발생`,
          detail: `${row.Actor}: ${row.calls}회 호출, 성공 ${row.success}/실패 ${row.fail}`,
          count: row.calls,
        });
      }
    }

    // 4. 연속 실패 (최근 30분 동일 endpoint 5회 이상 실패)
    const r4 = await query(`
      SELECT Actor, Endpoint, COUNT(*) AS cnt
      FROM SystemActionLog
      WHERE Result IN ('FAIL','ERROR')
        AND ActionDtm >= DATEADD(minute, -30, GETDATE())
      GROUP BY Actor, Endpoint
      HAVING COUNT(*) >= 5
    `);
    for (const row of r4.recordset) {
      alerts.push({
        level: 'MEDIUM',
        type: 'CONSECUTIVE_FAIL',
        message: `30분 내 연속 실패 감지`,
        detail: `${row.Actor} → ${row.Endpoint} ${row.cnt}회 실패`,
        count: row.cnt,
      });
    }

    // 5. claude: 접두사 Actor 작업 (Claude 직접 실행 감지)
    const r5 = await query(`
      SELECT Actor, ActionType, COUNT(*) AS cnt, MAX(ActionDtm) AS lastAt, MAX(RiskLevel) AS maxRisk
      FROM SystemActionLog
      WHERE Actor LIKE 'claude:%'
        AND ActionDtm >= DATEADD(day, -7, GETDATE())
      GROUP BY Actor, ActionType
    `);
    for (const row of r5.recordset) {
      alerts.push({
        level: row.maxRisk,
        type: 'CLAUDE_DIRECT_ACTION',
        message: `Claude 직접 실행 작업 감지`,
        detail: `${row.Actor} → ${row.ActionType} ${row.cnt}회 (최근: ${row.lastAt})`,
        count: row.cnt,
      });
    }

  } catch (e) {
    alerts.push({ level: 'LOW', type: 'ANOMALY_ERROR', message: '이상감지 쿼리 오류: ' + e.message, detail: '', count: 0 });
  }

  // 위험도 순 정렬
  alerts.sort((a, b) => (RISK_ORDER[b.level] || 0) - (RISK_ORDER[a.level] || 0));
  return alerts;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // 테이블 없으면 빈 결과
  try {
    await query(`SELECT TOP 1 LogKey FROM SystemActionLog`);
  } catch {
    return res.status(200).json({ success: true, logs: [], total: 0, anomalies: [], summary: {} });
  }

  const { mode, limit: lp, offset: op, actor, riskLevel, actionType, startDate, endDate, result } = req.query;

  // ── 이상감지 모드
  if (mode === 'anomaly') {
    const anomalies = await detectAnomalies();
    return res.status(200).json({ success: true, anomalies });
  }

  // ── 요약 통계
  if (mode === 'summary') {
    const s = await query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN RiskLevel='CRITICAL' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN RiskLevel='HIGH'     THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN RiskLevel='MEDIUM'   THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN RiskLevel='LOW'      THEN 1 ELSE 0 END) AS low,
        SUM(CASE WHEN Result='SUCCESS'     THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN Result='FAIL'        THEN 1 ELSE 0 END) AS fail,
        SUM(CASE WHEN Result='ERROR'       THEN 1 ELSE 0 END) AS error,
        SUM(CASE WHEN Actor LIKE 'claude:%' THEN 1 ELSE 0 END) AS byClaude,
        MIN(ActionDtm) AS oldest,
        MAX(ActionDtm) AS newest
      FROM SystemActionLog
      WHERE ActionDtm >= DATEADD(day, -30, GETDATE())
    `);
    const byActor = await query(`
      SELECT TOP 10 Actor, COUNT(*) AS cnt, MAX(ActionDtm) AS lastAt
      FROM SystemActionLog
      WHERE ActionDtm >= DATEADD(day, -30, GETDATE())
      GROUP BY Actor ORDER BY cnt DESC
    `);
    const byType = await query(`
      SELECT ActionType, COUNT(*) AS cnt, MAX(RiskLevel) AS maxRisk
      FROM SystemActionLog
      WHERE ActionDtm >= DATEADD(day, -30, GETDATE())
      GROUP BY ActionType ORDER BY cnt DESC
    `);
    return res.status(200).json({
      success: true,
      summary: s.recordset[0] || {},
      byActor: byActor.recordset,
      byType:  byType.recordset,
    });
  }

  // ── 목록 조회
  const limit  = Math.min(parseInt(lp)  || 50, 200);
  const offset = parseInt(op) || 0;

  const conditions = [`ActionDtm >= DATEADD(day, -30, GETDATE())`];
  const params = {};

  if (actor)      { conditions.push(`Actor LIKE @actor`);      params.actor      = { type: sql.NVarChar, value: `%${actor}%` }; }
  if (riskLevel)  { conditions.push(`RiskLevel = @riskLevel`); params.riskLevel  = { type: sql.NVarChar, value: riskLevel }; }
  if (actionType) { conditions.push(`ActionType = @actionType`); params.actionType = { type: sql.NVarChar, value: actionType }; }
  if (result)     { conditions.push(`Result = @result`);       params.result     = { type: sql.NVarChar, value: result }; }
  if (startDate)  { conditions.push(`ActionDtm >= @startDate`); params.startDate  = { type: sql.NVarChar, value: startDate }; }
  if (endDate)    { conditions.push(`ActionDtm < DATEADD(day,1,CAST(@endDate AS DATE))`); params.endDate = { type: sql.NVarChar, value: endDate }; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await query(`SELECT COUNT(*) AS cnt FROM SystemActionLog ${where}`, params);
  const total = countRes.recordset[0]?.cnt || 0;

  params.limit  = { type: sql.Int, value: limit };
  params.offset = { type: sql.Int, value: offset };

  const logsRes = await query(`
    SELECT
      LogKey,
      CONVERT(NVARCHAR(19), ActionDtm, 120) AS ActionDtm,
      Actor, SessionId, ActionType, Method, Endpoint,
      AffectedTable, AffectedCount, Payload,
      Result, ResultDesc, RiskLevel, IpAddress, UserAgent
    FROM SystemActionLog
    ${where}
    ORDER BY ActionDtm DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `, params);

  return res.status(200).json({
    success: true,
    logs:    logsRes.recordset,
    total,
    limit,
    offset,
  });
});
