// lib/farmRemitInbox.js
// 송금 자동 인식 대기함 — WebFarmRemit(웹 전용 테이블)에 Status/Source 컬럼을 더해 '확인 대기(PENDING)' 행을 다룬다.
//   ensureRemitColumns()      기존 테이블에 없는 컬럼만 추가(웹 전용 테이블, 전산 테이블 아님)
//   importRemitFile(...)      드라이브 파일(buffer) → 파싱 → 농장 매칭 → 거래접수번호 기준 UPSERT(PENDING). 손으로 확정한 행은 덮지 않음
//   listInbox()/confirm()/reject()
import { query, sql } from './db';
import * as XLSX from 'xlsx';
import { parseRemitRequestWorkbook, buildFarmMatcher } from './farmRemitImport';
import { makeCanon, readAliases } from './farmAlias';

let _cols = false;
export async function ensureRemitColumns() {
  if (_cols) return;
  await query(`
    IF OBJECT_ID('dbo.WebFarmRemit','U') IS NULL
      CREATE TABLE dbo.WebFarmRemit (AutoKey INT IDENTITY(1,1) PRIMARY KEY, OrderYear NVARCHAR(4) NOT NULL, Weeks NVARCHAR(200) NOT NULL DEFAULT N'', FarmName NVARCHAR(120) NOT NULL, AmountUSD FLOAT NOT NULL DEFAULT 0, RemitDate NVARCHAR(10) NOT NULL DEFAULT N'', Memo NVARCHAR(400) NOT NULL DEFAULT N'', CreateID NVARCHAR(50) NOT NULL DEFAULT N'', CreateDtm DATETIME NOT NULL DEFAULT GETDATE(), isDeleted BIT NOT NULL DEFAULT 0);
    IF COL_LENGTH('dbo.WebFarmRemit','Status') IS NULL ALTER TABLE dbo.WebFarmRemit ADD Status NVARCHAR(20) NOT NULL DEFAULT N'CONFIRMED';
    IF COL_LENGTH('dbo.WebFarmRemit','Source') IS NULL ALTER TABLE dbo.WebFarmRemit ADD Source NVARCHAR(30) NOT NULL DEFAULT N'manual';
    IF COL_LENGTH('dbo.WebFarmRemit','SourceRef') IS NULL ALTER TABLE dbo.WebFarmRemit ADD SourceRef NVARCHAR(80) NOT NULL DEFAULT N'';
    IF COL_LENGTH('dbo.WebFarmRemit','SourceFileId') IS NULL ALTER TABLE dbo.WebFarmRemit ADD SourceFileId NVARCHAR(80) NOT NULL DEFAULT N'';
    IF COL_LENGTH('dbo.WebFarmRemit','SourceFileName') IS NULL ALTER TABLE dbo.WebFarmRemit ADD SourceFileName NVARCHAR(300) NOT NULL DEFAULT N'';
    IF COL_LENGTH('dbo.WebFarmRemit','Currency') IS NULL ALTER TABLE dbo.WebFarmRemit ADD Currency NVARCHAR(8) NOT NULL DEFAULT N'USD';
    IF COL_LENGTH('dbo.WebFarmRemit','AmountOrig') IS NULL ALTER TABLE dbo.WebFarmRemit ADD AmountOrig FLOAT NULL;
    IF COL_LENGTH('dbo.WebFarmRemit','Payee') IS NULL ALTER TABLE dbo.WebFarmRemit ADD Payee NVARCHAR(200) NOT NULL DEFAULT N'';
    IF COL_LENGTH('dbo.WebFarmRemit','MatchScore') IS NULL ALTER TABLE dbo.WebFarmRemit ADD MatchScore FLOAT NULL;
    IF COL_LENGTH('dbo.WebFarmRemit','ConfirmedBy') IS NULL ALTER TABLE dbo.WebFarmRemit ADD ConfirmedBy NVARCHAR(50) NOT NULL DEFAULT N'';
    IF COL_LENGTH('dbo.WebFarmRemit','ConfirmedAt') IS NULL ALTER TABLE dbo.WebFarmRemit ADD ConfirmedAt DATETIME NULL;`);
  _cols = true;
}

async function farmList() {
  const r = await query(`SELECT DISTINCT FarmName FROM WarehouseMaster WHERE ISNULL(isDeleted,0)=0 AND FarmName<>N''`);
  return r.recordset.map((x) => x.FarmName);
}

// 파일 1개 처리. 반환: { parsed, inserted, updated, skipped(확정/거절된 행), unmatched }
export async function importRemitFile({ buffer, fileId = '', fileName = '', by = 'drive-auto' }) {
  await ensureRemitColumns();
  const rows = parseRemitRequestWorkbook(buffer, XLSX);
  if (!rows.length) return { parsed: 0, inserted: 0, updated: 0, skipped: 0, unmatched: 0 };
  // 별칭 사전: 수취인이 별칭으로 적혀도(예: Colibri Flowers) 원장 대표명으로 매칭
  const aliases = readAliases(); const canon = makeCanon(aliases);
  const base = buildFarmMatcher([...new Set([...(await farmList()), ...Object.values(aliases).map((a) => a.alias)])]);
  const match = (payee) => { const m = base(payee); return m.farm ? { ...m, farm: canon(m.farm) } : m; };
  let inserted = 0, updated = 0, skipped = 0, unmatched = 0;
  for (const r of rows) {
    const m = match(r.payee); if (!m.farm) unmatched++;
    const ref = r.receiptNo || `${fileName}#${r.sheet}#${r.payee}#${r.amount}#${r.date}`;
    const P = { ref: { type: sql.NVarChar, value: ref.slice(0, 80) }, yr: { type: sql.NVarChar, value: (r.date || r.plannedDate || '').slice(0, 4) || String(new Date().getFullYear()) },
      farm: { type: sql.NVarChar, value: (m.farm || '').slice(0, 120) }, amt: { type: sql.Float, value: r.currency === 'USD' ? r.amount : 0 }, orig: { type: sql.Float, value: r.amount }, cur: { type: sql.NVarChar, value: r.currency.slice(0, 8) },
      dt: { type: sql.NVarChar, value: (r.plannedDate || r.date || '').slice(0, 10) }, payee: { type: sql.NVarChar, value: r.payee.slice(0, 200) }, score: { type: sql.Float, value: m.score || 0 },
      fid: { type: sql.NVarChar, value: String(fileId).slice(0, 80) }, fname: { type: sql.NVarChar, value: String(fileName).slice(0, 300) }, by: { type: sql.NVarChar, value: by.slice(0, 50) },
      memo: { type: sql.NVarChar, value: `자동인식 ${r.bank ? r.bank.slice(0, 60) : ''}`.trim().slice(0, 400) } };
    const ex = await query(`SELECT AutoKey, Status FROM WebFarmRemit WHERE SourceRef=@ref AND isDeleted=0`, P);
    if (ex.recordset.length) {
      if (ex.recordset[0].Status !== 'PENDING') { skipped++; continue; } // 사람이 확정/거절한 건은 재처리로 덮지 않음
      await query(`UPDATE WebFarmRemit SET FarmName=CASE WHEN FarmName=N'' THEN @farm ELSE FarmName END, AmountUSD=@amt, AmountOrig=@orig, Currency=@cur, RemitDate=@dt, Payee=@payee, MatchScore=@score, SourceFileId=@fid, SourceFileName=@fname WHERE SourceRef=@ref AND isDeleted=0`, P); updated++;
    } else {
      await query(`INSERT INTO WebFarmRemit (OrderYear, Weeks, FarmName, AmountUSD, RemitDate, Memo, CreateID, Status, Source, SourceRef, SourceFileId, SourceFileName, Currency, AmountOrig, Payee, MatchScore)
                   VALUES (@yr, N'', @farm, @amt, @dt, @memo, @by, N'PENDING', N'remit-request', @ref, @fid, @fname, @cur, @orig, @payee, @score)`, P); inserted++;
    }
  }
  return { parsed: rows.length, inserted, updated, skipped, unmatched };
}

export async function listInbox({ status = 'PENDING' } = {}) {
  await ensureRemitColumns();
  const r = await query(`SELECT AutoKey, OrderYear, Weeks, FarmName, AmountUSD, AmountOrig, Currency, RemitDate, Memo, Status, Source, SourceRef, SourceFileId, SourceFileName, Payee, MatchScore, CONVERT(varchar(16), CreateDtm, 120) AS CreateDtm
                           FROM WebFarmRemit WHERE isDeleted=0 AND Status=@st ORDER BY RemitDate DESC, AutoKey DESC`, { st: { type: sql.NVarChar, value: status } });
  return r.recordset.map((x) => ({ key: x.AutoKey, year: x.OrderYear, weeks: x.Weeks, farm: x.FarmName, amountUSD: x.AmountUSD, amountOrig: x.AmountOrig, currency: x.Currency, date: x.RemitDate, memo: x.Memo, status: x.Status, source: x.Source, ref: x.SourceRef, fileId: x.SourceFileId, fileName: x.SourceFileName, payee: x.Payee, score: x.MatchScore, createdAt: x.CreateDtm }));
}

export async function confirmInbox({ key, farmName, weeks = '', amountUSD, user }) {
  await ensureRemitColumns();
  if (!(key > 0) || !String(farmName || '').trim()) throw new Error('key·farmName 필요');
  const P = { k: { type: sql.Int, value: Number(key) }, farm: { type: sql.NVarChar, value: String(farmName).trim().slice(0, 120) }, wk: { type: sql.NVarChar, value: String(weeks || '').slice(0, 200) }, by: { type: sql.NVarChar, value: String(user?.userId || '').slice(0, 50) } };
  let amtSql = '';
  if (amountUSD != null && Number.isFinite(Number(amountUSD))) { amtSql = ', AmountUSD=@amt'; P.amt = { type: sql.Float, value: Number(amountUSD) }; }
  await query(`UPDATE WebFarmRemit SET Status=N'CONFIRMED', FarmName=@farm, Weeks=@wk, ConfirmedBy=@by, ConfirmedAt=GETDATE()${amtSql} WHERE AutoKey=@k AND isDeleted=0 AND Status=N'PENDING'`, P);
  return { ok: true };
}
export async function rejectInbox({ key, user }) {
  await ensureRemitColumns();
  await query(`UPDATE WebFarmRemit SET Status=N'REJECTED', ConfirmedBy=@by, ConfirmedAt=GETDATE() WHERE AutoKey=@k AND isDeleted=0 AND Status=N'PENDING'`, { k: { type: sql.Int, value: Number(key) }, by: { type: sql.NVarChar, value: String(user?.userId || '').slice(0, 50) } });
  return { ok: true };
}
