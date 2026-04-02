// pages/api/ecount/purchase-push.js
// POST: 구매(수입) 데이터를 이카운트 구매입력(SavePurchases)으로 전송
// Body: { importKeys: [1,2,3] } OR { dateFrom, dateTo }

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { ecountPost, isConfigured } from '../../../lib/ecount';

// EcountSyncLog 생성 보장
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
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      success: false,
      error:   '이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요. (ECOUNT_COM_CODE, ECOUNT_USER_ID)',
    });
  }

  await ensureSyncLog();

  const { importKeys, dateFrom, dateTo } = req.body || {};

  // 조회 조건
  let keyFilter = '';
  const params  = {};

  if (Array.isArray(importKeys) && importKeys.length > 0) {
    const keyList = importKeys.map(k => parseInt(k)).filter(k => !isNaN(k)).join(',');
    keyFilter = `AND io.ImportKey IN (${keyList})`;
  } else {
    if (!dateFrom && !dateTo) {
      return res.status(400).json({ success: false, error: 'importKeys 또는 dateFrom/dateTo 조건이 필요합니다.' });
    }
    if (dateFrom) params.dateFrom = { type: sql.Date, value: dateFrom };
    if (dateTo)   params.dateTo   = { type: sql.Date, value: dateTo };
    keyFilter = `
      AND (@dateFrom IS NULL OR CONVERT(DATE, io.ImportDtm) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(DATE, io.ImportDtm) <= @dateTo)
    `;
    if (!params.dateFrom) params.dateFrom = { type: sql.Date, value: null };
    if (!params.dateTo)   params.dateTo   = { type: sql.Date, value: null };
  }

  // DB 조회 (ImportOrder 헤더 + ImportOrderDetail)
  const result = await query(
    `SELECT
      io.ImportKey,
      CONVERT(NVARCHAR(8), io.ImportDtm, 112) AS IO_DATE,
      io.SupplierName,
      io.CurrencyCode,
      io.InvoiceNo,
      io.ExchangeRate,
      iod.DetailKey,
      iod.ProdName,
      ISNULL(iod.BoxQty, 0)    AS BoxQty,
      ISNULL(iod.UnitPrice, 0) AS UnitPrice,
      ISNULL(iod.TotalPrice, 0) AS TotalPrice
    FROM ImportOrder io
    LEFT JOIN ImportOrderDetail iod ON io.ImportKey = iod.ImportKey
    WHERE io.isDeleted = 0
      ${keyFilter}
    ORDER BY io.ImportKey, iod.DetailKey`,
    params
  );

  const rows = result.recordset;
  if (rows.length === 0) {
    return res.status(200).json({ success: true, pushed: 0, message: '전송할 데이터가 없습니다.' });
  }

  // ImportKey 별로 묶기
  const orderMap = {};
  for (const row of rows) {
    if (!orderMap[row.ImportKey]) {
      orderMap[row.ImportKey] = {
        ImportKey:    row.ImportKey,
        IO_DATE:      row.IO_DATE,
        SupplierName: row.SupplierName,
        CurrencyCode: row.CurrencyCode || 'USD',
        InvoiceNo:    row.InvoiceNo,
        details:      [],
      };
    }
    if (row.DetailKey) {
      orderMap[row.ImportKey].details.push({
        ProdName:   row.ProdName,
        BoxQty:     Number(row.BoxQty)    || 0,
        UnitPrice:  Number(row.UnitPrice) || 0,
        TotalPrice: Number(row.TotalPrice)|| 0,
      });
    }
  }

  const orders = Object.values(orderMap);

  // 이카운트 구매입력 요청 구성
  const PurchaseList = orders.map(o => ({
    IO_DATE:    o.IO_DATE,
    CUST_CD:    o.SupplierName || 'UNKNOWN',
    WH_CD:      '100',
    CURRENCY:   o.CurrencyCode,
    INVOICE_NO: o.InvoiceNo || '',
    BulkDatas:  o.details.map(d => ({
      PROD_CD:    d.ProdName, // 품목코드 없으면 이름을 코드로 사용
      QTY:        d.BoxQty,
      SUPPLY_AMT: Math.round(d.TotalPrice),
      REMARKS:    d.ProdName,
    })),
  }));

  // 이카운트 API 호출
  let ecountResponse;
  try {
    ecountResponse = await ecountPost('Purchases/SavePurchases', { DOMAIN: 'EC', PurchaseList });
  } catch (err) {
    for (const o of orders) {
      await writeSyncLog('구매입력', o.ImportKey, null, '실패', err.message);
    }
    return res.status(500).json({ success: false, error: `이카운트 API 오류: ${err.message}` });
  }

  const isSuccess = ecountResponse.Status === 200;
  const ecountRef = ecountResponse.Data?.IO_NO || null;

  for (const o of orders) {
    await writeSyncLog(
      '구매입력',
      o.ImportKey,
      ecountRef,
      isSuccess ? '성공' : '실패',
      isSuccess ? null : (ecountResponse.Error?.Message || ecountResponse.Message || JSON.stringify(ecountResponse))
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
    pushed:        orders.length,
    message:       `이카운트 구매입력 완료: ${orders.length}건`,
    ecountResponse,
  });
});
