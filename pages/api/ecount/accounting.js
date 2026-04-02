// pages/api/ecount/accounting.js
// POST: 세금계산서 → 이카운트 자동분개(SaveAccountingSlipAuto)
// Body: { taxInvKeys: [1,2,3] } OR { month }

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
    return res.status(503).json({
      success: false,
      error:   '이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요.',
    });
  }

  await ensureSyncLog();

  const { taxInvKeys, month } = req.body || {};

  let whereClause = 'WHERE 1=1';
  const params    = {};

  if (Array.isArray(taxInvKeys) && taxInvKeys.length > 0) {
    const keyList = taxInvKeys.map(k => parseInt(k)).filter(k => !isNaN(k)).join(',');
    whereClause  += ` AND ti.TaxInvKey IN (${keyList})`;
  } else if (month) {
    params.month = { type: sql.NVarChar, value: month };
    whereClause += ` AND CONVERT(NVARCHAR(7), ti.InvDtm, 120) = @month`;
  } else {
    return res.status(400).json({ success: false, error: 'taxInvKeys 또는 month 조건이 필요합니다.' });
  }

  const result = await query(
    `SELECT
      ti.TaxInvKey,
      CONVERT(NVARCHAR(8), ti.InvDtm, 112) AS SLIP_DATE,
      ti.CustName    AS CUST_CD,
      ti.SupplyAmt   AS SUPPLY_AMT,
      ti.VatAmt      AS VAT_AMT,
      ti.TaxType,
      ISNULL(ti.ElecTaxNo, '') AS AR_NO
    FROM TaxInvoice ti
    ${whereClause}
    ORDER BY ti.InvDtm`,
    params
  );

  const invoices = result.recordset;
  if (invoices.length === 0) {
    return res.status(200).json({ success: true, pushed: 0, message: '전송할 세금계산서가 없습니다.' });
  }

  // SLIP_TYPE: 11 = 외상매출금 (세금계산서), 13 = 미수금 (계산서)
  const SlipList = invoices.map(inv => ({
    SLIP_DATE:  inv.SLIP_DATE,
    CUST_CD:    inv.CUST_CD,
    SUPPLY_AMT: Number(inv.SUPPLY_AMT) || 0,
    VAT_AMT:    Number(inv.VAT_AMT)    || 0,
    SLIP_TYPE:  inv.TaxType === '세금계산서' ? '11' : '13',
    AR_NO:      inv.AR_NO || '',
  }));

  let ecountResponse;
  try {
    ecountResponse = await ecountPost('Accounting/SaveAccountingSlipAuto', { SlipList });
  } catch (err) {
    for (const inv of invoices) {
      await writeSyncLog('자동분개', inv.TaxInvKey, null, '실패', err.message);
    }
    return res.status(500).json({ success: false, error: `이카운트 API 오류: ${err.message}` });
  }

  const isSuccess = ecountResponse.Status === 200;
  const ecountRef = ecountResponse.Data?.SLIP_NO || null;

  for (const inv of invoices) {
    await writeSyncLog(
      '자동분개',
      inv.TaxInvKey,
      ecountRef,
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
    pushed:        invoices.length,
    message:       `이카운트 자동분개 완료: ${invoices.length}건`,
    ecountResponse,
  });
});
