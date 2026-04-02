// pages/api/sales/tax-invoice.js
// 세금계산서 진행단계 API
// GET    → 목록 조회 (params: month, custName, step)
// POST   → 신규 등록
// PATCH  → 진행단계/전자발송번호 수정
// DELETE → 소프트 삭제

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

const CREATE_TABLE_SQL = `
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='TaxInvoice' AND xtype='U')
CREATE TABLE TaxInvoice (
  TaxInvKey     INT IDENTITY PRIMARY KEY,
  InvNo         NVARCHAR(30),
  InvDtm        NVARCHAR(20) NOT NULL,
  CustKey       INT,
  CustName      NVARCHAR(100),
  SupplyAmt     DECIMAL(18,2) DEFAULT 0,
  VatAmt        DECIMAL(18,2) DEFAULT 0,
  TotalAmt      DECIMAL(18,2) DEFAULT 0,
  TaxType       NVARCHAR(20) DEFAULT N'세금계산서',
  ProgressStep  NVARCHAR(30) DEFAULT N'출고완료',
  ElecTaxNo     NVARCHAR(50),
  Memo          NVARCHAR(200),
  CreateDtm     DATETIME DEFAULT GETDATE(),
  isDeleted     BIT DEFAULT 0
)
`;

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await query(CREATE_TABLE_SQL);
  tableReady = true;
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ success: false, error: '테이블 초기화 실패: ' + err.message });
  }

  if (req.method === 'GET')    return await getList(req, res);
  if (req.method === 'POST')   return await postCreate(req, res);
  if (req.method === 'PATCH')  return await patchStep(req, res);
  if (req.method === 'DELETE') return await softDelete(req, res);
  return res.status(405).end();
});

// ── 목록 조회 ─────────────────────────────────────────
async function getList(req, res) {
  const { month, custName, step } = req.query;

  const params = {};
  const conditions = ['isDeleted = 0'];

  if (month) {
    // month = YYYY-MM
    conditions.push('InvDtm LIKE @month');
    params.month = { type: sql.NVarChar, value: month + '%' };
  }
  if (custName) {
    conditions.push('CustName LIKE @custName');
    params.custName = { type: sql.NVarChar, value: '%' + custName + '%' };
  }
  if (step && step !== '전체') {
    conditions.push('ProgressStep = @step');
    params.step = { type: sql.NVarChar, value: step };
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const result = await query(
      `SELECT TaxInvKey, InvNo, InvDtm, CustKey, CustName,
              SupplyAmt, VatAmt, TotalAmt, TaxType,
              ProgressStep, ElecTaxNo, Memo, CreateDtm
       FROM TaxInvoice
       ${where}
       ORDER BY InvDtm DESC, TaxInvKey DESC`,
      params
    );

    const invoices = result.recordset.map(r => ({
      taxInvKey:    r.TaxInvKey,
      invNo:        r.InvNo        || '',
      invDtm:       r.InvDtm       || '',
      custKey:      r.CustKey,
      custName:     r.CustName     || '',
      supplyAmt:    Number(r.SupplyAmt) || 0,
      vatAmt:       Number(r.VatAmt)    || 0,
      totalAmt:     Number(r.TotalAmt)  || 0,
      taxType:      r.TaxType       || '세금계산서',
      progressStep: r.ProgressStep  || '출고완료',
      elecTaxNo:    r.ElecTaxNo     || '',
      memo:         r.Memo          || '',
      createDtm:    r.CreateDtm,
    }));

    return res.status(200).json({ success: true, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 신규 등록 ─────────────────────────────────────────
async function postCreate(req, res) {
  const { invDtm, custKey, custName, supplyAmt, vatAmt, taxType, memo } = req.body || {};

  if (!invDtm || !custName) {
    return res.status(400).json({ success: false, error: '일자와 거래처명은 필수입니다.' });
  }

  const supply = parseFloat(supplyAmt) || 0;
  const vat    = parseFloat(vatAmt)    || 0;
  const total  = supply + vat;

  try {
    await query(
      `INSERT INTO TaxInvoice
         (InvDtm, CustKey, CustName, SupplyAmt, VatAmt, TotalAmt, TaxType, ProgressStep, Memo, CreateDtm, isDeleted)
       VALUES
         (@invDtm, @custKey, @custName, @supply, @vat, @total, @taxType, N'출고완료', @memo, GETDATE(), 0)`,
      {
        invDtm:   { type: sql.NVarChar, value: invDtm },
        custKey:  { type: sql.Int,      value: custKey ? parseInt(custKey) : null },
        custName: { type: sql.NVarChar, value: custName },
        supply:   { type: sql.Decimal,  value: supply },
        vat:      { type: sql.Decimal,  value: vat },
        total:    { type: sql.Decimal,  value: total },
        taxType:  { type: sql.NVarChar, value: taxType || '세금계산서' },
        memo:     { type: sql.NVarChar, value: memo    || '' },
      }
    );
    return res.status(201).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 진행단계 수정 ──────────────────────────────────────
async function patchStep(req, res) {
  const { taxInvKey, progressStep, elecTaxNo } = req.body || {};

  if (!taxInvKey || !progressStep) {
    return res.status(400).json({ success: false, error: 'taxInvKey와 progressStep은 필수입니다.' });
  }

  try {
    await query(
      `UPDATE TaxInvoice
       SET ProgressStep = @step,
           ElecTaxNo    = COALESCE(@elecTaxNo, ElecTaxNo)
       WHERE TaxInvKey = @key AND isDeleted = 0`,
      {
        key:       { type: sql.Int,      value: parseInt(taxInvKey) },
        step:      { type: sql.NVarChar, value: progressStep },
        elecTaxNo: { type: sql.NVarChar, value: elecTaxNo || null },
      }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 소프트 삭제 ────────────────────────────────────────
async function softDelete(req, res) {
  const { taxInvKey } = req.body || {};
  if (!taxInvKey) {
    return res.status(400).json({ success: false, error: 'taxInvKey는 필수입니다.' });
  }

  try {
    await query(
      `UPDATE TaxInvoice SET isDeleted = 1 WHERE TaxInvKey = @key`,
      { key: { type: sql.Int, value: parseInt(taxInvKey) } }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
