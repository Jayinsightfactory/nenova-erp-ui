#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const kst = (d) => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-';

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

// 7/3 02:30~02:45 KST = 7/2 17:30~17:45 UTC
const oh = await pool.request().query(`
  SELECT oh.ChangeDtm, oh.ChangeID, oh.ChangeType, c.CustName, p.ProdName, oh.BeforeValue, oh.AfterValue, oh.Descr
    FROM OrderHistory oh
    JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN Customer c ON om.CustKey = c.CustKey
    LEFT JOIN Product p ON od.ProdKey = p.ProdKey
   WHERE om.OrderWeek = '28-01'
     AND oh.ChangeDtm >= '2026-07-02 17:30:00'
     AND oh.ChangeDtm <= '2026-07-02 17:45:00'
   ORDER BY oh.ChangeDtm`);

console.log(`=== 28-01 OrderHistory 7/3 02:30~02:45 KST (${oh.recordset.length}건) ===`);
const byUser = {};
for (const r of oh.recordset) {
  byUser[r.ChangeID] = (byUser[r.ChangeID] || 0) + 1;
  console.log(`${kst(r.ChangeDtm)} | ${r.ChangeID} | ${r.ChangeType} | ${r.CustName} | ${(r.ProdName||'').slice(0,28)} | ${r.BeforeValue}→${r.AfterValue}`);
}
console.log('ChangeID별:', byUser);

// OrderDetail Descr for paste marker
const descr = await pool.request().query(`
  SELECT TOP 20 od.Descr, c.CustName, om.CreateDtm, om.CreateID
    FROM OrderDetail od
    JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
    JOIN Customer c ON om.CustKey = c.CustKey
   WHERE om.OrderWeek = '28-01' AND om.CreateDtm >= '2026-07-02'
     AND (od.Descr LIKE N'%붙여%' OR od.Descr LIKE N'%paste%' OR od.Descr LIKE N'%주문등록%')
   ORDER BY om.CreateDtm DESC`);
console.log('\n=== paste/주문등록 Descr ===');
for (const r of descr.recordset) console.log(kst(r.CreateDtm), r.CreateID, r.CustName, r.Descr);

await pool.close();
