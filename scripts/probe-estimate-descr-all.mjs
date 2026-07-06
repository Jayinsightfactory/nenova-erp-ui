#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const pool = await sql.connect({
  server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

const r = await pool.request().query(`
  SELECT e.EstimateKey, sm.OrderWeek, c.CustName, p.ProdName, e.Descr, e.Quantity,
         CONVERT(NVARCHAR(10), e.EstimateDtm, 120) AS dtm
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
    JOIN Product p ON p.ProdKey=e.ProdKey
   WHERE ISNULL(e.Descr,'') LIKE N'%차감수량%'
      OR ISNULL(e.Descr,'') LIKE N'%차감단가%'`);

console.log('remaining operational Descr:', r.recordset.length);
for (const row of r.recordset) {
  console.log(`ek=${row.EstimateKey} ${row.OrderWeek} qty=${row.Quantity} ${row.dtm}`);
  console.log(`  ${row.CustName} | ${row.ProdName}`);
  console.log(`  Descr=${JSON.stringify(row.Descr)}`);
}

const hy = await pool.request().query(`
  SELECT e.EstimateKey, sm.OrderWeek, c.CustName, e.Descr, e.Quantity, ci.Descr2
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
    JOIN Product p ON p.ProdKey=e.ProdKey
    LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
   WHERE p.ProdName LIKE N'%Hyacinthus%Top White%'
     AND sm.OrderYear='2026'
   ORDER BY e.EstimateKey DESC`);

console.log('\nHyacinthus Top White estimates:', hy.recordset.length);
for (const row of hy.recordset) {
  console.log(`ek=${row.EstimateKey} ${row.OrderWeek} ${row.Descr2} qty=${row.Quantity} ${row.CustName}`);
  console.log(`  Descr=${JSON.stringify(row.Descr)}`);
}

const anyMemo = await pool.request().query(`
  SELECT TOP 20 e.EstimateKey, sm.OrderWeek, ci.Descr2 AS TypeLabel, e.Descr, p.ProdName, c.CustName
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Product p ON p.ProdKey=e.ProdKey
    JOIN Customer c ON c.CustKey=sm.CustKey
    LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
   WHERE LEN(LTRIM(RTRIM(ISNULL(e.Descr,''))))>0
   ORDER BY e.EstimateKey DESC`);

console.log('\nAny Estimate with Descr (latest 20):', anyMemo.recordset.length);
for (const row of anyMemo.recordset) {
  console.log(`ek=${row.EstimateKey} ${row.OrderWeek} ${row.TypeLabel} | ${row.CustName}`);
  console.log(`  Descr=${JSON.stringify(row.Descr)}`);
}

await pool.close();
