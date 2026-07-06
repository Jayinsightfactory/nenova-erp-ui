#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEK = process.argv[2] || '25-01';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const rows = (await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT c.CustName, sm.ShipmentKey,
      (SELECT SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)) FROM ViewShipment vs
         JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2 AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
         JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
        WHERE vs.ShipmentKey=sm.ShipmentKey AND ISNULL(vs.OutQuantity,0)>0) AS shipAmt,
      (SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0)) FROM Estimate e WHERE e.ShipmentKey=sm.ShipmentKey) AS estAmt
    FROM ShipmentMaster sm JOIN Customer c ON c.CustKey=sm.CustKey
    WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 ORDER BY c.CustName`)).recordset;

  console.log(`=== ${WEEK} all vendor nets ===`);
  for (const x of rows) {
    const net = Number(x.shipAmt || 0) + Number(x.estAmt || 0);
    if (net !== 0) console.log(`${x.CustName}\t${net}`);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
