#!/usr/bin/env node
/** 업체별 주문-출고 차이(박스/수량) — exe 좌측 음수 컬럼 후보 */
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const WEEK = process.argv[2] || '25-02';
const PW = WEEK.split('-')[0];

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });

  const rows = (await pool.request()
    .input('wk', sql.NVarChar, WEEK)
    .input('pw', sql.NVarChar, PW)
    .query(`
    SELECT c.CustName, sm.CustKey,
      ISNULL(od.orderQty,0) AS orderQty,
      ISNULL(sd.shipQty,0) AS shipQty,
      ISNULL(sd.shipQty,0) - ISNULL(od.orderQty,0) AS diffQty,
      ISNULL(od.orderBox,0) AS orderBox,
      ISNULL(sd.shipBox,0) AS shipBox,
      ISNULL(sd.shipBox,0) - ISNULL(od.orderBox,0) AS diffBox
    FROM ShipmentMaster sm
    JOIN Customer c ON c.CustKey = sm.CustKey
    OUTER APPLY (
      SELECT SUM(CASE WHEN ISNULL(od.BunchQuantity,0)>0 THEN od.BunchQuantity
                      WHEN ISNULL(od.SteamQuantity,0)>0 THEN od.SteamQuantity
                      ELSE od.BoxQuantity END) AS orderQty,
             SUM(ISNULL(od.BoxQuantity,0)) AS orderBox
        FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
       WHERE om.CustKey=sm.CustKey AND om.OrderWeek=@wk AND om.isDeleted=0
    ) od
    OUTER APPLY (
      SELECT SUM(CASE WHEN ISNULL(sd.BunchQuantity,0)>0 THEN sd.BunchQuantity
                      WHEN ISNULL(sd.SteamQuantity,0)>0 THEN sd.SteamQuantity
                      ELSE sd.OutQuantity END) AS shipQty,
             SUM(ISNULL(sd.BoxQuantity,0)) AS shipBox
        FROM ShipmentDetail sd
       WHERE sd.ShipmentKey=sm.ShipmentKey AND ISNULL(sd.OutQuantity,0)>0
    ) sd
    WHERE sm.OrderWeek=@wk AND sm.isDeleted=0
    ORDER BY c.CustName`)).recordset;

  console.log(`=== ${WEEK} order vs ship diff ===\n`);
  for (const x of rows) {
    if (Number(x.diffQty) !== 0 || Number(x.diffBox) !== 0) {
      console.log(`${x.CustName}\tdiffQty=${x.diffQty}\tdiffBox=${x.diffBox}\torder=${x.orderQty}\tship=${x.shipQty}`);
    }
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
