#!/usr/bin/env node
/** ShipmentDate 금액 0 / 누락 — exe GetExcelDetail 빈 내용 후보 */
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
    SELECT c.CustName, sd.SdetailKey, p.ProdName,
           sd.Amount AS dAmt, sd.Vat AS dVat,
           sdt.Amount AS sAmt, sdt.Vat AS sVat,
           sdt.ShipmentQuantity, sd.OutQuantity
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      JOIN Product p ON p.ProdKey = sd.ProdKey
      LEFT JOIN ShipmentDate sdt ON sdt.SdetailKey = sd.SdetailKey
     WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0
       AND ISNULL(sd.OutQuantity, 0) > 0
       AND (
         sdt.SdetailKey IS NULL
         OR (ISNULL(sdt.Amount,0)+ISNULL(sdt.Vat,0)=0 AND ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)<>0)
         OR ISNULL(sdt.ShipmentQuantity,0)=0
       )
     ORDER BY c.CustName`);

  console.log(`=== ${WEEK} ShipmentDate amount/qty issues: ${r.recordset.length} ===`);
  r.recordset.slice(0, 40).forEach((x) => console.log(JSON.stringify(x)));
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
