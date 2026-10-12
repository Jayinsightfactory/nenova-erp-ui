#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 60000 },
  });
  const q = async (title, text) => {
    const r = await pool.request().query(text);
    console.log(`\n===== ${title} =====`);
    console.log(JSON.stringify(r.recordset, null, 2));
  };

  await q('남은 live 음수', `
    SELECT p.ProdKey, p.ProdName, p.CountryFlower, CAST(p.Stock AS decimal(18,2)) live
      FROM Product p
     WHERE ISNULL(p.isDeleted,0)=0 AND p.Stock < 0
     ORDER BY p.CountryFlower, p.Stock
  `);

  await q('34-01 대상 카테고리 확정잔여', `
    SELECT p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01'
       AND p.CountryFlower IN (N'콜롬비아장미',N'콜롬비아수국',N'중국장미',N'중국기타',N'베트남호접난 Orchid',N'네덜란드')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower, ISNULL(sd.isFix,0)
  `);

  await q('33-02/34-01 장미 확정상태', `
    SELECT sm.OrderWeek, ISNULL(sd.isFix,0) isFix, COUNT(*) rows, CAST(SUM(sd.OutQuantity) AS decimal(18,2)) qty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-01','33-02','34-01')
       AND p.CountryFlower=N'콜롬비아장미' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY sm.OrderWeek, ISNULL(sd.isFix,0)
     ORDER BY sm.OrderWeek, isFix
  `);

  await q('ProductStock 음수 33-01~34-02', `
    SELECT sm.OrderWeek, COUNT(*) negRows, CAST(SUM(ps.Stock) AS decimal(18,2)) negSum
      FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-01','33-02','34-01','34-02')
       AND ISNULL(ps.Stock,0) < -0.001
     GROUP BY sm.OrderWeek
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
