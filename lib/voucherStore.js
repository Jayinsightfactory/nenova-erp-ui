// lib/voucherStore.js — 지출결의서·전표 DB 접근(웹 전용 dbo.Web* 테이블만 쓴다)
// 읽기: Customer(ERP) 는 거래처명 보강용 SELECT 만. 쓰기: WebAccount/WebVoucher/WebVoucherLine/WebJournal/WebJournalLine.
// 테이블은 docs/migrations/2026-10-09_web_voucher.sql 로 SSMS 에서 먼저 생성한다(여기서 DDL 실행 안 함).
import { query, withTransaction, sql } from './db';
import {
  normalizeVoucherInput, nextVoucherNo, buildJournalLines, reverseJournalLines,
  canTransition, JOURNAL_TYPE_BY_VOUCHER, assertBalanced, round0,
} from './voucherJournal';

const P = (type, value) => ({ type, value });
const toDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

export async function listAccounts({ includeInactive = false } = {}) {
  const r = await query(
    `SELECT AccountCode, AccountName, AccountClass, IsActive, SortOrder
       FROM dbo.WebAccount ${includeInactive ? '' : 'WHERE IsActive = 1'}
      ORDER BY SortOrder, AccountCode`
  );
  return r.recordset.map((a) => ({ accountCode: a.AccountCode, accountName: a.AccountName, accountClass: a.AccountClass, isActive: !!a.IsActive }));
}

async function assertAccountsExist(tQuery, codes) {
  const uniq = [...new Set(codes.filter(Boolean))];
  if (!uniq.length) return;
  const params = {};
  const names = uniq.map((c, i) => { params[`c${i}`] = P(sql.NVarChar(10), c); return `@c${i}`; });
  const r = await tQuery(`SELECT AccountCode FROM dbo.WebAccount WHERE IsActive = 1 AND AccountCode IN (${names.join(',')})`, params);
  const found = new Set(r.recordset.map((x) => x.AccountCode));
  const missing = uniq.filter((c) => !found.has(c));
  if (missing.length) { const e = new Error(`없는/비활성 계정과목: ${missing.join(', ')}`); e.code = 'VALIDATION'; throw e; }
}

function mapVoucher(row) {
  return {
    voucherKey: row.VoucherKey, voucherNo: row.VoucherNo, voucherType: row.VoucherType,
    voucherDate: toDate(row.VoucherDate), fiscalYear: row.FiscalYear,
    custKey: row.CustKey, custName: row.CustName || row.ErpCustName || '',
    period: row.Period || '', manager: row.Manager || '', employeeName: row.EmployeeName || '', fundCode: row.FundCode || '',
    currency: row.Currency, fxRate: Number(row.FxRate), totalAmount: Number(row.TotalAmount), totalForeign: Number(row.TotalForeign),
    status: row.Status, attachUrl: row.AttachUrl || '', memo: row.Memo || '', journalKey: row.JournalKey,
    journalNo: row.JournalNo || null,
    approveDtm: row.ApproveDtm, remitDtm: row.RemitDtm, postDtm: row.PostDtm,
    createId: row.CreateID, createDtm: row.CreateDtm, updateId: row.UpdateID, updateDtm: row.UpdateDtm,
  };
}
function mapLine(row) {
  return {
    lineKey: row.LineKey, lineNo: row.LineNo, accountCode: row.AccountCode, accountName: row.AccountName || '',
    amount: Number(row.Amount), foreignAmount: Number(row.ForeignAmount), descr: row.Descr || '', dept: row.Dept || '', orderYearWeek: row.OrderYearWeek || '',
  };
}

// ── 목록 (필터: 기간·거래처·유형·상태·금액·적요)
export async function listVouchers(f = {}) {
  const where = ['v.isDeleted = 0'];
  const params = {};
  if (f.dateFrom) { where.push('v.VoucherDate >= @dateFrom'); params.dateFrom = P(sql.Date, f.dateFrom); }
  if (f.dateTo) { where.push('v.VoucherDate <= @dateTo'); params.dateTo = P(sql.Date, f.dateTo); }
  if (f.voucherType) { where.push('v.VoucherType = @vt'); params.vt = P(sql.NVarChar(10), f.voucherType); }
  if (f.status) { where.push('v.Status = @st'); params.st = P(sql.NVarChar(10), f.status); }
  if (f.custKey) { where.push('v.CustKey = @ck'); params.ck = P(sql.Int, Number(f.custKey)); }
  if (f.custName) { where.push('(v.CustName LIKE @cn OR c.CustName LIKE @cn)'); params.cn = P(sql.NVarChar(100), `%${f.custName}%`); }
  if (f.amountMin) { where.push('v.TotalAmount >= @amin'); params.amin = P(sql.Decimal(18, 2), Number(f.amountMin)); }
  if (f.amountMax) { where.push('v.TotalAmount <= @amax'); params.amax = P(sql.Decimal(18, 2), Number(f.amountMax)); }
  if (f.descr) {
    where.push('(v.Memo LIKE @ds OR EXISTS (SELECT 1 FROM dbo.WebVoucherLine l WHERE l.VoucherKey = v.VoucherKey AND l.Descr LIKE @ds))');
    params.ds = P(sql.NVarChar(200), `%${f.descr}%`);
  }
  if (f.voucherNo) { where.push('v.VoucherNo LIKE @vn'); params.vn = P(sql.NVarChar(16), `%${f.voucherNo}%`); }
  const r = await query(
    `SELECT TOP 2000 v.*, c.CustName AS ErpCustName, j.JournalNo
       FROM dbo.WebVoucher v
       LEFT JOIN Customer c ON c.CustKey = v.CustKey
       LEFT JOIN dbo.WebJournal j ON j.JournalKey = v.JournalKey
      WHERE ${where.join(' AND ')}
      ORDER BY v.VoucherDate DESC, v.VoucherKey DESC`, params);
  const rows = r.recordset.map(mapVoucher);
  const total = rows.reduce((s, v) => s + v.totalAmount, 0);
  return { rows, total, count: rows.length };
}

export async function getVoucher(voucherKey) {
  const r = await query(
    `SELECT v.*, c.CustName AS ErpCustName, j.JournalNo
       FROM dbo.WebVoucher v
       LEFT JOIN Customer c ON c.CustKey = v.CustKey
       LEFT JOIN dbo.WebJournal j ON j.JournalKey = v.JournalKey
      WHERE v.VoucherKey = @k AND v.isDeleted = 0`, { k: P(sql.Int, Number(voucherKey)) });
  if (!r.recordset.length) return null;
  const v = mapVoucher(r.recordset[0]);
  const l = await query(
    `SELECT l.*, a.AccountName FROM dbo.WebVoucherLine l LEFT JOIN dbo.WebAccount a ON a.AccountCode = l.AccountCode
      WHERE l.VoucherKey = @k ORDER BY l.LineNo`, { k: P(sql.Int, v.voucherKey) });
  v.lines = l.recordset.map(mapLine);
  if (v.journalKey) v.journal = await getJournal(v.journalKey);
  return v;
}

async function insertLines(tQuery, voucherKey, lines) {
  for (const l of lines) {
    await tQuery(
      `INSERT INTO dbo.WebVoucherLine (VoucherKey, LineNo, AccountCode, Amount, ForeignAmount, Descr, Dept, OrderYearWeek)
       VALUES (@vk, @no, @ac, @amt, @fx, @ds, @dp, @yw)`,
      { vk: P(sql.Int, voucherKey), no: P(sql.Int, l.lineNo), ac: P(sql.NVarChar(10), l.accountCode),
        amt: P(sql.Decimal(18, 2), l.amount), fx: P(sql.Decimal(18, 2), l.foreignAmount),
        ds: P(sql.NVarChar(200), l.descr), dp: P(sql.NVarChar(50), l.dept), yw: P(sql.NVarChar(12), l.orderYearWeek) });
  }
}

// ── 생성 (상태 작성, 채번 yy/mm/dd-n)
export async function createVoucher(input, actor) {
  const v = normalizeVoucherInput(input);
  return withTransaction(async (tQuery) => {
    await assertAccountsExist(tQuery, v.lines.map((l) => l.accountCode));
    const ex = await tQuery(
      `SELECT VoucherNo FROM dbo.WebVoucher WITH (UPDLOCK, HOLDLOCK) WHERE VoucherDate = @d`,
      { d: P(sql.Date, v.voucherDate) });
    const voucherNo = nextVoucherNo(v.voucherDate, ex.recordset.map((x) => x.VoucherNo));
    const r = await tQuery(
      `INSERT INTO dbo.WebVoucher (VoucherNo, VoucherType, VoucherDate, FiscalYear, CustKey, CustName, Period, Manager, EmployeeName, FundCode,
         Currency, FxRate, TotalAmount, TotalForeign, Status, AttachUrl, Memo, CreateID, UpdateID)
       OUTPUT INSERTED.VoucherKey
       VALUES (@no, @vt, @d, @fy, @ck, @cn, @pd, @mg, @en, @fc, @cur, @rate, @ta, @tf, N'작성', @att, @memo, @uid, @uid)`,
      { no: P(sql.NVarChar(16), voucherNo), vt: P(sql.NVarChar(10), v.voucherType), d: P(sql.Date, v.voucherDate), fy: P(sql.Int, v.fiscalYear),
        ck: P(sql.Int, v.custKey), cn: P(sql.NVarChar(100), v.custName), pd: P(sql.NVarChar(30), v.period), mg: P(sql.NVarChar(50), v.manager),
        en: P(sql.NVarChar(50), v.employeeName), fc: P(sql.NVarChar(20), v.fundCode), cur: P(sql.NVarChar(10), v.currency),
        rate: P(sql.Decimal(18, 6), v.fxRate), ta: P(sql.Decimal(18, 2), v.totalAmount), tf: P(sql.Decimal(18, 2), v.totalForeign),
        att: P(sql.NVarChar(500), v.attachUrl), memo: P(sql.NVarChar(400), v.memo), uid: P(sql.NVarChar(50), actor) });
    const voucherKey = r.recordset[0].VoucherKey;
    await insertLines(tQuery, voucherKey, v.lines);
    return { voucherKey, voucherNo };
  });
}

// ── 수정 (작성 상태만. 일자가 바뀌면 재채번)
export async function updateVoucher(voucherKey, input, actor) {
  const v = normalizeVoucherInput(input);
  return withTransaction(async (tQuery) => {
    const cur = await tQuery(`SELECT VoucherNo, VoucherDate, Status FROM dbo.WebVoucher WITH (UPDLOCK) WHERE VoucherKey = @k AND isDeleted = 0`, { k: P(sql.Int, Number(voucherKey)) });
    if (!cur.recordset.length) { const e = new Error('결의서 없음'); e.code = 'NOT_FOUND'; throw e; }
    const row = cur.recordset[0];
    if (row.Status !== '작성') { const e = new Error(`${row.Status} 상태는 수정할 수 없습니다(작성 상태만 수정)`); e.code = 'LOCKED'; throw e; }
    await assertAccountsExist(tQuery, v.lines.map((l) => l.accountCode));
    let voucherNo = row.VoucherNo;
    if (toDate(row.VoucherDate) !== v.voucherDate) {
      const ex = await tQuery(`SELECT VoucherNo FROM dbo.WebVoucher WITH (UPDLOCK, HOLDLOCK) WHERE VoucherDate = @d`, { d: P(sql.Date, v.voucherDate) });
      voucherNo = nextVoucherNo(v.voucherDate, ex.recordset.map((x) => x.VoucherNo));
    }
    await tQuery(
      `UPDATE dbo.WebVoucher SET VoucherNo=@no, VoucherType=@vt, VoucherDate=@d, FiscalYear=@fy, CustKey=@ck, CustName=@cn, Period=@pd, Manager=@mg,
         EmployeeName=@en, FundCode=@fc, Currency=@cur, FxRate=@rate, TotalAmount=@ta, TotalForeign=@tf, AttachUrl=@att, Memo=@memo,
         UpdateID=@uid, UpdateDtm=GETDATE()
       WHERE VoucherKey=@k`,
      { k: P(sql.Int, Number(voucherKey)), no: P(sql.NVarChar(16), voucherNo), vt: P(sql.NVarChar(10), v.voucherType), d: P(sql.Date, v.voucherDate), fy: P(sql.Int, v.fiscalYear),
        ck: P(sql.Int, v.custKey), cn: P(sql.NVarChar(100), v.custName), pd: P(sql.NVarChar(30), v.period), mg: P(sql.NVarChar(50), v.manager),
        en: P(sql.NVarChar(50), v.employeeName), fc: P(sql.NVarChar(20), v.fundCode), cur: P(sql.NVarChar(10), v.currency),
        rate: P(sql.Decimal(18, 6), v.fxRate), ta: P(sql.Decimal(18, 2), v.totalAmount), tf: P(sql.Decimal(18, 2), v.totalForeign),
        att: P(sql.NVarChar(500), v.attachUrl), memo: P(sql.NVarChar(400), v.memo), uid: P(sql.NVarChar(50), actor) });
    await tQuery(`DELETE FROM dbo.WebVoucherLine WHERE VoucherKey = @k`, { k: P(sql.Int, Number(voucherKey)) });
    await insertLines(tQuery, Number(voucherKey), v.lines);
    return { voucherKey: Number(voucherKey), voucherNo };
  });
}

// ── 삭제 (작성 상태만, 소프트)
export async function deleteVoucher(voucherKey, actor) {
  const r = await query(
    `UPDATE dbo.WebVoucher SET isDeleted = 1, UpdateID = @uid, UpdateDtm = GETDATE()
      WHERE VoucherKey = @k AND isDeleted = 0 AND Status = N'작성'`,
    { k: P(sql.Int, Number(voucherKey)), uid: P(sql.NVarChar(50), actor) });
  if (!r.rowsAffected[0]) { const e = new Error('작성 상태의 결의서만 삭제할 수 있습니다'); e.code = 'LOCKED'; throw e; }
  return { voucherKey: Number(voucherKey) };
}

// ── 전표 생성(트랜잭션 내부)
async function insertJournal(tQuery, { journalDate, journalType, voucherKey, custKey, custName, descr, status, reversalOfKey, lines }, actor) {
  const { debit, credit } = assertBalanced(lines);
  const ex = await tQuery(`SELECT JournalNo FROM dbo.WebJournal WITH (UPDLOCK, HOLDLOCK) WHERE JournalDate = @d`, { d: P(sql.Date, journalDate) });
  const journalNo = nextVoucherNo(journalDate, ex.recordset.map((x) => x.JournalNo));
  const r = await tQuery(
    `INSERT INTO dbo.WebJournal (JournalNo, JournalDate, JournalType, VoucherKey, CustKey, CustName, Descr, TotalDebit, TotalCredit, Status, ReversalOfKey, ConfirmDtm, CreateID, UpdateID)
     OUTPUT INSERTED.JournalKey
     VALUES (@no, @d, @jt, @vk, @ck, @cn, @ds, @dr, @cr, @st, @rk, CASE WHEN @st = N'확정' THEN GETDATE() END, @uid, @uid)`,
    { no: P(sql.NVarChar(16), journalNo), d: P(sql.Date, journalDate), jt: P(sql.NVarChar(20), journalType), vk: P(sql.Int, voucherKey ?? null),
      ck: P(sql.Int, custKey ?? null), cn: P(sql.NVarChar(100), custName || ''), ds: P(sql.NVarChar(200), descr || ''),
      dr: P(sql.Decimal(18, 2), debit), cr: P(sql.Decimal(18, 2), credit), st: P(sql.NVarChar(10), status || '작성'),
      rk: P(sql.Int, reversalOfKey ?? null), uid: P(sql.NVarChar(50), actor) });
  const journalKey = r.recordset[0].JournalKey;
  for (const l of lines) {
    await tQuery(
      `INSERT INTO dbo.WebJournalLine (JournalKey, LineNo, Side, AccountCode, Amount, Descr, Dept, OrderYearWeek)
       VALUES (@jk, @no, @sd, @ac, @amt, @ds, @dp, @yw)`,
      { jk: P(sql.Int, journalKey), no: P(sql.Int, l.lineNo), sd: P(sql.NChar(2), l.side), ac: P(sql.NVarChar(10), l.accountCode),
        amt: P(sql.Decimal(18, 2), l.amount), ds: P(sql.NVarChar(200), l.descr || ''), dp: P(sql.NVarChar(50), l.dept || ''), yw: P(sql.NVarChar(12), l.orderYearWeek || '') });
  }
  return { journalKey, journalNo, debit, credit };
}

async function loadVoucherForTx(tQuery, voucherKey) {
  const h = await tQuery(`SELECT * FROM dbo.WebVoucher WITH (UPDLOCK) WHERE VoucherKey = @k AND isDeleted = 0`, { k: P(sql.Int, Number(voucherKey)) });
  if (!h.recordset.length) { const e = new Error('결의서 없음'); e.code = 'NOT_FOUND'; throw e; }
  const l = await tQuery(`SELECT * FROM dbo.WebVoucherLine WHERE VoucherKey = @k ORDER BY LineNo`, { k: P(sql.Int, Number(voucherKey)) });
  const v = mapVoucher(h.recordset[0]);
  v.lines = l.recordset.map(mapLine);
  return v;
}

// ── 상태 전이: approve(결재완료+전표 자동생성) / remit(송금완료) / post(전표반영=전표 확정) / cancel(역분개+취소)
export async function transitionVoucher(voucherKey, action, actor) {
  const target = { approve: '결재완료', remit: '송금완료', post: '전표반영', cancel: '취소' }[action];
  if (!target) { const e = new Error(`알 수 없는 action: ${action}`); e.code = 'VALIDATION'; throw e; }
  return withTransaction(async (tQuery) => {
    const v = await loadVoucherForTx(tQuery, voucherKey);
    if (!canTransition(v.status, target)) { const e = new Error(`${v.status} → ${target} 전이 불가`); e.code = 'TRANSITION'; throw e; }
    const k = P(sql.Int, v.voucherKey);
    const uid = P(sql.NVarChar(50), actor);
    let journal = null;
    if (action === 'approve') {
      const lines = buildJournalLines(v);
      journal = await insertJournal(tQuery, {
        journalDate: v.voucherDate, journalType: JOURNAL_TYPE_BY_VOUCHER[v.voucherType], voucherKey: v.voucherKey,
        custKey: v.custKey, custName: v.custName, descr: v.lines.map((l) => l.descr).filter(Boolean).join(', ').slice(0, 200) || v.memo,
        status: '작성', lines,
      }, actor);
      await tQuery(`UPDATE dbo.WebVoucher SET Status=N'결재완료', JournalKey=@jk, ApproveDtm=GETDATE(), UpdateID=@uid, UpdateDtm=GETDATE() WHERE VoucherKey=@k`,
        { k, uid, jk: P(sql.Int, journal.journalKey) });
    } else if (action === 'remit') {
      await tQuery(`UPDATE dbo.WebVoucher SET Status=N'송금완료', RemitDtm=GETDATE(), UpdateID=@uid, UpdateDtm=GETDATE() WHERE VoucherKey=@k`, { k, uid });
    } else if (action === 'post') {
      if (!v.journalKey) { const e = new Error('연결된 전표 없음'); e.code = 'TRANSITION'; throw e; }
      await tQuery(`UPDATE dbo.WebJournal SET Status=N'확정', ConfirmDtm=GETDATE(), UpdateID=@uid, UpdateDtm=GETDATE() WHERE JournalKey=@jk AND Status=N'작성'`,
        { uid, jk: P(sql.Int, v.journalKey) });
      await tQuery(`UPDATE dbo.WebVoucher SET Status=N'전표반영', PostDtm=GETDATE(), UpdateID=@uid, UpdateDtm=GETDATE() WHERE VoucherKey=@k`, { k, uid });
    } else if (action === 'cancel') {
      if (v.journalKey) {
        const j = await tQuery(`SELECT * FROM dbo.WebJournal WITH (UPDLOCK) WHERE JournalKey=@jk`, { jk: P(sql.Int, v.journalKey) });
        const jr = j.recordset[0];
        if (jr && jr.Status === '확정') {
          // 확정 전표는 수정 불가 → 역분개 전표(확정)로 상쇄
          const jl = await tQuery(`SELECT * FROM dbo.WebJournalLine WHERE JournalKey=@jk ORDER BY LineNo`, { jk: P(sql.Int, v.journalKey) });
          const rev = reverseJournalLines(jl.recordset.map((l) => ({ side: String(l.Side).trim(), accountCode: l.AccountCode, amount: Number(l.Amount), descr: l.Descr, dept: l.Dept, orderYearWeek: l.OrderYearWeek })));
          journal = await insertJournal(tQuery, {
            journalDate: new Date().toISOString().slice(0, 10), journalType: '역분개', voucherKey: v.voucherKey,
            custKey: v.custKey, custName: v.custName, descr: `[역분개] ${jr.JournalNo} ${jr.Descr || ''}`.slice(0, 200),
            status: '확정', reversalOfKey: v.journalKey, lines: rev,
          }, actor);
          await tQuery(`UPDATE dbo.WebJournal SET ReversedByKey=@rb, UpdateID=@uid, UpdateDtm=GETDATE() WHERE JournalKey=@jk`,
            { rb: P(sql.Int, journal.journalKey), uid, jk: P(sql.Int, v.journalKey) });
        } else if (jr) {
          // 미확정 전표는 취소 표시만
          await tQuery(`UPDATE dbo.WebJournal SET Status=N'취소', UpdateID=@uid, UpdateDtm=GETDATE() WHERE JournalKey=@jk`, { uid, jk: P(sql.Int, v.journalKey) });
        }
      }
      await tQuery(`UPDATE dbo.WebVoucher SET Status=N'취소', UpdateID=@uid, UpdateDtm=GETDATE() WHERE VoucherKey=@k`, { k, uid });
    }
    return { voucherKey: v.voucherKey, voucherNo: v.voucherNo, from: v.status, to: target, journal };
  });
}

// ── 전표 조회
function mapJournal(row) {
  return {
    journalKey: row.JournalKey, journalNo: row.JournalNo, journalDate: toDate(row.JournalDate), journalType: row.JournalType,
    voucherKey: row.VoucherKey, voucherNo: row.VoucherNo || null, voucherStatus: row.VoucherStatus || null,
    custKey: row.CustKey, custName: row.CustName || row.ErpCustName || '', descr: row.Descr || '',
    totalDebit: Number(row.TotalDebit), totalCredit: Number(row.TotalCredit), status: row.Status,
    reversalOfKey: row.ReversalOfKey, reversedByKey: row.ReversedByKey, isClosed: !!row.IsClosed,
    accounts: row.Accounts || '', depts: row.Depts || '',
    confirmDtm: row.ConfirmDtm, createId: row.CreateID, createDtm: row.CreateDtm,
  };
}

export async function getJournal(journalKey) {
  const r = await query(
    `SELECT j.*, v.VoucherNo, v.Status AS VoucherStatus, c.CustName AS ErpCustName
       FROM dbo.WebJournal j LEFT JOIN dbo.WebVoucher v ON v.VoucherKey = j.VoucherKey LEFT JOIN Customer c ON c.CustKey = j.CustKey
      WHERE j.JournalKey = @k`, { k: P(sql.Int, Number(journalKey)) });
  if (!r.recordset.length) return null;
  const j = mapJournal(r.recordset[0]);
  const l = await query(
    `SELECT l.*, a.AccountName FROM dbo.WebJournalLine l LEFT JOIN dbo.WebAccount a ON a.AccountCode = l.AccountCode
      WHERE l.JournalKey = @k ORDER BY l.LineNo`, { k: P(sql.Int, j.journalKey) });
  j.lines = l.recordset.map((x) => ({
    lineKey: x.LineKey, lineNo: x.LineNo, side: String(x.Side).trim(), accountCode: x.AccountCode, accountName: x.AccountName || '',
    amount: Number(x.Amount), descr: x.Descr || '', dept: x.Dept || '', orderYearWeek: x.OrderYearWeek || '',
  }));
  return j;
}

// 전표현황 (명세 §6): 필터 기간·전표No·거래처·계정·부서·금액·적요·결재완료만·마감 포함
export async function listJournals(f = {}) {
  const where = ['1=1'];
  const params = {};
  if (f.dateFrom) { where.push('j.JournalDate >= @dateFrom'); params.dateFrom = P(sql.Date, f.dateFrom); }
  if (f.dateTo) { where.push('j.JournalDate <= @dateTo'); params.dateTo = P(sql.Date, f.dateTo); }
  if (f.journalNo) { where.push('j.JournalNo LIKE @jn'); params.jn = P(sql.NVarChar(16), `%${f.journalNo}%`); }
  if (f.journalType) { where.push('j.JournalType = @jt'); params.jt = P(sql.NVarChar(20), f.journalType); }
  if (f.custKey) { where.push('j.CustKey = @ck'); params.ck = P(sql.Int, Number(f.custKey)); }
  if (f.custName) { where.push('(j.CustName LIKE @cn OR c.CustName LIKE @cn)'); params.cn = P(sql.NVarChar(100), `%${f.custName}%`); }
  if (f.accountCode) { where.push('EXISTS (SELECT 1 FROM dbo.WebJournalLine l WHERE l.JournalKey = j.JournalKey AND l.AccountCode = @ac)'); params.ac = P(sql.NVarChar(10), f.accountCode); }
  if (f.dept) { where.push('EXISTS (SELECT 1 FROM dbo.WebJournalLine l WHERE l.JournalKey = j.JournalKey AND l.Dept LIKE @dp)'); params.dp = P(sql.NVarChar(50), `%${f.dept}%`); }
  if (f.amountMin) { where.push('j.TotalDebit >= @amin'); params.amin = P(sql.Decimal(18, 2), Number(f.amountMin)); }
  if (f.amountMax) { where.push('j.TotalDebit <= @amax'); params.amax = P(sql.Decimal(18, 2), Number(f.amountMax)); }
  if (f.descr) { where.push('(j.Descr LIKE @ds OR EXISTS (SELECT 1 FROM dbo.WebJournalLine l WHERE l.JournalKey = j.JournalKey AND l.Descr LIKE @ds))'); params.ds = P(sql.NVarChar(200), `%${f.descr}%`); }
  if (f.approvedOnly) where.push("v.Status IN (N'결재완료', N'송금완료', N'전표반영')");
  if (!f.includeClosed) where.push('j.IsClosed = 0');
  if (!f.includeCancelled) where.push("j.Status <> N'취소'");
  const r = await query(
    `SELECT TOP 5000 j.*, v.VoucherNo, v.Status AS VoucherStatus, c.CustName AS ErpCustName,
            STUFF((SELECT DISTINCT ', ' + l.AccountCode + ' ' + ISNULL(a.AccountName, '')
                     FROM dbo.WebJournalLine l LEFT JOIN dbo.WebAccount a ON a.AccountCode = l.AccountCode
                    WHERE l.JournalKey = j.JournalKey AND l.Side = N'DR' FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Accounts,
            STUFF((SELECT DISTINCT ', ' + l.Dept FROM dbo.WebJournalLine l WHERE l.JournalKey = j.JournalKey AND ISNULL(l.Dept, '') <> '' FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Depts
       FROM dbo.WebJournal j
       LEFT JOIN dbo.WebVoucher v ON v.VoucherKey = j.VoucherKey
       LEFT JOIN Customer c ON c.CustKey = j.CustKey
      WHERE ${where.join(' AND ')}
      ORDER BY j.JournalDate, j.JournalKey`, params);
  const rows = r.recordset.map(mapJournal);
  return { rows, count: rows.length, grand: rows.reduce((s, j) => s + round0(j.totalDebit), 0) };
}
