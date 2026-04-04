// pages/api/ecount/sales-push.js
// POST: 판매 데이터를 이카운트 판매입력(Sale/SaveSale)으로 전송
// Body: { shipmentKeys:[...] } OR { all:true, offset, limit }
// 페이지네이션 방식 — 프론트가 nextOffset 없을 때까지 반복 호출

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
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: '이카운트 설정이 필요합니다.' });
  }

  await ensureSyncLog();

  const { shipmentKeys, all, offset: rawOffset, limit: rawLimit, dateFrom, dateTo, week } = req.body || {};
  const offset = parseInt(rawOffset) || 0;
  const limit  = parseInt(rawLimit)  || 10;  // 한 번에 10건 ShipmentKey

  // 이미 전송된 건 제외 서브쿼리
  const alreadySentSubQuery = `
    SELECT DISTINCT RefKey FROM EcountSyncLog
    WHERE SyncType='판매입력' AND SyncStatus='성공'
  `;

  let keyFilter = '';
  const params  = {};

  if (Array.isArray(shipmentKeys) && shipmentKeys.length > 0) {
    const keyList = shipmentKeys.map(k => parseInt(k)).filter(k => !isNaN(k)).join(',');
    keyFilter = `AND sm.ShipmentKey IN (${keyList})`;
  } else if (all) {
    keyFilter = `AND sm.ShipmentKey NOT IN (${alreadySentSubQuery})`;
  } else {
    if (!dateFrom && !dateTo && !week) {
      return res.status(400).json({ success: false, error: 'shipmentKeys, all, 또는 날짜 조건이 필요합니다.' });
    }
    if (dateFrom) params.dateFrom = { type: sql.Date, value: dateFrom };
    if (dateTo)   params.dateTo   = { type: sql.Date, value: dateTo };
    if (week)     params.week     = { type: sql.NVarChar, value: week };
    keyFilter = `
      AND sm.ShipmentKey NOT IN (${alreadySentSubQuery})
      AND (@dateFrom IS NULL OR CONVERT(DATE, sd.ShipmentDtm) >= @dateFrom)
      AND (@dateTo   IS NULL OR CONVERT(DATE, sd.ShipmentDtm) <= @dateTo)
      AND (@week     IS NULL OR sm.OrderWeek = @week)
    `;
    if (!params.dateFrom) params.dateFrom = { type: sql.Date, value: null };
    if (!params.dateTo)   params.dateTo   = { type: sql.Date, value: null };
    if (!params.week)     params.week     = { type: sql.NVarChar, value: null };
  }

  // 전체 카운트
  const countRes = await query(
    `SELECT COUNT(DISTINCT sm.ShipmentKey) AS cnt
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
     JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
     JOIN Product p         ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
     WHERE sm.isDeleted = 0 AND sm.isFix = 1 ${keyFilter}`,
    params
  );
  const total = countRes.recordset[0]?.cnt || 0;

  if (total === 0) {
    return res.status(200).json({ success: true, pushed: 0, total: 0, nextOffset: null, message: '전송할 데이터 없음' });
  }

  // offset~limit 범위의 ShipmentKey 조회
  const keyRes = await query(
    `SELECT DISTINCT sm.ShipmentKey
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
     JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
     JOIN Product p         ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
     WHERE sm.isDeleted = 0 AND sm.isFix = 1 ${keyFilter}
     ORDER BY sm.ShipmentKey
     OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
    params
  );

  const batchKeys = keyRes.recordset.map(r => r.ShipmentKey);
  if (batchKeys.length === 0) {
    return res.status(200).json({ success: true, pushed: 0, total, nextOffset: null, message: '처리 완료' });
  }

  // 해당 ShipmentKey 상세 조회
  const detailRes = await query(
    `SELECT
      sm.ShipmentKey,
      sm.OrderWeek,
      CONVERT(NVARCHAR(8), sd.ShipmentDtm, 112) AS IO_DATE,
      c.CustKey,
      c.CustName,
      ISNULL(c.OrderCode, c.CustName) AS CUST_CD,
      p.ProdKey,
      p.ProdName,
      ISNULL(p.ProdCode, '') AS PROD_CD,
      sd.OutQuantity AS QTY,
      ISNULL(cpc.Cost, ISNULL(p.Cost, 0)) AS UnitCost
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
    JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
    JOIN Product p         ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
    LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = c.CustKey AND cpc.ProdKey = p.ProdKey
    WHERE sm.ShipmentKey IN (${batchKeys.join(',')})
    ORDER BY sm.ShipmentKey, p.ProdKey`
  );

  // ShipmentKey별 묶기
  const shipmentMap = {};
  for (const row of detailRes.recordset) {
    if (!shipmentMap[row.ShipmentKey]) {
      shipmentMap[row.ShipmentKey] = {
        ShipmentKey: row.ShipmentKey,
        IO_DATE:     row.IO_DATE,
        CUST_CD:     row.CUST_CD,
        details:     [],
      };
    }
    const cost      = Math.round(Number(row.UnitCost) || 0);
    const qty       = Math.round(Number(row.QTY)      || 0);
    const totalAmt  = cost * qty;
    const supplyAmt = Math.round(totalAmt / 1.1);
    const vatAmt    = totalAmt - supplyAmt;

    shipmentMap[row.ShipmentKey].details.push({
      PROD_CD:    row.PROD_CD || row.ProdName,
      PROD_NAME:  row.ProdName,
      QTY:        qty,
      UNIT_PRICE: cost,
      SUPPLY_AMT: supplyAmt,
      VAT_AMT:    vatAmt,
    });
  }

  const shipments = Object.values(shipmentMap);

  // 각 ShipmentKey를 별도 전표로 전송 (Line 번호 = 전표 내 라인)
  let totalSuccess = 0;
  let totalFail    = 0;

  for (const s of shipments) {
    const SaleList = s.details.map((d, li) => ({
      Line:      String(li + 1),
      BulkDatas: {
        IO_DATE:    s.IO_DATE,
        CUST_CD:    s.CUST_CD,
        WH_CD:      '100',
        IO_TYPE:    '11',
        CURRENCY:   'KRW',
        PROD_CD:    d.PROD_CD,
        PROD_NAME:  d.PROD_NAME,
        QTY:        String(d.QTY),
        UNIT_PRICE: String(d.UNIT_PRICE),
        SUPPLY_AMT: String(d.SUPPLY_AMT),
        VAT_AMT:    String(d.VAT_AMT),
      },
    }));

    let ecountRes;
    try {
      ecountRes = await ecountPost('Sale/SaveSale', { SaleList });
    } catch (err) {
      await writeSyncLog('판매입력', s.ShipmentKey, null, '실패', err.message);
      totalFail++;
      continue;
    }

    console.log('[sales-push] ShipmentKey:', s.ShipmentKey, '이카운트 응답:', JSON.stringify(ecountRes?.Data));

    const isOk     = String(ecountRes.Status) === '200' && (ecountRes.Data?.SuccessCnt || 0) > 0;
    const ecountRef = ecountRes.Data?.SlipNos?.[0] || ecountRes.Data?.AR_NO || null;

    await writeSyncLog(
      '판매입력',
      s.ShipmentKey,
      ecountRef,
      isOk ? '성공' : '실패',
      isOk ? null : (
        ecountRes.Errors?.map(e => e.Message).join('; ') ||
        ecountRes.Data?.ResultDetails?.map(r => r.TotalError).join('; ') ||
        JSON.stringify(ecountRes)
      ).slice(0, 500)
    );

    if (isOk) totalSuccess++;
    else      totalFail++;
  }

  const nextOffset = offset + batchKeys.length < total ? offset + batchKeys.length : null;

  return res.status(200).json({
    success:    totalSuccess > 0,
    pushed:     totalSuccess,
    failed:     totalFail,
    total,
    nextOffset,
    processed:  offset + batchKeys.length,
    message:    `판매전송 ${offset + 1}~${offset + batchKeys.length}/${total}: 성공 ${totalSuccess}건 / 실패 ${totalFail}건`,
  });
});
