#!/usr/bin/env node
/** 미확정 출고 상세 — 카테고리별 진단 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEK = process.argv[2] || '25-02';
const CF = process.argv[3] || null;

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });

  const cfFilter = CF ? `AND p.CountryFlower = @cf` : '';
  const req = pool.request().input('wk', sql.NVarChar, WEEK);
  if (CF) req.input('cf', sql.NVarChar, CF);

  const r = await req.query(`
    SELECT sd.SdetailKey, sd.ShipmentKey, sm.CustKey, c.CustName,
           sd.ProdKey, p.ProdName, p.CountryFlower, p.CounName, p.FlowerName,
           sd.OutQuantity, sd.EstQuantity,
           ISNULL(sm.isFix, 0) AS MasterFix, ISNULL(sd.isFix, 0) AS DetailFix,
           vs.DetailFix AS ViewDetailFix
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      LEFT JOIN Customer c ON c.CustKey = sm.CustKey
      LEFT JOIN ViewShipment vs ON vs.SdetailKey = sd.SdetailKey
     WHERE sm.isDeleted = 0 AND sm.OrderWeek = @wk
       AND ISNULL(sd.OutQuantity, 0) > 0
       AND ISNULL(sd.isFix, 0) = 0
       ${cfFilter}
     ORDER BY p.CountryFlower, sd.SdetailKey`);

  console.log(`=== ${WEEK} unfixed details${CF ? ` (${CF})` : ''}: ${r.recordset.length} ===\n`);
  for (const row of r.recordset) {
    console.log(JSON.stringify(row));
  }

  const mismatch = await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT sd.SdetailKey, p.CountryFlower, p.ProdName,
           ISNULL(sm.isFix,0) AS MasterFix, ISNULL(sd.isFix,0) AS DetailFix
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      JOIN Product p ON p.ProdKey = sd.ProdKey
     WHERE sm.isDeleted = 0 AND sm.OrderWeek = @wk
       AND ISNULL(sd.OutQuantity,0) > 0
       AND ISNULL(sm.isFix,0) <> ISNULL(sd.isFix,0)
     ORDER BY p.CountryFlower`);

  console.log(`\n=== Master/Detail mismatch: ${mismatch.recordset.length} ===`);
  mismatch.recordset.forEach((row) => console.log(JSON.stringify(row)));

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
