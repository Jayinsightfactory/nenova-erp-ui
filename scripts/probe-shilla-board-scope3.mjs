/**
 * 잔량분배 게시판 — 웹 전용 원장 현황 / 44x 실적 유무 read-only 진단 (3차)
 * node scripts/probe-shilla-board-scope3.mjs
 * SELECT 만 수행한다. 운영 원장 쓰기 없음.
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
});

const q = async (label, text) => {
  const r = await pool.request().query(text);
  console.log(`\n=== ${label} ===`);
  console.table(r.recordset);
  return r.recordset;
};

await q('WebShillaMiuBoardAllocation 컬럼', `
  SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME='WebShillaMiuBoardAllocation' ORDER BY ORDINAL_POSITION`);

await q('WebShillaMiuBoardAllocation 저장 현황', `
  SELECT OrderYear, GroupKey, UseWeek, Destination, COUNT(*) rows, SUM(Qty) legacyQty, SUM(CAST(Matched AS INT)) matched
    FROM dbo.WebShillaMiuBoardAllocation WHERE ISNULL(isDeleted,0)=0
   GROUP BY OrderYear, GroupKey, UseWeek, Destination ORDER BY OrderYear, GroupKey, UseWeek`);

await q('WebShillaMiuBoardAllocationHistory 존재', `
  SELECT CASE WHEN OBJECT_ID(N'dbo.WebShillaMiuBoardAllocationHistory',N'U') IS NULL THEN N'없음' ELSE N'있음' END hist,
         CASE WHEN COL_LENGTH('dbo.WebShillaMiuBoardAllocation','FinalQty') IS NULL THEN N'없음' ELSE N'있음' END finalQtyCol,
         CASE WHEN COL_LENGTH('dbo.WebShillaMiuBoardAllocation','GroupKey') IS NULL THEN N'없음' ELSE N'있음' END groupKeyCol`);

await q('444/445 생애 실적(주문/분배 존재 여부)', `
  SELECT k.CustKey, c.CustName,
         (SELECT COUNT(*) FROM OrderMaster om WHERE om.CustKey=k.CustKey) orderMasters,
         (SELECT COUNT(*) FROM ShipmentMaster sm WHERE sm.CustKey=k.CustKey) shipMasters
    FROM (VALUES (444),(445),(446)) k(CustKey) JOIN Customer c ON c.CustKey=k.CustKey`);

await q('OrderCode 별 그룹 후보(CLS/CLR/CLC/CL11)', `
  SELECT CustKey, CustName, OrderCode, CustArea, Descr, ISNULL(isDeleted,0) isDeleted
    FROM Customer WHERE OrderCode IN (N'CLS',N'CLR',N'CLC',N'CL11',N'CL12') ORDER BY OrderCode, CustKey`);

await pool.close();
console.log('\n[done] read-only. 운영 원장 쓰기 0건.');
