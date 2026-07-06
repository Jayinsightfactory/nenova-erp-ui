#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEK = process.argv[2] || '25-02';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const r = await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT c.CustName,
           SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)) AS shipTotal,
           SUM(CASE WHEN ISNULL(e.Amount,0)+ISNULL(e.Vat,0) < 0 THEN ISNULL(e.Amount,0)+ISNULL(e.Vat,0) ELSE 0 END) AS negEst,
           SUM(CASE WHEN ISNULL(e.Amount,0)+ISNULL(e.Vat,0) > 0 THEN ISNULL(e.Amount,0)+ISNULL(e.Vat,0) ELSE 0 END) AS posEst
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey=sm.CustKey
      LEFT JOIN Estimate e ON e.ShipmentKey=sm.ShipmentKey
      LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=e.ProdKey
      LEFT JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
     WHERE sm.OrderWeek=@wk AND sm.isDeleted=0
     GROUP BY c.CustName, sm.ShipmentKey
     ORDER BY c.CustName`);

  for (const x of r.recordset) {
    const neg = Number(x.negEst || 0);
    if (neg < 0) console.log(JSON.stringify(x));
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
