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
      const ecountRes = await ecountPost('BasInfo/GetCustomerList', {
        Conditions: {},
      });

      if (ecountRes.Status !== 200) {
        const msg = ecountRes.Error?.Message || ecountRes.Message || '조회 실패';
        return res.status(400).json({ success: false, error: msg, ecountResponse: ecountRes });
      }

      return res.status(200).json({
        success:   true,
        customers: ecountRes.Data || [],
        total:     (ecountRes.Data || []).length,
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

    // 이카운트 거래처 등록
    const CustomerList = customers.map(c => ({
      CUST_CD:   c.OrderCode || c.CustName.slice(0, 20),
      CUST_NM:   c.CustName,
      CUST_TYPE: '01',
      REGION:    c.CustArea || '',
    }));

    let ecountResponse;
    try {
      ecountResponse = await ecountPost('BasInfo/SaveCustomer', {
        CustomerList,
      });
    } catch (err) {
      for (const c of customers) {
        await writeSyncLog('거래처', c.CustKey, null, '실패', err.message);
      }
      return res.status(500).json({ success: false, error: `이카운트 API 오류: ${err.message}` });
    }

    const isSuccess = ecountResponse.Status === 200;

    for (const c of customers) {
      await writeSyncLog(
        '거래처',
        c.CustKey,
        c.OrderCode || null,
        isSuccess ? '성공' : '실패',
        isSuccess ? null : (ecountResponse.Error?.Message || JSON.stringify(ecountResponse))
      );
    }

    if (!isSuccess) {
      const errMsg = ecountResponse.Error?.Message || ecountResponse.Message || '알 수 없는 오류';
      return res.status(400).json({
        success:       false,
        error:         `이카운트 전송 오류: ${errMsg}`,
        ecountResponse,
      });
    }

    return res.status(200).json({
      success:       true,
      synced:        customers.length,
      message:       `이카운트 거래처 동기화 완료: ${customers.length}건`,
      ecountResponse,
    });
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
});
