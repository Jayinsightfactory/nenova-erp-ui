// pages/api/ecount/customers-sync.js
// GET:  이카운트 거래처 목록 조회
// POST: 거래처 이카운트에 등록/업데이트
// Body: { custKeys: [1,2,3] } OR { all: true }

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { ecountPost, isConfigured } from '../../../lib/ecount';

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

async function writeSyncLog(syncType, refKey, ecountRef, status, errorMsg) {
  try {
    await query(
      `INSERT INTO EcountSyncLog (SyncType, RefKey, EcountRef, SyncStatus, ErrorMsg)
       VALUES (@syncType, @refKey, @ecountRef, @status, @errorMsg)`,
      {
        syncType:  { type: sql.NVarChar, value: syncType  || '' },
        refKey:    { type: sql.Int,      value: refKey    || null },
        ecountRef: { type: sql.NVarChar, value: (ecountRef || '').toString().slice(0, 100) },
        status:    { type: sql.NVarChar, value: status    || '' },
        errorMsg:  { type: sql.NVarChar, value: (errorMsg || '').toString().slice(0, 500) },
      }
    );
  } catch (e) {
    console.error('EcountSyncLog write error:', e.message);
  }
}

export default withAuth(async function handler(req, res) {
  if (!isConfigured()) {
    return res.status(503).json({
      success: false,
      error:   '이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요.',
    });
  }

  // ── GET: 이카운트 거래처 목록 조회 ─────────────────────────
  if (req.method === 'GET') {
    try {
      // AccountBasic/GetBasicCustList - 기본 거래처 목록 조회
      const ecountRes = await ecountPost('AccountBasic/GetBasicCustList', {
        Conditions: { USE_YN: 'Y' },
      });

      if (String(ecountRes.Status) !== '200') {
        const msg = ecountRes.Error?.Message || ecountRes.Message || '조회 실패';
        return res.status(400).json({ success: false, error: msg, ecountResponse: ecountRes });
      }

      const customers = ecountRes.Data?.Result || ecountRes.Data || [];
      return res.status(200).json({
        success:   true,
        customers,
        total:     Array.isArray(customers) ? customers.length : 0,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── POST: 이카운트에 거래처 등록/업데이트 ─────────────────
  if (req.method === 'POST') {
    await ensureSyncLog();

    const { custKeys, all } = req.body || {};

    let whereClause = 'WHERE c.isDeleted = 0';
    const params    = {};

    if (all) {
      // 전체 활성 거래처
    } else if (Array.isArray(custKeys) && custKeys.length > 0) {
      const keyList = custKeys.map(k => parseInt(k)).filter(k => !isNaN(k)).join(',');
      whereClause  += ` AND c.CustKey IN (${keyList})`;
    } else {
      return res.status(400).json({ success: false, error: 'custKeys 또는 all: true 가 필요합니다.' });
    }

    const result = await query(
      `SELECT c.CustKey, c.CustName, c.CustArea,
              ISNULL(c.OrderCode, '') AS OrderCode
       FROM Customer c
       ${whereClause}
       ORDER BY c.CustKey`,
      params
    );

    const customers = result.recordset;
    if (customers.length === 0) {
      return res.status(200).json({ success: true, synced: 0, message: '동기화할 거래처가 없습니다.' });
    }

    // 이카운트 거래처 등록/수정 (AccountBasic/SaveBasicCust)
    // - CUST_CD: 거래처 코드 (OrderCode)  ← BUSINESS_NO(사업자번호)가 아님
    // - CUST_TYPE: S(매출), P(매입), B(매출매입)
    // - 구조: CustList[{ Line:"0", BulkDatas: { CUST_CD, CUST_NAME, CUST_TYPE } }]
    // Rate limit 방지: 10건씩 나눠서 처리, 각 배치 사이 300ms 대기
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const BATCH = 10;
    let totalSuccess = 0;
    let totalFail    = 0;
    let lastResponse = null;

    for (let i = 0; i < customers.length; i += BATCH) {
      const batch    = customers.slice(i, i + BATCH);
      const CustList = batch.map((c, idx) => ({
        Line:      String(idx),
        BulkDatas: {
          CUST_CD:   c.OrderCode || `NV${String(c.CustKey).padStart(5, '0')}`,
          CUST_NAME: c.CustName,
          CUST_TYPE: 'S',   // 매출 거래처
          CUST_DES:  c.CustArea || '',
        },
      }));

      let ecountResponse;
      try {
        ecountResponse = await ecountPost('AccountBasic/SaveBasicCust', { CustList });
        lastResponse   = ecountResponse;
      } catch (err) {
        for (const c of batch) {
          await writeSyncLog('거래처', c.CustKey, null, '실패', err.message);
        }
        totalFail += batch.length;
        if (i + BATCH < customers.length) await sleep(300);
        continue;
      }

      const isOk = String(ecountResponse.Status) === '200' &&
                   !(ecountResponse.Errors || []).length;
      const sc   = Number(ecountResponse.Data?.SuccessCnt) || 0;
      const fc   = Number(ecountResponse.Data?.FailCnt)    || 0;
      totalSuccess += isOk ? (sc || batch.length) : 0;
      totalFail    += isOk ? fc : batch.length;

      for (const c of batch) {
        await writeSyncLog(
          '거래처',
          c.CustKey,
          c.OrderCode || null,
          isOk ? '성공' : '실패',
          isOk ? null : (ecountResponse.Error?.Message || JSON.stringify(ecountResponse)).slice(0, 500)
        );
      }

      if (i + BATCH < customers.length) await sleep(300);
    }

    const isSuccess = totalSuccess > 0;
    // 하위 호환용 (기존 응답 처리 코드를 위해 마지막 응답 유지)
    const ecountResponse = lastResponse;
    for (const c of []) { // 이미 위에서 writeSyncLog 완료 — 이 루프는 스킵
      await writeSyncLog(
        '거래처',
        c.CustKey,
        c.OrderCode || null,
        isSuccess ? '성공' : '실패',
        isSuccess ? null : (ecountResponse?.Error?.Message || JSON.stringify(ecountResponse))
      );
    }

    return res.status(200).json({
      success:      totalSuccess > 0 || totalFail === 0,
      synced:       totalSuccess,
      failed:       totalFail,
      total:        customers.length,
      message:      `거래처 동기화: 성공 ${totalSuccess}건 / 실패 ${totalFail}건`,
      ecountResponse: lastResponse,
    });
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
});
