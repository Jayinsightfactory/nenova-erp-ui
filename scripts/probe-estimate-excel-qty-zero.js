#!/usr/bin/env node
/** 전 차수 — GetExcelDetail 수량>0 행 0건 업체 (exe 엑셀 불가 후보) */
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
      SELECT c.CustName, sm.ShipmentKey, ISNULL(sm.isFix,0) AS isFix,
        (SELECT COUNT(*) FROM ShipmentDetail sd WHERE sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)>0) AS outRows,
        (SELECT COUNT(*) FROM ViewShipment vs
           JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2 AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey
           JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
          WHERE vs.ShipmentKey=sm.ShipmentKey AND ISNULL(vs.OutQuantity,0)>0) AS excelJoinRows,
        (SELECT COUNT(*) FROM ViewShipment vs
           JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2 AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey
           JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
          WHERE vs.ShipmentKey=sm.ShipmentKey AND ISNULL(vs.OutQuantity,0)>0 AND ISNULL(sdd.ShipmentQuantity,0)>0) AS excelQtyRows
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey=sm.CustKey
      WHERE sm.OrderWeek=@wk AND sm.isDeleted=0
      ORDER BY c.CustName`)).recordset;

    console.log(`\n=== ${WEEK} ===`);
    for (const x of rows) {
      const out = Number(x.outRows || 0);
      const join = Number(x.excelJoinRows || 0);
      const qty = Number(x.excelQtyRows || 0);
      if (out > 0 && (join < out || qty === 0)) {
        console.log(JSON.stringify({
          cust: x.CustName, sk: x.ShipmentKey, isFix: x.isFix, outRows: out, excelJoinRows: join, excelQtyRows: qty,
        }));
      }
    }
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
