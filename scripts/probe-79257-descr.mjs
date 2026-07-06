#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const SDK = parseInt(process.argv[2] || '79257', 10);
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});
const kst = d => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-';

const r = await pool.request().input('k', sql.Int, SDK).query(`
  SELECT sd.Descr, sd.EstQuantity, sd.BunchQuantity, sd.Amount, sd.Vat
    FROM ShipmentDetail sd WHERE sd.SdetailKey=@k`);
console.log('=== ShipmentDetail.Descr (트리거 append 로그 포함) ===');
console.log(r.recordset[0].Descr || '(없음)');
console.log('\n현재 Est/Bunch/Amount/Vat:', r.recordset[0].EstQuantity, r.recordset[0].BunchQuantity, r.recordset[0].Amount, r.recordset[0].Vat);

// ShipmentDate.Descr 도
const dt = await pool.request().input('k', sql.Int, SDK).query(`
  SELECT SdateKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Amount, Vat, Descr
    FROM ShipmentDate WHERE SdetailKey=@k ORDER BY ShipmentDtm`);
console.log('\n=== ShipmentDate 상세 ===');
for (const d of dt.recordset) {
  console.log(`Sdate=${d.SdateKey} ${kst(d.ShipmentDtm)} shipQ=${d.ShipmentQuantity} est=${d.EstQuantity} amt=${d.Amount} vat=${d.Vat}`);
  if (d.Descr) console.log('  Descr:', String(d.Descr).replace(/\r?\n/g, ' | '));
}
await pool.close();
