// 읽기 전용: OutUnit=박스 품목 중 단→박스 10/15배 의심 행 (ShipmentDetail + OrderDetail)
// node scripts/probe-unit-mismatch.js [24-01]
const fs = require('fs');
const path = require('path');

const WEEK = process.argv[2] || '24-01';

const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
}

(async () => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    console.error('DB 자격증명 없음 (.env.local).');
    process.exit(2);
  }
  const sql = require('mssql');
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  console.log(`# ${WEEK} — 단→박스 저장 의심 (읽기 전용)\n`);

  const r = await pool.request()
    .input('week', sql.NVarChar, WEEK)
    .query(`
    SELECT c.CustName, p.ProdName, p.OutUnit, ISNULL(p.BunchOf1Box,0) AS B1B,
           ISNULL(od.BoxQuantity, od.OutQuantity) AS orderBox,
           sd.OutQuantity AS shipOut, sd.BoxQuantity AS shipBox, sd.BunchQuantity AS shipBunch
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
      JOIN Customer c ON sm.CustKey = c.CustKey
      JOIN Product p ON sd.ProdKey = p.ProdKey
      LEFT JOIN OrderMaster om ON om.CustKey = sm.CustKey AND om.OrderWeek = sm.OrderWeek AND om.isDeleted = 0
      LEFT JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND od.ProdKey = sd.ProdKey AND od.isDeleted = 0
     WHERE sm.OrderWeek = @week AND sd.OutQuantity > 0
       AND p.OutUnit = N'박스' AND ISNULL(p.BunchOf1Box,0) > 1
       AND ABS(sd.BunchQuantity - sd.OutQuantity * p.BunchOf1Box) < 0.01
    ORDER BY c.CustName, p.ProdName`);

  let suspect = 0;
  for (const row of r.recordset) {
    const b1b = Number(row.B1B);
    const orderBox = Number(row.orderBox) || 0;
    const shipOut = Number(row.shipOut);
    if (orderBox <= 0) continue;
    const ratio = shipOut / orderBox;
    if (ratio < b1b * 0.85 || ratio > b1b * 1.15) continue;
    suspect += 1;
    console.log(
      `${row.CustName} | ${(row.ProdName || '').slice(0, 30)} | 주문${orderBox}박스 출고${shipOut} | ` +
      `비율≈${Math.round(ratio)} (B1B=${b1b}) ⚠ 단→박스 의심`
    );
  }
  console.log(`\n총 ${suspect}건 의심 (주문 대비 출고가 BunchOf1Box배)`);
  await pool.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
