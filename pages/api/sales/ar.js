// pages/api/sales/ar.js — 채권관리 API
// GET type=list  → 거래처별 미수금 현황
// GET type=ledger → 거래처 원장 (출고+입금 타임라인)
// POST           → 입금 등록

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';

// ReceivableLedger 테이블 자동 생성
const CREATE_TABLE_SQL = `
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ReceivableLedger' AND xtype='U')
CREATE TABLE ReceivableLedger (
  LedgerKey    INT IDENTITY PRIMARY KEY,
  CustKey      INT NOT NULL,
  LedgerDtm    NVARCHAR(20) NOT NULL,
  LedgerType   NVARCHAR(20) NOT NULL,
  Amount       DECIMAL(18,2) NOT NULL,
  ShipmentKey  INT,
  Memo         NVARCHAR(200),
  BankAccount  NVARCHAR(50),
  CreateDtm    DATETIME DEFAULT GETDATE(),
  isDeleted    BIT DEFAULT 0
)
`;

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await query(CREATE_TABLE_SQL);
  tableReady = true;
}

export default withAuth(withActionLog(async function handler(req, res) {
  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ success: false, error: '테이블 초기화 실패: ' + err.message });
  }

  if (req.method === 'GET') {
    const { type } = req.query;
    if (type === 'list')   return await getList(req, res);
    if (type === 'ledger') return await getLedger(req, res);
    return res.status(400).json({ success: false, error: 'type 파라미터 필요 (list|ledger)' });
  }
  if (req.method === 'POST') return await postPayment(req, res);
  return res.status(405).end();
}, { actionType: 'AR_WRITE', affectedTable: 'ReceivableLedger', riskLevel: 'HIGH' }));

// ── 거래처별 채권 목록 ─────────────────────────────
async function getList(req, res) {
  const { dateFrom, dateTo, custKey } = req.query;

  const params = {
    dateFrom: { type: sql.NVarChar, value: dateFrom || null },
    dateTo:   { type: sql.NVarChar, value: dateTo   || null },
  };
  let custWhere = '';
  if (custKey) {
    custWhere = ' AND c.CustKey = @custKey';
    params.custKey = { type: sql.Int, value: parseInt(custKey) };
  }

  try {
    // 거래처별 출고 매출 집계
    const salesResult = await query(
      `SELECT
        c.CustKey, c.CustName, c.CustArea, c.Manager,
        COUNT(DISTINCT sm.ShipmentKey) AS shipCount,
        SUM(ROUND(ISNULL(p.Cost, 0) * sd.OutQuantity / 1.1, 0)) AS totalSales,
        MAX(CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS lastShipDtm
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
      JOIN Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
      WHERE sm.isDeleted = 0 AND sm.isFix = 1
        AND (@dateFrom IS NULL OR CONVERT(DATE, sd.ShipmentDtm) >= CONVERT(DATE, @dateFrom))
        AND (@dateTo   IS NULL OR CONVERT(DATE, sd.ShipmentDtm) <= CONVERT(DATE, @dateTo))
        ${custWhere}
      GROUP BY c.CustKey, c.CustName, c.CustArea, c.Manager
      ORDER BY c.CustArea, c.CustName`,
      params
    );

    // 거래처별 입금 합계
    const paidResult = await query(
      `SELECT CustKey, SUM(Amount) AS totalPaid
      FROM ReceivableLedger
      WHERE LedgerType = N'입금' AND isDeleted = 0
      GROUP BY CustKey`
    );

    // 입금 맵 구성
    const paidMap = {};
    for (const r of paidResult.recordset) {
      paidMap[r.CustKey] = Number(r.totalPaid) || 0;
    }

    const customers = salesResult.recordset.map(r => {
      const totalSales = Number(r.totalSales) || 0;
      const totalPaid  = paidMap[r.CustKey] || 0;
      return {
        custKey:     r.CustKey,
        custName:    r.CustName,
        area:        r.CustArea || '',
        manager:     r.Manager  || '',
        shipCount:   r.shipCount || 0,
        totalSales,
        totalPaid,
        balance:     totalSales - totalPaid,
        lastShipDtm: r.lastShipDtm || '',
      };
    });

    return res.status(200).json({ success: true, customers });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 거래처 원장 (출고+입금 타임라인) ─────────────────
async function getLedger(req, res) {
  const { custKey } = req.query;
  if (!custKey) return res.status(400).json({ success: false, error: 'custKey 필요' });
  const ckInt = parseInt(custKey);

  try {
    // 거래처 기본 정보
    const custResult = await query(
      `SELECT CustKey, CustName, CustArea, Manager FROM Customer WHERE CustKey = @ck AND isDeleted = 0`,
      { ck: { type: sql.Int, value: ckInt } }
    );
    const customer = custResult.recordset[0] || null;

    // 출고 내역
    const shipResult = await query(
      `SELECT
        MAX(CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS entryDate,
        N'출고' AS entryType,
        SUM(ROUND(ISNULL(p.Cost, 0) * sd.OutQuantity / 1.1, 0)) AS amount,
        sm.ShipmentKey,
        NULL AS memo,
        NULL AS bankAccount
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
      WHERE sm.CustKey = @ck AND sm.isDeleted = 0 AND sm.isFix = 1
      GROUP BY sm.ShipmentKey
      ORDER BY MAX(sd.ShipmentDtm) ASC`,
      { ck: { type: sql.Int, value: ckInt } }
    );

    // 입금 내역
    const payResult = await query(
      `SELECT
        LedgerDtm AS entryDate,
        LedgerType AS entryType,
        Amount AS amount,
        NULL AS shipmentKey,
        Memo AS memo,
        BankAccount AS bankAccount
      FROM ReceivableLedger
      WHERE CustKey = @ck AND isDeleted = 0
      ORDER BY LedgerDtm ASC`,
      { ck: { type: sql.Int, value: ckInt } }
    );

    // 타임라인 병합 후 날짜 정렬
    const rows = [
      ...shipResult.recordset.map(r => ({
        date:        r.entryDate || '',
        type:        '출고',
        amount:      Number(r.amount) || 0,
        shipmentKey: r.ShipmentKey,
        memo:        '',
        bankAccount: '',
      })),
      ...payResult.recordset.map(r => ({
        date:        r.entryDate || '',
        type:        r.entryType || '입금',
        amount:      Number(r.amount) || 0,
        shipmentKey: null,
        memo:        r.memo || '',
        bankAccount: r.bankAccount || '',
      })),
    ].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

    // 누적 잔액 계산 (출고=+, 입금=-)
    let running = 0;
    const ledger = rows.map(r => {
      if (r.type === '출고') {
        running += r.amount;
      } else {
        running -= r.amount;
      }
      return { ...r, runningBalance: running };
    });

    return res.status(200).json({ success: true, customer, ledger });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 입금 등록 ─────────────────────────────────────
async function postPayment(req, res) {
  const { custKey, amount, ledgerDtm, bankAccount, memo } = req.body || {};

  if (!custKey || !amount || !ledgerDtm) {
    return res.status(400).json({ success: false, error: '거래처, 입금금액, 입금일자는 필수입니다.' });
  }

  const amtNum = parseFloat(amount);
  if (isNaN(amtNum) || amtNum <= 0) {
    return res.status(400).json({ success: false, error: '입금금액은 0보다 커야 합니다.' });
  }

  try {
    await query(
      `INSERT INTO ReceivableLedger
        (CustKey, LedgerDtm, LedgerType, Amount, BankAccount, Memo, CreateDtm, isDeleted)
       VALUES
        (@custKey, @dtm, N'입금', @amount, @bankAccount, @memo, GETDATE(), 0)`,
      {
        custKey:     { type: sql.Int,      value: parseInt(custKey) },
        dtm:         { type: sql.NVarChar, value: ledgerDtm },
        amount:      { type: sql.Decimal,  value: amtNum },
        bankAccount: { type: sql.NVarChar, value: bankAccount || '' },
        memo:        { type: sql.NVarChar, value: memo        || '' },
      }
    );
    return res.status(201).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
