/**
 * 26-01 카네이션 분배검증 — DB vs 엑셀 프로브
 * node scripts/probe-distribute-import-db.mjs [week] [customerNeedle]
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const week = process.argv[2] || '26-01';
const custNeedle = process.argv[3] || '5125';

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const pool = await sql.connect(config);

const cust = await pool.request()
  .input('name', sql.NVarChar, `%${custNeedle}%`)
  .query(`SELECT CustKey, CustName, OrderCode FROM Customer WHERE CustName LIKE @name AND ISNULL(isDeleted,0)=0`);

let customers = cust.recordset;
if (!customers.length) {
  const alt = await pool.request()
    .input('name', sql.NVarChar, `%${custNeedle}%`)
    .query(`SELECT CustKey, CustName, OrderCode FROM Customer
             WHERE (CustName LIKE @name OR OrderCode LIKE @name OR Descr LIKE @name)
               AND ISNULL(isDeleted,0)=0`);
  customers = alt.recordset;
}
if (!customers.length && custNeedle.includes('친구')) {
  const alt2 = await pool.request()
    .query(`SELECT TOP 30 CustKey, CustName, OrderCode FROM Customer
             WHERE CustName LIKE N'%친구%' AND ISNULL(isDeleted,0)=0 ORDER BY CustName`);
  console.log('No direct match; customers with 친구:', alt2.recordset);
}

if (/5125/.test(custNeedle)) {
  const codeSearch = await pool.request()
    .query(`SELECT CustKey, CustName, OrderCode, ISNULL(Descr,'') AS Descr FROM Customer
             WHERE (CustName LIKE N'%5125%' OR OrderCode LIKE '%5125%' OR Descr LIKE N'%5125%')
               AND ISNULL(isDeleted,0)=0`);
  console.log('Customers with 5125 in name/code/descr:', codeSearch.recordset);
}

console.log('Week:', week, 'Customer needle:', custNeedle);
console.log('Customers:', customers);

const prods = await pool.request()
  .query(`SELECT ProdKey, ProdName, DisplayName, OutUnit, CountryFlower
            FROM Product
           WHERE (ProdName LIKE N'%Apple Tea%' OR ProdName LIKE N'%Caroline Gold%'
              OR DisplayName LIKE N'%Apple Tea%' OR DisplayName LIKE N'%Caroline Gold%')
             AND ISNULL(isDeleted,0)=0`);

console.log('Products:', prods.recordset);

const orderSql = `
  SELECT om.OrderMasterKey, om.CustKey, c.CustName, od.ProdKey, p.ProdName,
         CASE WHEN p.OutUnit=N'단' THEN ISNULL(od.BunchQuantity,0)
              WHEN p.OutUnit=N'송이' THEN ISNULL(od.SteamQuantity,0)
              ELSE ISNULL(od.BoxQuantity, ISNULL(od.OutQuantity,0)) END AS orderQty,
         ISNULL(ship.outQty,0) AS currentOutQty
    FROM OrderMaster om
    JOIN Customer c ON c.CustKey=om.CustKey
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
    JOIN Product p ON p.ProdKey=od.ProdKey
    OUTER APPLY (
      SELECT SUM(ISNULL(sd.OutQuantity,0)) AS outQty
        FROM ShipmentMaster sm
        JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       WHERE sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek
         AND sd.ProdKey=od.ProdKey AND ISNULL(sm.isDeleted,0)=0
    ) ship
   WHERE om.OrderWeek=@week AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
     AND (p.ProdName LIKE N'%Apple Tea%' OR p.ProdName LIKE N'%Caroline Gold%'
       OR p.DisplayName LIKE N'%Apple Tea%' OR p.DisplayName LIKE N'%Caroline Gold%')`;

for (const c of customers) {
  const r = await pool.request()
    .input('week', sql.NVarChar, week)
    .input('ck', sql.Int, c.CustKey)
    .query(orderSql);
  console.log(`\n=== ${c.CustName} (key ${c.CustKey}) apple/caroline order lines ===`);
  if (!r.recordset.length) console.log('  (none)');
  for (const row of r.recordset) {
    console.log(`  ${row.ProdName}: orderQty=${row.orderQty} currentOutQty=${row.currentOutQty}`);
  }

  const all = await pool.request()
    .input('week', sql.NVarChar, week)
    .input('ck', sql.Int, c.CustKey)
    .query(`
      SELECT p.ProdName, od.ProdKey,
             CASE WHEN p.OutUnit=N'단' THEN ISNULL(od.BunchQuantity,0)
                  WHEN p.OutUnit=N'송이' THEN ISNULL(od.SteamQuantity,0)
                  ELSE ISNULL(od.BoxQuantity, ISNULL(od.OutQuantity,0)) END AS orderQty,
             ISNULL(ship.outQty,0) AS currentOutQty
        FROM OrderMaster om
        JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
        JOIN Product p ON p.ProdKey=od.ProdKey
        OUTER APPLY (
          SELECT SUM(ISNULL(sd.OutQuantity,0)) AS outQty
            FROM ShipmentMaster sm
            JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
           WHERE sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek
             AND sd.ProdKey=od.ProdKey AND ISNULL(sm.isDeleted,0)=0
        ) ship
       WHERE om.OrderWeek=@week AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
       ORDER BY p.ProdName`);

  const mismatch = all.recordset.filter((x) => Number(x.currentOutQty) > 0 && Number(x.orderQty) === 0);
  const outOnly = all.recordset.filter((x) => Number(x.currentOutQty) > 0);
  console.log(`  Total lines: ${all.recordset.length}, with shipment>0: ${outOnly.length}, order=0 but ship>0: ${mismatch.length}`);
}

await pool.close();

// --- fix scope for carnation 26-01 ---
const yr = '2026';
const weekKey = yr + '2601';
const fixCat = await sql.connect(config).then(async (p) => {
  const r = await p.request()
    .input('weekKey', sql.NVarChar, weekKey)
    .input('yr', sql.NVarChar, yr)
    .query(`
      SELECT ISNULL(NULLIF(LTRIM(RTRIM(p.CountryFlower)), N''), N'') AS CountryFlower,
             SUM(CASE WHEN ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) AS fixedLines,
             SUM(CASE WHEN ISNULL(sd.isFix,0)=0 AND ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS unfixedLines
        FROM ShipmentMaster sm
        JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
       WHERE sm.isDeleted=0
         AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm.OrderWeek, '-', '') = @weekKey
       GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(p.CountryFlower)), N''), N'')
    `);
  const line = await p.request()
    .input('weekKey', sql.NVarChar, weekKey)
    .input('yr', sql.NVarChar, yr)
    .input('ck', sql.Int, 659)
    .query(`
      SELECT p.ProdName, sd.ProdKey, sd.OutQuantity, sd.isFix, sm.isFix AS masterFix
        FROM ShipmentMaster sm
        JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
        JOIN Product p ON p.ProdKey=sd.ProdKey
       WHERE sm.CustKey=@ck AND sm.isDeleted=0
         AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm.OrderWeek, '-', '') = @weekKey
         AND (p.ProdName LIKE N'%Apple Tea%' OR p.ProdName LIKE N'%Caroline Gold%')
    `);
  await p.close();
  return { categories: r.recordset, lines: line.recordset };
});
console.log('\n=== Fix scope 26-01 ===');
console.log('Categories:', fixCat.categories);
console.log('친구플라워 apple/caroline lines:', fixCat.lines);

