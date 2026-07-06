#!/usr/bin/env node
/** (EstQuantity-OutQuantity)*Cost 합 — exe 좌측 음수 금액 후보 */
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
           SUM((ISNULL(sd.EstQuantity,0)-ISNULL(sd.OutQuantity,0)) * ISNULL(NULLIF(sd.Cost,0), ISNULL(p.Cost,0))) AS estOutDiffAmt,
           SUM(ISNULL(sd.EstQuantity,0)-ISNULL(sd.OutQuantity,0)) AS estOutDiffQty
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey=sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY c.CustName
     ORDER BY c.CustName`);

  console.log(`=== ${WEEK} Est-Out diff amount ===\n`);
  for (const x of r.recordset) {
    const amt = Math.round(Number(x.estOutDiffAmt || 0));
    if (amt !== 0) console.log(`${x.CustName}\t${amt}\tqtyDiff=${x.estOutDiffQty}`);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
