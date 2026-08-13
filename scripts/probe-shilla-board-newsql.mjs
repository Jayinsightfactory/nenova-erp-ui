/**
 * 잔량분배 게시판 — 새로 추가한 조회 SQL 3종의 read-only 실행 검증
 * (latestScope 그룹 한정 / baseActivity / 업체검색 실적표시)
 * node scripts/probe-shilla-board-newsql.mjs
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

const run = async (label, text, params = {}) => {
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) req.input(k, v.type, v.value);
  const started = Date.now();
  const r = await req.query(text);
  console.log(`\n=== ${label} (${Date.now() - started}ms) ===`);
  console.table(r.recordset);
  return r.recordset;
};

// 게시판 활성 그룹의 기준+수령 CustKey (현재 운영 값 + 복구 후 예상 값 둘 다)
for (const [label, keys] of [
  ['복구 전(444,456,680,683)', [444, 456, 680, 683]],
  ['복구 후(446,456,680,683)', [446, 456, 680, 683]],
]) {
  const clause = keys.map((_, i) => `@c${i}`).join(',');
  const params = Object.fromEntries(
    keys.map((k, i) => [`c${i}`, { type: sql.Int, value: k }]),
  );
  await run(
    `latestScope 그룹 한정 — ${label}`,
    `SELECT TOP 1 CAST(sm.OrderYear AS NVARCHAR(4)) year,LEFT(sm.OrderWeek,2) week FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey WHERE ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0 AND sm.OrderYear IS NOT NULL AND TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) BETWEEN 1 AND 52 AND sm.CustKey IN (${clause}) ORDER BY TRY_CONVERT(INT,sm.OrderYear) DESC,TRY_CONVERT(INT,LEFT(sm.OrderWeek,2)) DESC`,
    params,
  );
  await run(
    `baseActivity 2026 — ${label}`,
    `SELECT k.custKey,ISNULL(o.qty,0) orderQty,ISNULL(s.qty,0) shipQty,o.lastWeek lastOrderWeek,s.lastWeek lastShipWeek
       FROM (VALUES ${keys.map((_, i) => `(@c${i})`).join(',')}) k(custKey)
      OUTER APPLY (SELECT SUM(ISNULL(od.OutQuantity,0)) qty,MAX(LEFT(om.OrderWeek,2)) lastWeek
                     FROM OrderMaster om
                     JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
                    WHERE om.OrderYear=@yr AND ISNULL(om.isDeleted,0)=0 AND om.CustKey=k.custKey) o
      OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) qty,MAX(LEFT(sm.OrderWeek,2)) lastWeek
                     FROM ShipmentMaster sm
                     JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
                    WHERE sm.OrderYear=@yr AND ISNULL(sm.isDeleted,0)=0 AND sm.CustKey=k.custKey
                      AND ISNULL(sd.OutQuantity,0)>0) s`,
    { ...params, yr: { type: sql.NVarChar, value: '2026' } },
  );
}

await run(
  '업체검색 mode=customers (%신라%)',
  `SELECT TOP 50 c.CustKey custKey,c.CustName custName,c.OrderCode orderCode,c.Descr descr,
          o.OrderYear lastOrderYear,LEFT(o.OrderWeek,2) lastOrderWeek,
          s.OrderYear lastShipYear,LEFT(s.OrderWeek,2) lastShipWeek
     FROM Customer c
    OUTER APPLY (SELECT TOP 1 om.OrderYear,om.OrderWeek FROM OrderMaster om
                  WHERE om.CustKey=c.CustKey AND ISNULL(om.isDeleted,0)=0
                  ORDER BY TRY_CONVERT(INT,om.OrderYear) DESC,om.OrderWeek DESC) o
    OUTER APPLY (SELECT TOP 1 sm.OrderYear,sm.OrderWeek FROM ShipmentMaster sm
                  WHERE sm.CustKey=c.CustKey AND ISNULL(sm.isDeleted,0)=0
                  ORDER BY TRY_CONVERT(INT,sm.OrderYear) DESC,sm.OrderWeek DESC) s
    WHERE ISNULL(c.isDeleted,0)=0 AND c.CustName LIKE @q ORDER BY c.CustName`,
  { q: { type: sql.NVarChar, value: '%신라%' } },
);

await pool.close();
console.log('\n[done] read-only. 운영 원장 쓰기 0건.');
