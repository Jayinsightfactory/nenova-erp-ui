// pages/api/finance/shinhan-sync.js — 신한은행 계좌거래내역 → BankTransaction 동기화
// GET  → 연동 상태(설정 여부·환경·계좌 마스킹·최근 동기화)  ※ 은행 호출 없음, DB 읽기만
// POST → 거래내역 조회 후 BankTransaction 에 적재(IsSample=0, BankName='신한은행')
//        body: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', accounts?: [..], includeLoan?: bool }
//        인증: 로그인(JWT) 관리자 계정 또는 Authorization: Bearer <AUTOMATION_API_TOKEN>(예약 동기화용)
//
// 보안성심의 대응: client secret/접근키는 lib/shinhanApi.js 내부에서만 쓰고 응답·로그에 싣지 않는다.
// 계좌번호는 응답에서 maskAccount() 로 가린다. 거래 원문은 ERP DB(BankTransaction, 웹 전용 테이블)에만 저장.

import crypto from 'node:crypto';
import { query, sql } from '../../../lib/db';
import { verifyReqUser } from '../../../lib/auth';
import { createShinhanClient, loadShinhanConfig, maskAccount, ShinhanApiError } from '../../../lib/shinhanApi';

export const SHINHAN_SYNC_USER_IDS = Object.freeze(['nenovaSS3']);
const DEFAULT_LOOKBACK_DAYS = 7;

function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timingEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// 관리자 JWT 또는 자동화 토큰. 둘 다 아니면 401/403.
function authorize(req, res) {
  const expected = process.env.AUTOMATION_API_TOKEN;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const headerToken = String(req.headers['x-automation-token'] || '').trim();
  if (expected && (timingEqual(bearer, expected) || timingEqual(headerToken, expected))) {
    return { actor: 'automation' };
  }
  const user = verifyReqUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
    return null;
  }
  if (user.accountActive === false || !SHINHAN_SYNC_USER_IDS.includes(String(user.userId || ''))) {
    res.status(403).json({ success: false, code: 'SHINHAN_SYNC_ADMIN_ONLY', error: '은행 동기화는 지정된 관리자만 실행할 수 있습니다.' });
    return null;
  }
  return { actor: user.userId };
}

export default async function handler(req, res) {
  const auth = authorize(req, res);
  if (!auth) return undefined;
  try {
    if (req.method === 'GET') return await getStatus(req, res);
    if (req.method === 'POST') return await postSync(req, res, auth);
    return res.status(405).end();
  } catch (err) {
    console.error('[shinhan-sync]', err?.name, err?.resultCode || '', err?.message);
    const status = err instanceof ShinhanApiError ? 502 : 500;
    return res.status(status).json({ success: false, error: err.message, resultCode: err?.resultCode });
  }
}

async function getStatus(req, res) {
  const cfg = loadShinhanConfig();
  const last = await query(
    `SELECT MAX(CreateDtm) AS lastSync, COUNT(*) AS rows, MAX(TxDtm) AS lastTx
       FROM BankTransaction WHERE isDeleted = 0 AND IsSample = 0 AND BankName = N'신한은행'`
  ).catch(() => ({ recordset: [{ lastSync: null, rows: 0, lastTx: null }] }));
  const row = last.recordset[0] || {};
  return res.status(200).json({
    success: true,
    configured: cfg.configured,
    missing: cfg.missing,
    mode: cfg.mode,
    accounts: cfg.accounts.map(maskAccount),
    loanAccounts: cfg.loanAccounts.map(maskAccount),
    lastSync: row.lastSync || null,
    lastTx: row.lastTx || null,
    syncedRows: Number(row.rows) || 0,
  });
}

async function postSync(req, res, auth) {
  const body = req.body || {};
  const to = body.to || isoDate(new Date());
  const from = body.from || isoDate(new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000));
  const client = createShinhanClient();
  const cfg = client.config;
  if (!cfg.configured) {
    return res.status(503).json({ success: false, error: `신한 API 미설정: ${cfg.missing.join(', ')} (서버 .env.local)` });
  }
  const accounts = Array.isArray(body.accounts) && body.accounts.length
    ? body.accounts.map((a) => String(a).replace(/-/g, '')).filter((a) => cfg.accounts.includes(a))
    : cfg.accounts;
  if (!accounts.length) {
    return res.status(400).json({ success: false, error: 'SHINHAN_ACCOUNT_NOS 에 등록된 계좌가 없습니다.' });
  }

  const report = [];
  for (const accountNo of accounts) {
    const r = await client.fetchTransactions({ accountNo, from, to });
    const inserted = await upsertRows(r.rows);
    report.push({ account: maskAccount(accountNo), kind: 'deposit', fetched: r.rows.length, inserted, balance: r.balance });
  }
  if (body.includeLoan) {
    for (const accountNo of cfg.loanAccounts) {
      const r = await client.fetchLoanTransactions({ accountNo, from, to });
      const inserted = await upsertRows(r.rows);
      report.push({ account: maskAccount(accountNo), kind: 'loan', fetched: r.rows.length, inserted, balance: r.balance });
    }
  }
  console.info('[shinhan-sync]', JSON.stringify({ actor: auth.actor, from, to, report }));
  return res.status(200).json({ success: true, from, to, report });
}

// 같은 계좌·일시·구분·금액·잔액·메모면 이미 적재된 거래로 보고 건너뛴다(은행 API에 거래 고유번호가 없음).
async function upsertRows(rows) {
  let inserted = 0;
  for (const t of rows) {
    const r = await query(
      `INSERT INTO BankTransaction
         (TxDtm, TxType, AccountNo, AccountName, CustName, Amount, Balance, Counterpart, BankName, BranchName, Memo, IsSample, CreateDtm, isDeleted)
       SELECT @txDtm, @txType, @accountNo, @accountName, @custName, @amount, @balance, @counterpart, @bankName, @branchName, @memo, 0, GETDATE(), 0
       WHERE NOT EXISTS (
         SELECT 1 FROM BankTransaction
          WHERE isDeleted = 0 AND IsSample = 0 AND AccountNo = @accountNo AND TxDtm = @txDtm
            AND TxType = @txType AND Amount = @amount AND Balance = @balance AND ISNULL(Memo, '') = @memo
       )`,
      {
        txDtm: { type: sql.NVarChar, value: t.txDtm },
        txType: { type: sql.NVarChar, value: t.txType },
        accountNo: { type: sql.NVarChar, value: t.accountNo },
        accountName: { type: sql.NVarChar, value: t.accountName },
        custName: { type: sql.NVarChar, value: t.custName },
        amount: { type: sql.Decimal(18, 2), value: t.amount },
        balance: { type: sql.Decimal(18, 2), value: t.balance },
        counterpart: { type: sql.NVarChar, value: t.counterpart },
        bankName: { type: sql.NVarChar, value: t.bankName },
        branchName: { type: sql.NVarChar, value: t.branchName },
        memo: { type: sql.NVarChar, value: t.memo },
      }
    );
    inserted += r.rowsAffected?.[0] || 0;
  }
  return inserted;
}
