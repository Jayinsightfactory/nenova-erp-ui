#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const r = await pool.request().query(`
    SELECT p.FlowerName, COUNT(*) cnt,
           SUM(CASE WHEN ISNULL(ps.Stock,0)>0 THEN 1 ELSE 0 END) posPs
      FROM Product p
      OUTER APPLY (
        SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek='20262602'
      ) ps(Stock)
     WHERE ISNULL(p.isDeleted,0)=0 AND (p.CounName LIKE N'%중국%' OR p.CountryFlower LIKE N'%중국%')
     GROUP BY p.FlowerName ORDER BY cnt DESC`);
  console.log('=== 중국 꽃명 분포 (26-02) ===');
  for (const row of r.recordset) console.log(`${row.FlowerName || '(null)'}: ${row.cnt}품목 ps>0=${row.posPs}`);
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
