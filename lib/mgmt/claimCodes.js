// 클레임 사유코드: web_mgmt.ClaimReasonCode / ClaimReasonLink 쓰기. 불량차감(dbo.WebSalesDefectDeduction)은 SELECT 만.
import { sql } from '../db.js';
import { ensureMgmtSchema } from './schema.js';
import { mgmtQuery } from './safeQuery.js';
import { seedsToInsert, aggregateByFarmReason, DEFECT_SOURCE_TABLE } from './claimCodesCore.js';

export async function listCodes() {
  await ensureMgmtSchema();
  const r = await mgmtQuery(`SELECT Code, Label, Category, SortOrder, IsActive FROM web_mgmt.ClaimReasonCode ORDER BY SortOrder, Code`);
  return r.recordset;
}

export async function seedCodes() {
  const existing = (await listCodes()).map((c) => c.Code);
  const todo = seedsToInsert(existing);
  for (const s of todo) {
    // 동시 호출 대비 NOT EXISTS 재확인(PK 중복 삽입 방지)
    await mgmtQuery(
      `INSERT INTO web_mgmt.ClaimReasonCode (Code, Label, Category, SortOrder, IsActive)
       SELECT @c, @l, @cat, @s, 1 WHERE NOT EXISTS (SELECT 1 FROM web_mgmt.ClaimReasonCode WHERE Code=@c)`,
      {
        c: { type: sql.NVarChar(20), value: s.code }, l: { type: sql.NVarChar(100), value: s.label },
        cat: { type: sql.NVarChar(40), value: s.category }, s: { type: sql.Int, value: s.sortOrder },
      });
  }
  return { inserted: todo.length, skipped: 8 - todo.length };
}

export async function saveCode({ code, label, category = '', sortOrder = 0 }) {
  await ensureMgmtSchema();
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,20}$/.test(c)) throw new Error('코드는 영문대문자/숫자/-/_ 20자 이내');
  if (!String(label || '').trim()) throw new Error('이름 필수');
  const params = {
    c: { type: sql.NVarChar(20), value: c }, l: { type: sql.NVarChar(100), value: String(label).trim() },
    cat: { type: sql.NVarChar(40), value: String(category || '') }, s: { type: sql.Int, value: Number(sortOrder) || 0 },
  };
  await mgmtQuery(
    `IF EXISTS (SELECT 1 FROM web_mgmt.ClaimReasonCode WHERE Code=@c)
       UPDATE web_mgmt.ClaimReasonCode SET Label=@l, Category=@cat, SortOrder=@s WHERE Code=@c
     ELSE
       INSERT INTO web_mgmt.ClaimReasonCode (Code, Label, Category, SortOrder, IsActive) VALUES (@c, @l, @cat, @s, 1)`, params);
  return c;
}

// 하드삭제 없음: 활성/비활성 토글만.
export async function setCodeActive(code, isActive) {
  await ensureMgmtSchema();
  await mgmtQuery(`UPDATE web_mgmt.ClaimReasonCode SET IsActive=@a WHERE Code=@c`, {
    a: { type: sql.Bit, value: isActive ? 1 : 0 }, c: { type: sql.NVarChar(20), value: String(code) },
  });
}

// 불량차감 행에 코드 연결(추가 전용; 최신 연결이 유효).
export async function linkCode({ deductionKey, code, note = '', actorId = '' }) {
  await ensureMgmtSchema();
  const key = Number(deductionKey);
  if (!Number.isInteger(key) || key <= 0) throw new Error('deductionKey 오류');
  const ok = await mgmtQuery(`SELECT 1 AS x FROM web_mgmt.ClaimReasonCode WHERE Code=@c AND IsActive=1`, { c: { type: sql.NVarChar(20), value: String(code) } });
  if (!ok.recordset.length) throw new Error(`사용 가능한 코드가 아닙니다: ${code}`);
  const exists = await mgmtQuery(`SELECT 1 AS x FROM WebSalesDefectDeduction WHERE DeductionKey=@k`, { k: { type: sql.Int, value: key } });
  if (!exists.recordset.length) throw new Error(`불량차감 행 없음: ${key}`);
  await mgmtQuery(
    `INSERT INTO web_mgmt.ClaimReasonLink (SourceTable, SourceKey, Code, Note, CreatedBy) VALUES (@t, @k, @c, @n, @u)`,
    {
      t: { type: sql.NVarChar(60), value: DEFECT_SOURCE_TABLE }, k: { type: sql.NVarChar(100), value: String(key) },
      c: { type: sql.NVarChar(20), value: String(code) }, n: { type: sql.NVarChar(400), value: String(note || '').slice(0, 400) },
      u: { type: sql.NVarChar(100), value: actorId || '' },
    });
}

// 최근 불량차감 행(읽기) + 현재 연결 코드. from/to: 'YYYY-MM-DD'(CreatedAt 기준)
export async function recentDefectRows({ from, to, limit = 300 } = {}) {
  await ensureMgmtSchema();
  const params = { lim: { type: sql.Int, value: Math.min(Math.max(Number(limit) || 300, 1), 2000) } };
  let where = 'WHERE d.IsDeleted=0';
  if (from) { where += ' AND d.CreatedAt >= @from'; params.from = { type: sql.Date, value: from }; }
  if (to) { where += ' AND d.CreatedAt < DATEADD(day,1,@to)'; params.to = { type: sql.Date, value: to }; }
  const r = await mgmtQuery(
    `SELECT TOP (@lim) d.DeductionKey, d.OrderYear, d.OrderWeek, d.CustName, d.ProdName, d.Quantity, d.SourceUnit, d.FarmName, d.DeductionType, d.CreatedAt
       FROM WebSalesDefectDeduction d ${where}
      ORDER BY d.DeductionKey DESC`, params);
  const rows = r.recordset.map((x) => ({
    deductionKey: x.DeductionKey, orderYear: x.OrderYear, orderWeek: x.OrderWeek, custName: x.CustName, prodName: x.ProdName,
    quantity: Number(x.Quantity || 0), sourceUnit: x.SourceUnit, farmName: x.FarmName || '', deductionType: x.DeductionType, createdAt: x.CreatedAt,
  }));
  const links = rows.length ? await linksFor(rows.map((x) => x.deductionKey)) : [];
  return { rows, links };
}

async function linksFor(keys) {
  const list = keys.map((k) => `N'${Number(k)}'`).join(',');
  const r = await mgmtQuery(
    `SELECT LinkKey, SourceKey, Code FROM web_mgmt.ClaimReasonLink WHERE SourceTable=@t AND SourceKey IN (${list})`,
    { t: { type: sql.NVarChar(60), value: DEFECT_SOURCE_TABLE } });
  return r.recordset.map((l) => ({ linkKey: l.LinkKey, sourceKey: l.SourceKey, code: l.Code }));
}

export async function claimSummary(opts = {}) {
  const { rows, links } = await recentDefectRows({ ...opts, limit: 2000 });
  return aggregateByFarmReason(rows, links);
}
