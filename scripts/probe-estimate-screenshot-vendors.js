#!/usr/bin/env node
/** 스크린샷 업체 — GetDetail 탈락 원인 일괄 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEK = process.argv[2] || '25-02';
const NEEDLES = ['소재2호', '수연원예', '아이엠', '플라워', '왕자원예', '태림원예', '월드천사', '희경', '시흥'];

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });

  const r = await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT c.CustName, sd.SdetailKey, p.ProdName, sd.OutQuantity, sd.CustKey AS DetailCustKey, sm.CustKey AS MasterCustKey,
           (SELECT COUNT(*) FROM ViewShipment vs WHERE vs.SdetailKey=sd.SdetailKey) AS inVS,
           (SELECT COUNT(*) FROM ViewOrder vo WHERE vo.CustKey=sm.CustKey AND vo.ProdKey=sd.ProdKey AND vo.OrderWeek=sm.OrderWeek) AS inVO,
           (SELECT COUNT(*) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS shipDateCnt,
           (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON sdt.ShipmentDtm=pd.BaseYmd WHERE sdt.SdetailKey=sd.SdetailKey) AS periodCnt,
           (SELECT COUNT(*) FROM ViewShipment vs
              JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2 AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
              JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey
              JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
             WHERE vs.SdetailKey=sd.SdetailKey) AS inGetDetail
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      JOIN Product p ON p.ProdKey=sd.ProdKey
      JOIN Customer c ON c.CustKey=sm.CustKey
     WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0
     ORDER BY c.CustName, sd.SdetailKey`);

  const hit = (name) => NEEDLES.some((n) => name.includes(n));
  const byCust = {};
  for (const row of r.recordset) {
    if (!hit(row.CustName)) continue;
    const key = row.CustName;
    if (!byCust[key]) byCust[key] = { total: 0, hidden: 0, samples: [] };
    byCust[key].total++;
    if (Number(row.inGetDetail) === 0) {
      byCust[key].hidden++;
      if (byCust[key].samples.length < 3) {
        byCust[key].samples.push({
          pk: row.SdetailKey, prod: row.ProdName, out: row.OutQuantity,
          detailCustKey: row.DetailCustKey, masterCustKey: row.MasterCustKey,
          inVS: row.inVS, inVO: row.inVO, shipDateCnt: row.shipDateCnt, periodCnt: row.periodCnt,
        });
      }
    }
  }

  console.log(`=== ${WEEK} screenshot vendors GetDetail ===\n`);
  Object.entries(byCust).forEach(([cust, v]) => {
    console.log(JSON.stringify({ cust, outRows: v.total, hidden: v.hidden, samples: v.samples }));
  });
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
