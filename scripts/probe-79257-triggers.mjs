#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});

// 관련 테이블 트리거
const tg = await pool.request().query(`
  SELECT t.name AS trigger_name, OBJECT_NAME(t.parent_id) AS table_name, t.is_disabled,
         m.definition
    FROM sys.triggers t
    JOIN sys.sql_modules m ON m.object_id = t.object_id
   WHERE OBJECT_NAME(t.parent_id) IN ('ShipmentDetail','ShipmentDate','ShipmentHistory')`);
console.log(`=== 트리거 (${tg.recordset.length}건) ===`);
for (const r of tg.recordset) {
  console.log(`\n[${r.table_name}] ${r.trigger_name} disabled=${r.is_disabled}`);
  console.log(String(r.definition || '').slice(0, 1500));
}

// 금액 재계산 산식 확인: 740*2000/1.1
console.log('\n=== 산식 확인 ===');
console.log('740*2000/1.1 =', Math.round(740*2000/1.1));
console.log(' 74*2000/1.1 =', Math.round(74*2000/1.1));

await pool.close();
