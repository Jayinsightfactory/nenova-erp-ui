#!/usr/bin/env node
/**
 * nenova.exe FormEstimateView GetDetail/GetExcelDetail 노출 진단
 * Usage: node scripts/probe-estimate-excel-visibility.js 25-02 [custNamePart]
 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEK = process.argv[2] || '25-02';
const CUST_Q = process.argv[3] || '';

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const custWhere = CUST_Q ? `AND c.CustName LIKE @q` : '';
  const req = pool.request().input('wk', sql.NVarChar, WEEK);
  if (CUST_Q) req.input('q', sql.NVarChar, `%${CUST_Q}%`);

  const masters = await req.query(`
    SELECT sm.ShipmentKey, sm.CustKey, c.CustName, ISNULL(sm.isFix, 0) AS isFix,
           SUM(CASE WHEN ISNULL(sd.OutQuantity, 0) > 0 THEN 1 ELSE 0 END) AS outRows,
           SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS detailTotal
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0
       ${custWhere}
     GROUP BY sm.ShipmentKey, sm.CustKey, c.CustName, sm.isFix
     ORDER BY c.CustName`);

  console.log(`=== ${WEEK} estimate excel visibility (${masters.recordset.length} vendors) ===\n`);

  const problems = [];
  for (const m of masters.recordset) {
    const gd = await pool.request().input('sk', sql.Int, m.ShipmentKey).query(`
      SELECT COUNT(*) AS getDetailRows,
             SUM(ISNULL(sdd.Amount, 0) + ISNULL(sdd.Vat, 0)) AS excelAmountTotal
        FROM ViewShipment vs
        JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
          AND vs.CustKey = vo.CustKey AND vs.ProdKey = vo.ProdKey
        JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
        JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
       WHERE vs.ShipmentKey = @sk AND ISNULL(vs.OutQuantity, 0) > 0`);

    const hidden = await pool.request().input('sk', sql.Int, m.ShipmentKey).query(`
      SELECT TOP 5 sd.SdetailKey, p.ProdName, sd.OutQuantity,
             sd.Amount + ISNULL(sd.Vat, 0) AS detailAmt,
             (SELECT COUNT(*) FROM ShipmentDate sdt WHERE sdt.SdetailKey = sd.SdetailKey) AS shipDateCnt,
             (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON sdt.ShipmentDtm = pd.BaseYmd WHERE sdt.SdetailKey = sd.SdetailKey) AS periodCnt,
             (SELECT COUNT(*) FROM ViewShipment vs WHERE vs.SdetailKey = sd.SdetailKey) AS inVS,
             (SELECT COUNT(*) FROM ViewOrder vo JOIN ViewShipment vs ON vs.OrderYearWeek2 = vo.OrderYearWeek2 AND vs.CustKey = vo.CustKey AND vs.ProdKey = vo.ProdKey WHERE vs.SdetailKey = sd.SdetailKey) AS inVO
        FROM ShipmentDetail sd
        JOIN Product p ON p.ProdKey = sd.ProdKey
       WHERE sd.ShipmentKey = @sk AND ISNULL(sd.OutQuantity, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM ViewShipment vs
             JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
          AND vs.CustKey = vo.CustKey AND vs.ProdKey = vo.ProdKey
             JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
             JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
            WHERE vs.SdetailKey = sd.SdetailKey)`);

    const getDetailRows = Number(gd.recordset[0]?.getDetailRows || 0);
    const excelAmt = Number(gd.recordset[0]?.excelAmountTotal || 0);
    const hiddenCnt = hidden.recordset.length;

    const line = {
      cust: m.CustName,
      shipmentKey: m.ShipmentKey,
      isFix: m.isFix,
      outRows: m.outRows,
      detailTotal: m.detailTotal,
      getDetailRows,
      excelAmountTotal: excelAmt,
      excelEmpty: getDetailRows === 0,
      hiddenSample: hiddenCnt,
    };
    if (getDetailRows === 0 || hiddenCnt > 0 || Number(m.outRows) > getDetailRows) {
      line.hidden = hidden.recordset;
      problems.push(line);
    }
  }

  console.log(`Problems: ${problems.length}`);
  problems.forEach((line) => {
    console.log(JSON.stringify(line, null, 2));
    console.log('---');
  });

  if (!problems.length) {
    console.log('(All vendors have full GetDetail coverage for outQty>0 rows)');
  }

  const neg = await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT c.CustName, sm.ShipmentKey,
           SUM(ISNULL(sdd.Amount, 0) + ISNULL(sdd.Vat, 0)) AS excelTotal
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ViewShipment vs ON vs.ShipmentKey = sm.ShipmentKey
      JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
      JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
      JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
     WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0
     GROUP BY c.CustName, sm.ShipmentKey
    HAVING SUM(ISNULL(sdd.Amount, 0) + ISNULL(sdd.Vat, 0)) < 0
     ORDER BY excelTotal`);

  console.log(`\n=== Negative excel totals: ${neg.recordset.length} ===`);
  neg.recordset.forEach((r) => console.log(JSON.stringify(r)));

  const negDetail = await pool.request().input('wk', sql.NVarChar, WEEK).query(`
    SELECT c.CustName, sm.ShipmentKey,
           SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS detailTotal,
           SUM(CASE WHEN ISNULL(sd.OutQuantity, 0) > 0 THEN 1 ELSE 0 END) AS outRows
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0
     GROUP BY c.CustName, sm.ShipmentKey
    HAVING SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) < 0
     ORDER BY detailTotal`);
  console.log(`\n=== Negative ShipmentDetail totals: ${negDetail.recordset.length} ===`);
  negDetail.recordset.forEach((r) => console.log(JSON.stringify(r)));

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
