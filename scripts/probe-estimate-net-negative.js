#!/usr/bin/env node
/** 업체별 순합계 — 음수(차감>출고) 전수 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEKS = process.argv.slice(2).length ? process.argv.slice(2) : ['25-01', '25-02'];

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  for (const WEEK of WEEKS) {
    const rows = (await pool.request().input('wk', sql.NVarChar, WEEK).query(`
      SELECT c.CustName, sm.ShipmentKey,
        (SELECT SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)) FROM ViewShipment vs
           JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2 AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
          WHERE vs.ShipmentKey=sm.ShipmentKey AND ISNULL(vs.OutQuantity,0)>0) AS shipAmt,
        (SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0)) FROM Estimate e WHERE e.ShipmentKey=sm.ShipmentKey) AS estAmt
      FROM ShipmentMaster sm JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE sm.OrderWeek=@wk AND sm.isDeleted=0`)).recordset;

    console.log(`\n=== ${WEEK} negative net vendors ===`);
    for (const x of rows) {
      const net = Number(x.shipAmt || 0) + Number(x.estAmt || 0);
      if (net < 0) console.log(JSON.stringify({ cust: x.CustName, sk: x.ShipmentKey, ship: x.shipAmt, est: x.estAmt, net }));
    }
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
