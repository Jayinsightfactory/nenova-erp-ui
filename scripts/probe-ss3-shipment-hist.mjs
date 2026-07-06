#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const kst = (d) => (d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-');
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

// 28-01 대상 거래처 CustKey (SS3 주문건 마스터의 CustKey)
const custs = await pool.request().query(`
  SELECT DISTINCT om.CustKey
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey=od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
   WHERE om.OrderWeek='28-01' AND oh.ChangeID='nenovaSS3' AND CAST(oh.ChangeDtm AS DATE)='2026-07-02'`);
const ckList = custs.recordset.map(r => r.CustKey).join(',');

// ShipmentHistory: 해당 거래처 28-01 SdetailKey들의 7/2~7/3 이력
const sh = await pool.request().query(`
  SELECT sh.SdetailKey, sh.ChangeID, sh.ChangeType, sh.BeforeValue, sh.AfterValue, sh.ChangeDtm,
         c.CustName, p.ProdName, sd.OutQuantity AS curOut
    FROM ShipmentHistory sh
    JOIN ShipmentDetail sd ON sh.SdetailKey=sd.SdetailKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON sm.CustKey=c.CustKey
    LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
   WHERE sm.OrderWeek='28-01' AND sm.CustKey IN (${ckList})
     AND sh.ChangeDtm >= '2026-07-02 17:00:00' AND sh.ChangeDtm < '2026-07-03 12:00:00'
   ORDER BY sh.ChangeDtm`);
console.log(`=== 28-01 ShipmentHistory 7/2 17:00 ~ 7/3 12:00 UTC (${sh.recordset.length}건) ===`);
const byId = {};
for (const r of sh.recordset) {
  byId[r.ChangeID] = (byId[r.ChangeID] || 0) + 1;
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${(r.CustName||'').slice(0,14)} | ${(r.ProdName||'').slice(0,24)} | ${r.BeforeValue}→${r.AfterValue} | cur=${r.curOut}`);
}
console.log('ChangeID별:', byId);

await pool.close();
