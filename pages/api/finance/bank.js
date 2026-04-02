// pages/api/finance/bank.js
// 입/출금 조회 API (샘플 모드)
// GET    → 목록 조회 (params: dateFrom, dateTo, txType, accountNo, custName)
// POST   → 수동 입력 (IsSample=1)
// DELETE → 소프트 삭제

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

const CREATE_TABLE_SQL = `
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='BankTransaction' AND xtype='U')
CREATE TABLE BankTransaction (
  TxKey       INT IDENTITY PRIMARY KEY,
  TxDtm       NVARCHAR(20) NOT NULL,
  TxType      NVARCHAR(10) NOT NULL,
  AccountNo   NVARCHAR(30),
  AccountName NVARCHAR(50),
  CustName    NVARCHAR(100),
  Amount      DECIMAL(18,2) NOT NULL,
  Balance     DECIMAL(18,2) DEFAULT 0,
  Counterpart NVARCHAR(100),
  BankName    NVARCHAR(50),
  BranchName  NVARCHAR(50),
  Memo        NVARCHAR(200),
  IsSample    BIT DEFAULT 1,
  CreateDtm   DATETIME DEFAULT GETDATE(),
  isDeleted   BIT DEFAULT 0
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
  if (req.method === 'DELETE') return await softDelete(req, res);
  return res.status(405).end();
});

// ── 목록 조회 ─────────────────────────────────────────
async function getList(req, res) {
  const { dateFrom, dateTo, txType, accountNo, custName } = req.query;

  const params = {};
  const conditions = ['isDeleted = 0'];

  if (dateFrom) {
    conditions.push('TxDtm >= @dateFrom');
    params.dateFrom = { type: sql.NVarChar, value: dateFrom };
  }
  if (dateTo) {
    conditions.push('TxDtm <= @dateTo + N\' 23:59:59\'');
    params.dateTo = { type: sql.NVarChar, value: dateTo };
  }
  if (txType && txType !== '전체') {
    conditions.push('TxType = @txType');
    params.txType = { type: sql.NVarChar, value: txType };
  }
  if (accountNo) {
    conditions.push('AccountNo LIKE @accountNo');
    params.accountNo = { type: sql.NVarChar, value: '%' + accountNo + '%' };
  }
  if (custName) {
    conditions.push('CustName LIKE @custName');
    params.custName = { type: sql.NVarChar, value: '%' + custName + '%' };
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const result = await query(
      `SELECT TxKey, TxDtm, TxType, AccountNo, AccountName,
              CustName, Amount, Balance, Counterpart,
              BankName, BranchName, Memo, IsSample, CreateDtm
       FROM BankTransaction
       ${where}
       ORDER BY TxDtm DESC, TxKey DESC`,
      params
    );

    const transactions = result.recordset.map(r => ({
      txKey:       r.TxKey,
      txDtm:       r.TxDtm       || '',
      txType:      r.TxType      || '',
      accountNo:   r.AccountNo   || '',
      accountName: r.AccountName || '',
      custName:    r.CustName    || '',
      amount:      Number(r.Amount)  || 0,
      balance:     Number(r.Balance) || 0,
      counterpart: r.Counterpart || '',
      bankName:    r.BankName    || '',
      branchName:  r.BranchName  || '',
      memo:        r.Memo        || '',
      isSample:    !!r.IsSample,
    }));

    // 요약 계산
    const totalIn  = transactions.filter(t => t.txType === '입금').reduce((a, t) => a + t.amount, 0);
    const totalOut = transactions.filter(t => t.txType === '출금').reduce((a, t) => a + t.amount, 0);
    const netAmount = totalIn - totalOut;

    return res.status(200).json({
      success: true,
      transactions,
      summary: { totalIn, totalOut, netAmount },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 수동 입력 ─────────────────────────────────────────
async function postCreate(req, res) {
  const { txDtm, txType, accountNo, accountName, custName,
          amount, balance, counterpart, bankName, branchName, memo } = req.body || {};

  if (!txDtm || !txType || !amount) {
    return res.status(400).json({ success: false, error: '일자, 구분, 금액은 필수입니다.' });
  }
  if (!['입금', '출금'].includes(txType)) {
    return res.status(400).json({ success: false, error: '구분은 입금 또는 출금이어야 합니다.' });
  }

  const amtNum = parseFloat(amount);
  if (isNaN(amtNum) || amtNum <= 0) {
    return res.status(400).json({ success: false, error: '금액은 0보다 커야 합니다.' });
  }

  try {
    await query(
      `INSERT INTO BankTransaction
         (TxDtm, TxType, AccountNo, AccountName, CustName,
          Amount, Balance, Counterpart, BankName, BranchName, Memo, IsSample, CreateDtm, isDeleted)
       VALUES
         (@txDtm, @txType, @accountNo, @accountName, @custName,
          @amount, @balance, @counterpart, @bankName, @branchName, @memo, 1, GETDATE(), 0)`,
      {
        txDtm:       { type: sql.NVarChar, value: txDtm },
        txType:      { type: sql.NVarChar, value: txType },
        accountNo:   { type: sql.NVarChar, value: accountNo   || '' },
        accountName: { type: sql.NVarChar, value: accountName || '' },
        custName:    { type: sql.NVarChar, value: custName    || '' },
        amount:      { type: sql.Decimal,  value: amtNum },
        balance:     { type: sql.Decimal,  value: parseFloat(balance) || 0 },
        counterpart: { type: sql.NVarChar, value: counterpart || '' },
        bankName:    { type: sql.NVarChar, value: bankName    || '' },
        branchName:  { type: sql.NVarChar, value: branchName  || '' },
        memo:        { type: sql.NVarChar, value: memo        || '' },
      }
    );
    return res.status(201).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 소프트 삭제 ────────────────────────────────────────
async function softDelete(req, res) {
  const { txKey } = req.body || {};
  if (!txKey) {
    return res.status(400).json({ success: false, error: 'txKey는 필수입니다.' });
  }

  try {
    await query(
      `UPDATE BankTransaction SET isDeleted = 1 WHERE TxKey = @key`,
      { key: { type: sql.Int, value: parseInt(txKey) } }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
