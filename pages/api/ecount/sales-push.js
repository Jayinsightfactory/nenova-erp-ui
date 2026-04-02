// pages/api/ecount/sales-push.js
// POST: 판매 데이터를 이카운트 판매입력(SaveSales)으로 전송
// Body: { shipmentKeys: [1,2,3] } OR { dateFrom, dateTo, week }

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { ecountPost, isConfigured } from '../../../lib/ecount';

// EcountSyncLog 테이블 생성 (없으면)
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

// 동기화 로그 기록
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
    // 로그 실패는 무시
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

  const { shipmentKeys, dateFrom, dateTo, week } = req.body || {};

  // 조회 조건 구성
  let keyFilter      = '';
  const params       = {};

  if (Array.isArray(shipmentKeys) && shipmentKeys.length > 0) {
    // 특정 출고 키 목록
    const keyList = shipmentKeys.map(k => parseInt(k)).filter(k => !isNaN(k)).join(',');
    keyFilter = `AND sm.ShipmentKey IN (${keyList})`;
  } else {
    // 날짜/차수 조건
    if (!dateFrom && !dateTo && !week) {
      return res.status(400).json({ success: false, error: 'shipmentKeys 또는 dateFrom/dateTo 조건이 필요합니다.' });
    }
    if (dateFrom) params.dateFrom = { type: sql.Date, value: dateFrom };
    if (dateTo)   params.dateTo   = { type: sql.Date, value: dateTo };
    if (week)     params.week     = { type: sql.NVarChar, value: week };
    keyFilter = `
      AND (@dateFrom IS NULL OR CONVERT(DATE, sd.ShipmentDtm) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(DATE, sd.ShipmentDtm) <= @dateTo)
      AND (@week     IS NULL OR sm.OrderWeek = @week)
    `;
    if (!params.dateFrom) params.dateFrom = { type: sql.Date, value: null };
    if (!params.dateTo)   params.dateTo   = { type: sql.Date, value: null };
    if (!params.week)     params.week     = { type: sql.NVarChar, value: null };
  }

  // DB 조회
  const result = await query(
    `SELECT
      sm.ShipmentKey,
      sm.OrderWeek,
      CONVERT(NVARCHAR(8), MAX(sd.ShipmentDtm), 112) AS IO_DATE,
      c.CustKey,
      c.CustName,
      ISNULL(c.OrderCode, '') AS CUST_CD,
      p.ProdKey,
      p.ProdName,
      ISNULL(p.ProdCode, p.ProdName) AS PROD_CD,
      sd.OutQuantity AS QTY,
      ISNULL(cpc.Cost, ISNULL(p.Cost, 0)) AS UnitCost
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
    JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
    JOIN Product p         ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
    LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = c.CustKey AND cpc.ProdKey = p.ProdKey
    WHERE sm.isDeleted = 0 AND sm.isFix = 1
      ${keyFilter}
    GROUP BY
      sm.ShipmentKey, sm.OrderWeek,
      c.CustKey, c.CustName, c.OrderCode,
      p.ProdKey, p.ProdName, p.ProdCode,
      sd.OutQuantity, cpc.Cost, p.Cost
    ORDER BY sm.ShipmentKey`,
    params
  );

  const rows = result.recordset;
  if (rows.length === 0) {
    return res.status(200).json({ success: true, pushed: 0, message: '전송할 데이터가 없습니다.' });
  }

  // ShipmentKey 별로 묶기
  const shipmentMap = {};
  for (const row of rows) {
    if (!shipmentMap[row.ShipmentKey]) {
      shipmentMap[row.ShipmentKey] = {
        ShipmentKey: row.ShipmentKey,
        IO_DATE:     row.IO_DATE,
        CUST_CD:     row.CUST_CD || row.CustName,
        details:     [],
      };
    }
    const cost       = Number(row.UnitCost) || 0;
    const qty        = Number(row.QTY)      || 0;
    const totalCost  = cost * qty;
    const supplyAmt  = Math.round(totalCost / 1.1);
    const vatAmt     = Math.round(totalCost / 11);

    shipmentMap[row.ShipmentKey].details.push({
      PROD_CD:    row.PROD_CD,
      QTY:        qty,
      SUPPLY_AMT: supplyAmt,
      VAT_AMT:    vatAmt,
      REMARKS:    row.ProdName,
    });
  }

  const shipments = Object.values(shipmentMap);

  // 이카운트 판매입력 요청 구성
  const SaleList = shipments.map(s => ({
    IO_DATE:  s.IO_DATE,
    CUST_CD:  s.CUST_CD,
    WH_CD:    '100',
    IO_TYPE:  '1',
    CURRENCY: 'KRW',
    AR_NO:    '자동',
    BulkDatas: s.details.map(d => ({
      PROD_CD:    d.PROD_CD,
      QTY:        d.QTY,
      SUPPLY_AMT: d.SUPPLY_AMT,
      VAT_AMT:    d.VAT_AMT,
      REMARKS:    d.REMARKS,
    })),
  }));

  // 이카운트 API 호출
  let ecountResponse;
  try {
    ecountResponse = await ecountPost('Sale/SaveSales', { DOMAIN: 'EC', SaleList });
  } catch (err) {
    // 전체 실패 로그
    for (const s of shipments) {
      await writeSyncLog('판매입력', s.ShipmentKey, null, '실패', err.message);
    }
    return res.status(500).json({ success: false, error: `이카운트 API 오류: ${err.message}` });
  }

  // 응답 처리
  const isSuccess = ecountResponse.Status === 200;
  const ecountRef = ecountResponse.Data?.AR_NO || ecountResponse.Data?.IO_NO || null;

  for (const s of shipments) {
    await writeSyncLog(
      '판매입력',
      s.ShipmentKey,
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
    pushed:        shipments.length,
    message:       `이카운트 판매입력 완료: ${shipments.length}건`,
    ecountResponse,
  });
});
