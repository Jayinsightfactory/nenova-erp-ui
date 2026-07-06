#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const kst = d => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-';
const utc = d => d ? new Date(d).toISOString() : '-';
const SDK = parseInt(process.argv[2] || '79257', 10);
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

console.log(`### SdetailKey=${SDK}\n`);

// 현재 Detail 상태
const d = await pool.request().input('k', sql.Int, SDK).query(`
  SELECT sd.SdetailKey, c.CustName, sm.OrderWeek, p.ProdName,
         sd.OutQuantity, sd.EstQuantity, sd.BunchQuantity, sd.BoxQuantity, sd.SteamQuantity,
         sd.Cost, sd.Amount, sd.Vat,
         p.BunchOf1Box, p.SteamOf1Bunch, p.SteamOf1Box, p.OutUnit, p.EstUnit
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
    LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
   WHERE sd.SdetailKey=@k`);
console.log('=== 현재 ShipmentDetail ===');
console.log(d.recordset[0]);

// ShipmentDate 현재
const sdt = await pool.request().input('k', sql.Int, SDK).query(`
  SELECT SdateKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat
    FROM ShipmentDate WHERE SdetailKey=@k ORDER BY ShipmentDtm`);
console.log('\n=== 현재 ShipmentDate ===');
for (const r of sdt.recordset) console.log(`Sdate=${r.SdateKey} ${kst(r.ShipmentDtm)} shipQ=${r.ShipmentQuantity} est=${r.EstQuantity} cost=${r.Cost} amt=${r.Amount} vat=${r.Vat}`);

// ShipmentHistory 전체 (시간순)
const sh = await pool.request().input('k', sql.Int, SDK).query(`
  SELECT ChangeDtm, ChangeID, ChangeType, BeforeValue, AfterValue, Descr
    FROM ShipmentHistory WHERE SdetailKey=@k ORDER BY ChangeDtm`);
console.log(`\n=== ShipmentHistory 전체 (${sh.recordset.length}건) ===`);
for (const r of sh.recordset) {
  console.log(`${kst(r.ChangeDtm)} (UTC ${utc(r.ChangeDtm)}) | ${r.ChangeID} | ${r.ChangeType} | ${r.BeforeValue}→${r.AfterValue} | ${(r.Descr||'').replace(/\r?\n/g,' ').slice(0,80)}`);
}

// OrderDetail 연동(같은 거래처/품목/차수) — EstQuantity 740 근원 추적
const od = await pool.request().input('k', sql.Int, SDK).query(`
  SELECT od.OrderDetailKey, od.OutQuantity, od.EstQuantity, od.BunchQuantity, od.BoxQuantity
    FROM OrderDetail od
    JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
    JOIN ShipmentMaster sm ON sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=od.ProdKey
   WHERE sd.SdetailKey=@k AND ISNULL(od.isDeleted,0)=0`);
console.log('\n=== 연동 OrderDetail ===');
for (const r of od.recordset) console.log(r);

// OrderHistory 연동
if (od.recordset[0]) {
  const ohk = od.recordset[0].OrderDetailKey;
  const oh = await pool.request().input('k', sql.Int, ohk).query(`
    SELECT ChangeDtm, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr
      FROM OrderHistory WHERE OrderDetailKey=@k ORDER BY ChangeDtm`);
  console.log(`\n=== 연동 OrderHistory (ODKey=${ohk}, ${oh.recordset.length}건) ===`);
  for (const r of oh.recordset) {
    console.log(`${kst(r.ChangeDtm)} (UTC ${utc(r.ChangeDtm)}) | ${r.ChangeID} | ${r.ChangeType} | ${r.ColumName||''} | ${r.BeforeValue}→${r.AfterValue} | ${(r.Descr||'').replace(/\r?\n/g,' ').slice(0,60)}`);
  }
}

await pool.close();
