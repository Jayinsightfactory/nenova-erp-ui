#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const iso = d => d ? new Date(d).toISOString() : '-';
const kst = d => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '-';
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

const r = await pool.request().query(`
  SELECT sh.ChangeID, COUNT(*) AS cnt, MIN(sh.ChangeDtm) AS fst, MAX(sh.ChangeDtm) AS lst
    FROM ShipmentHistory sh
    JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
    JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
   WHERE sm.OrderWeek = '28-01'
   GROUP BY sh.ChangeID ORDER BY cnt DESC`);
console.log('=== 28-01 ShipmentHistory ChangeID 전체 ===');
for (const x of r.recordset) console.log(`${x.ChangeID} | cnt=${x.cnt} | ${kst(x.fst)} ~ ${kst(x.lst)}`);

// 현재 살아있는 ShipmentDetail(분배) 마스터 생성자 기준
const m = await pool.request().query(`
  SELECT sm.CreateID, COUNT(*) AS masters
    FROM ShipmentMaster sm
   WHERE sm.OrderWeek = '28-01' AND ISNULL(sm.isDeleted,0)=0
   GROUP BY sm.CreateID ORDER BY masters DESC`);
console.log('\n=== 28-01 ShipmentMaster CreateID (현재 살아있는 것) ===');
for (const x of m.recordset) console.log(`${x.CreateID} | masters=${x.masters}`);

await pool.close();
