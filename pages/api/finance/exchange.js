// pages/api/finance/exchange.js
// 외화/환율 관리 API
// GET  → 전체 목록 (CurrencyMaster)
// POST → UPSERT (신규추가 또는 수정)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

const CREATE_TABLE_SQL = `
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='CurrencyMaster' AND xtype='U')
CREATE TABLE CurrencyMaster (
  CurrencyCode  NVARCHAR(10) PRIMARY KEY,
  CurrencyName  NVARCHAR(50),
  ExchangeRate  DECIMAL(10,4) DEFAULT 0,
  UpdateDtm     NVARCHAR(20),
  IsActive      BIT DEFAULT 1
)
`;

const SEED_SQL = `
IF NOT EXISTS (SELECT 1 FROM CurrencyMaster)
BEGIN
  INSERT INTO CurrencyMaster VALUES (N'USD', N'미국 달러', 1300.00, CONVERT(NVARCHAR(20),GETDATE(),120), 1)
  INSERT INTO CurrencyMaster VALUES (N'EUR', N'유로',      1420.00, CONVERT(NVARCHAR(20),GETDATE(),120), 1)
  INSERT INTO CurrencyMaster VALUES (N'COP', N'콜롬비아 페소', 0.30, CONVERT(NVARCHAR(20),GETDATE(),120), 1)
  INSERT INTO CurrencyMaster VALUES (N'JPY', N'일본 엔',     8.90, CONVERT(NVARCHAR(20),GETDATE(),120), 1)
END
`;

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await query(CREATE_TABLE_SQL);
  await query(SEED_SQL);
  tableReady = true;
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ success: false, error: '테이블 초기화 실패: ' + err.message });
  }

  if (req.method === 'GET')  return await getList(req, res);
  if (req.method === 'POST') return await upsertCurrency(req, res);
  return res.status(405).end();
});

// ── 전체 목록 ─────────────────────────────────────────
async function getList(req, res) {
  try {
    const result = await query(
      `SELECT CurrencyCode, CurrencyName, ExchangeRate, UpdateDtm, IsActive
       FROM CurrencyMaster
       ORDER BY IsActive DESC, CurrencyCode`
    );

    const currencies = result.recordset.map(r => ({
      currencyCode: r.CurrencyCode,
      currencyName: r.CurrencyName  || '',
      exchangeRate: Number(r.ExchangeRate) || 0,
      updateDtm:    r.UpdateDtm     || '',
      isActive:     !!r.IsActive,
    }));

    return res.status(200).json({ success: true, currencies });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── UPSERT ────────────────────────────────────────────
async function upsertCurrency(req, res) {
  const { currencyCode, currencyName, exchangeRate, isActive } = req.body || {};

  if (!currencyCode) {
    return res.status(400).json({ success: false, error: '외화코드는 필수입니다.' });
  }

  const rate    = parseFloat(exchangeRate);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ success: false, error: '환율은 0 이상이어야 합니다.' });
  }

  const activeVal = isActive === false || isActive === 0 || isActive === '0' ? 0 : 1;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  try {
    await query(
      `IF EXISTS (SELECT 1 FROM CurrencyMaster WHERE CurrencyCode = @code)
         UPDATE CurrencyMaster
         SET CurrencyName = @name,
             ExchangeRate = @rate,
             UpdateDtm    = @now,
             IsActive     = @active
         WHERE CurrencyCode = @code
       ELSE
         INSERT INTO CurrencyMaster (CurrencyCode, CurrencyName, ExchangeRate, UpdateDtm, IsActive)
         VALUES (@code, @name, @rate, @now, @active)`,
      {
        code:   { type: sql.NVarChar, value: currencyCode.toUpperCase() },
        name:   { type: sql.NVarChar, value: currencyName  || currencyCode },
        rate:   { type: sql.Decimal,  value: rate },
        now:    { type: sql.NVarChar, value: now },
        active: { type: sql.Bit,      value: activeVal },
      }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
