#!/usr/bin/env node
/** ShipmentDate.ShipmentQuantity=0 인데 출고>0 — exe 엑셀/출력 수량 0 처리 */
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
    SELECT c.CustName, sd.SdetailKey, p.ProdName, sd.OutQuantity,
           sdt.ShipmentQuantity, sdt.Amount, sdt.Vat,
           CONVERT(NVARCHAR(19), sdt.ShipmentDtm, 120) AS ShipDtm
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      JOIN Product p ON p.ProdKey = sd.ProdKey
      JOIN ShipmentDate sdt ON sdt.SdetailKey = sd.SdetailKey
     WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0
       AND ISNULL(sd.OutQuantity, 0) > 0
       AND ISNULL(sdt.ShipmentQuantity, 0) = 0
     ORDER BY c.CustName, sd.SdetailKey`);

  console.log(`=== ${WEEK} ShipmentDate qty=0 with OutQty>0: ${r.recordset.length} ===`);
  r.recordset.slice(0, 30).forEach((x) => console.log(JSON.stringify(x)));
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
