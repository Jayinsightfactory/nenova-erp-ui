#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';

fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

const r = await pool.request().input('sk', sql.Int, 79257).query(`
  SELECT ChangeDtm, ChangeID, BeforeValue, AfterValue, Descr
  FROM ShipmentHistory
  WHERE SdetailKey = @sk AND BeforeValue = '75' AND AfterValue = '74'`);

const d = await pool.request().input('sk', sql.Int, 79257).query(`
  SELECT Descr FROM ShipmentDetail WHERE SdetailKey = @sk`);

for (const row of r.recordset) {
  const dt = row.ChangeDtm;
  console.log('=== ShipmentHistory 75→74 ===');
  console.log('ChangeDtm raw JS Date:', dt);
  console.log('UTC (ISO):', dt.toISOString());
  console.log('KST:', dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }));
  console.log('ChangeID:', row.ChangeID);
  console.log('History Descr:', row.Descr);
}

console.log('\n=== ShipmentDetail.Descr ===');
console.log(d.recordset[0]?.Descr || '(empty)');

await pool.close();
