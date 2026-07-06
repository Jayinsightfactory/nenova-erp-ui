#!/usr/bin/env node
/** 견적서 좌측 합계(음수) + GetDetail 탈락 — 업체별 요약 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

const WEEKS = process.argv.slice(2);
if (!WEEKS.length) WEEKS.push('25-02');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const wkIn = WEEKS.map((_, i) => `@w${i}`).join(',');
  const req = pool.request();
  WEEKS.forEach((w, i) => req.input(`w${i}`, sql.NVarChar, w));

  const rows = (await req.query(`
    SELECT sm.OrderWeek, c.CustName, sm.ShipmentKey, ISNULL(sm.isFix,0) AS isFix,
           SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 THEN 1 ELSE 0 END) AS outRows,
           SUM(CASE WHEN ISNULL(sd.OutQuantity,0)>0 THEN ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0) ELSE 0 END) AS shipDetailTotal,
           (SELECT SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0))
              FROM ViewShipment vs
              JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
                AND vs.CustKey = vo.CustKey AND vs.ProdKey = vo.ProdKey
              JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
              JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
             WHERE vs.ShipmentKey = sm.ShipmentKey AND ISNULL(vs.OutQuantity,0)>0) AS excelTotal,
           (SELECT COUNT(*)
              FROM ViewShipment vs
              JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
                AND vs.CustKey = vo.CustKey AND vs.ProdKey = vo.ProdKey
              JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
              JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
             WHERE vs.ShipmentKey = sm.ShipmentKey AND ISNULL(vs.OutQuantity,0)>0) AS excelRows,
           (SELECT SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0))
              FROM Estimate e
             WHERE e.ShipmentKey = sm.ShipmentKey) AS estimateExtraTotal
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey = sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.isDeleted = 0 AND sm.OrderWeek IN (${wkIn})
     GROUP BY sm.OrderWeek, c.CustName, sm.ShipmentKey, sm.isFix
     ORDER BY sm.OrderWeek, c.CustName`)).recordset;

  console.log(`weeks=${WEEKS.join(',')} vendors=${rows.length}\n`);
  const needles = ['소재2호', '수연원예', '아이엠', '플라워', '왕자원예', '태림원예', '월드천사', '희경'];
  for (const x of rows) {
    const excelTotal = Number(x.excelTotal || 0);
    const shipTotal = Number(x.shipDetailTotal || 0);
    const extra = Number(x.estimateExtraTotal || 0);
    const net = excelTotal + extra;
    const excelRows = Number(x.excelRows || 0);
    const outRows = Number(x.outRows || 0);
    const flag = excelRows === 0 && outRows > 0 ? 'NO_EXCEL'
      : excelRows < outRows ? 'PARTIAL_EXCEL'
      : net < 0 ? 'NEG_NET'
      : '';
    const hit = needles.some((n) => String(x.CustName).includes(n));
    if (flag || hit) {
      console.log(JSON.stringify({
        week: x.OrderWeek, cust: x.CustName, sk: x.ShipmentKey, isFix: x.isFix,
        outRows, excelRows, shipTotal, excelTotal, estimateExtra: extra, net, flag,
      }));
    }
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
