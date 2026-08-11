/**
 * 잔량분배 게시판 — 신라 그룹 연결/차수 데이터 read-only 진단
 * node scripts/probe-shilla-board-scope.mjs [year] [weekFrom] [weekTo]
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

const year = String(process.argv[2] || '2026');
const from = Number(process.argv[3] || 28);
const to = Number(process.argv[4] || 36);

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

console.log(`[read-only probe] year=${year} weeks=${from}~${to}`);

// 1) Customer 컬럼 구조 (비고/별칭 후보 확인)
await q('Customer 컬럼', `
  SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME='Customer' ORDER BY ORDINAL_POSITION`);

// 2) 신라/라움/초이문/미우 후보 Customer 전부
await q('신라·라움·초이문·미우 Customer 후보', `
  SELECT CustKey, CustName, ISNULL(isDeleted,0) isDeleted
    FROM Customer
   WHERE CustName LIKE N'%신라%' OR CustName LIKE N'%라움%' OR CustName LIKE N'%트라움%'
      OR CustName LIKE N'%초이문%' OR CustName LIKE N'%센스앤%' OR CustName LIKE N'%미우%'
      OR CustName LIKE N'%아이엠%'
   ORDER BY CustName, CustKey`);

// 3) 웹 전용 그룹 설정 현황
await q('WebShillaMiuBoardGroup', `
  IF OBJECT_ID(N'dbo.WebShillaMiuBoardGroup',N'U') IS NULL
    SELECT N'없음' note;
  ELSE
    SELECT GroupKey, GroupName, BaseCustKey, BaseCustName, ReceiverCustKey, ReceiverCustName,
           IsActive, DisplayOrder, CreatedBy, CreatedAt
      FROM dbo.WebShillaMiuBoardGroup ORDER BY DisplayOrder, GroupKey`);

// 4) 게시판이 쓰는 최신차수 기본값 (latestScope)
await q('latestScope (게시판 기본 차수)', `
  SELECT TOP 1 CAST(sm.OrderYear AS NVARCHAR(4)) year, LEFT(sm.OrderWeek,2) week
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
   WHERE ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0 AND sm.OrderYear IS NOT NULL
     AND TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) BETWEEN 1 AND 52
   ORDER BY TRY_CONVERT(INT,sm.OrderYear) DESC, TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) DESC`);

// 5) 신라 후보 CustKey 별 주문/분배 (연도·대차수별)
await q(`신라 후보 주문(OrderDetail) ${year} ${from}~${to}차`, `
  SELECT om.CustKey, c.CustName, LEFT(om.OrderWeek,2) wk,
         COUNT(*) rows, SUM(ISNULL(od.OutQuantity,0)) outQty
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
    JOIN Customer c ON c.CustKey=om.CustKey
   WHERE om.OrderYear=N'${year}' AND ISNULL(om.isDeleted,0)=0
     AND TRY_CONVERT(INT,LEFT(om.OrderWeek,2)) BETWEEN ${from} AND ${to}
     AND (c.CustName LIKE N'%신라%')
   GROUP BY om.CustKey, c.CustName, LEFT(om.OrderWeek,2)
   ORDER BY wk, om.CustKey`);

await q(`신라 후보 분배(ShipmentDetail) ${year} ${from}~${to}차`, `
  SELECT sm.CustKey, c.CustName, LEFT(sm.OrderWeek,2) wk,
         COUNT(*) rows, SUM(ISNULL(sd.OutQuantity,0)) outQty
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
   WHERE sm.OrderYear=N'${year}' AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
     AND TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) BETWEEN ${from} AND ${to}
     AND (c.CustName LIKE N'%신라%')
   GROUP BY sm.CustKey, c.CustName, LEFT(sm.OrderWeek,2)
   ORDER BY wk, sm.CustKey`);

// 6) 그룹에 등록된 기준업체(전체)의 차수별 주문/분배 — 32/33 비교
await q(`등록 그룹 기준업체 차수별 주문·분배 ${year} ${from}~${to}차`, `
  IF OBJECT_ID(N'dbo.WebShillaMiuBoardGroup',N'U') IS NULL
    SELECT N'그룹 테이블 없음' note;
  ELSE
  SELECT g.GroupName, g.BaseCustKey, g.IsActive, w.wk,
         ISNULL(o.outQty,0) orderQty, ISNULL(s.outQty,0) shipQty
    FROM dbo.WebShillaMiuBoardGroup g
   CROSS JOIN (SELECT RIGHT(N'0'+CAST(n AS NVARCHAR(2)),2) wk FROM (VALUES ${Array.from({ length: to - from + 1 }, (_, i) => `(${from + i})`).join(',')}) v(n)) w
    OUTER APPLY (SELECT SUM(ISNULL(od.OutQuantity,0)) outQty
                   FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
                  WHERE om.OrderYear=N'${year}' AND ISNULL(om.isDeleted,0)=0 AND om.CustKey=g.BaseCustKey AND LEFT(om.OrderWeek,2)=w.wk) o
    OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) outQty
                   FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
                  WHERE sm.OrderYear=N'${year}' AND ISNULL(sm.isDeleted,0)=0 AND sm.CustKey=g.BaseCustKey
                    AND ISNULL(sd.OutQuantity,0)>0 AND LEFT(sm.OrderWeek,2)=w.wk) s
   ORDER BY g.DisplayOrder, g.GroupKey, w.wk`);

// 7) 33차 전체 업체 상위 — 실제로 어떤 업체가 33차에 물량이 있는지
await q(`${year} 33차 분배 상위 업체`, `
  SELECT TOP 25 sm.CustKey, c.CustName, SUM(ISNULL(sd.OutQuantity,0)) outQty
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
   WHERE sm.OrderYear=N'${year}' AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
     AND LEFT(sm.OrderWeek,2)=N'33'
   GROUP BY sm.CustKey, c.CustName ORDER BY outQty DESC`);

// 8) 2025 동일차수 혼입 확인
await q(`2025 32·33차 신라 후보`, `
  SELECT sm.CustKey, c.CustName, LEFT(sm.OrderWeek,2) wk, SUM(ISNULL(sd.OutQuantity,0)) outQty
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
   WHERE sm.OrderYear=N'2025' AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
     AND LEFT(sm.OrderWeek,2) IN (N'32',N'33') AND c.CustName LIKE N'%신라%'
   GROUP BY sm.CustKey, c.CustName, LEFT(sm.OrderWeek,2)`);

// 9) 신라 후보의 연중 활동 범위 (마지막 차수)
await q(`신라 후보 연도별 마지막 분배 차수`, `
  SELECT c.CustKey, c.CustName, sm.OrderYear, MAX(TRY_CONVERT(INT,LEFT(sm.OrderWeek,2))) lastWeek,
         COUNT(DISTINCT LEFT(sm.OrderWeek,2)) weekCount, SUM(ISNULL(sd.OutQuantity,0)) outQty
    FROM Customer c
    JOIN ShipmentMaster sm ON sm.CustKey=c.CustKey AND ISNULL(sm.isDeleted,0)=0
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)>0
   WHERE c.CustName LIKE N'%신라%'
   GROUP BY c.CustKey, c.CustName, sm.OrderYear ORDER BY c.CustKey, sm.OrderYear`);

await pool.close();
console.log('\n[done] read-only. 운영 원장 쓰기 0건.');
