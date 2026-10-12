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
  const r = await pool.request().query(`
    SELECT sm.OrderWeek, p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('34-01','34-02','35-01')
       AND p.CountryFlower IN (N'콜롬비아장미', N'콜롬비아수국', N'중국장미', N'중국기타', N'베트남호접난 Orchid', N'네덜란드', N'콜롬비아루스커스', N'호주', N'에콰도르장미')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY sm.OrderWeek, p.CountryFlower, ISNULL(sd.isFix,0)
     ORDER BY sm.OrderWeek, p.CountryFlower, isFix
  `);
  console.log(JSON.stringify(r.recordset, null, 2));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
