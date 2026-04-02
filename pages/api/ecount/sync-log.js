// pages/api/ecount/sync-log.js
// GET: EcountSyncLog 이력 + 미전송 건수 조회
// withAuth 인증 필수

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

// EcountSyncLog 테이블 생성 보장
async function ensureSyncLog() {
  await query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='EcountSyncLog' AND xtype='U')
    CREATE TABLE EcountSyncLog (
      LogKey     INT IDENTITY PRIMARY KEY,
      SyncType   NVARCHAR(50),
      RefKey     INT,
      EcountRef  NVARCHAR(100),
      SyncDtm    DATETIME DEFAULT GETDATE(),
      SyncStatus NVARCHAR(20),
      ErrorMsg   NVARCHAR(500)
    )
  `);
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    await ensureSyncLog();

    const { limit: limitParam = '50' } = req.query;
    const limit = Math.min(parseInt(limitParam) || 50, 200);

    // 최근 동기화 이력
    const logResult = await query(
      `SELECT TOP (@limit)
        LogKey, SyncType, RefKey, EcountRef,
        CONVERT(NVARCHAR(19), SyncDtm, 120) AS SyncDtm,
        SyncStatus, ErrorMsg
      FROM EcountSyncLog
      ORDER BY SyncDtm DESC`,
      { limit: { type: sql.Int, value: limit } }
    );

    // 판매 미전송 건수: isFix=1 이고 EcountSyncLog에 없는 ShipmentKey
    let pendingSales = 0;
    try {
      const pendingSalesResult = await query(
        `SELECT COUNT(DISTINCT sm.ShipmentKey) AS cnt
         FROM ShipmentMaster sm
         WHERE sm.isDeleted = 0 AND sm.isFix = 1
           AND NOT EXISTS (
             SELECT 1 FROM EcountSyncLog el
             WHERE el.SyncType = '판매입력'
               AND el.RefKey = sm.ShipmentKey
               AND el.SyncStatus = '성공'
           )`
      );
      pendingSales = pendingSalesResult.recordset[0]?.cnt || 0;
    } catch (_) { /* ImportOrder 테이블이 없을 수도 있음 */ }

    // 구매 미전송 건수
    let pendingPurchases = 0;
    try {
      const pendingPurchaseResult = await query(
        `SELECT COUNT(*) AS cnt
         FROM ImportOrder io
         WHERE io.isDeleted = 0
           AND NOT EXISTS (
             SELECT 1 FROM EcountSyncLog el
             WHERE el.SyncType = '구매입력'
               AND el.RefKey = io.ImportKey
               AND el.SyncStatus = '성공'
           )`
      );
      pendingPurchases = pendingPurchaseResult.recordset[0]?.cnt || 0;
    } catch (_) { /* 무시 */ }

    // 동기화 요약 통계
    let summaryData = { success: 0, fail: 0 };
    try {
      const summaryResult = await query(
        `SELECT SyncStatus, COUNT(*) AS cnt
         FROM EcountSyncLog
         WHERE SyncDtm >= DATEADD(day, -30, GETDATE())
         GROUP BY SyncStatus`
      );
      for (const row of summaryResult.recordset) {
        if (row.SyncStatus === '성공') summaryData.success = row.cnt;
        if (row.SyncStatus === '실패') summaryData.fail    = row.cnt;
      }
    } catch (_) { /* 무시 */ }

    return res.status(200).json({
      success:          true,
      logs:             logResult.recordset,
      pendingSales,
      pendingPurchases,
      summary:          summaryData,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
