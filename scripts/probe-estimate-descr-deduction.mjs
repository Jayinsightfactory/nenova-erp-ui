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
  SELECT TOP 30 e.EstimateKey, sm.OrderWeek, e.EstimateType, p.ProdName, e.Descr
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Product p ON p.ProdKey=e.ProdKey
   WHERE ISNULL(sm.isDeleted,0)=0 AND sm.OrderYear='2026'
     AND (ISNULL(e.Descr,'') LIKE N'%차감수량%' OR ISNULL(e.Descr,'') LIKE N'%차감단가%'
          OR (p.ProdName LIKE N'%Hyacinthus%' AND sm.OrderWeek LIKE N'26%'))
   ORDER BY e.EstimateKey DESC`);

console.log('=== Estimate ===');
for (const row of r.recordset) {
  console.log(`ek=${row.EstimateKey} ${row.OrderWeek} ${row.EstimateType} | ${row.ProdName}`);
  console.log(`  Descr=[${row.Descr}]`);
}

const sd = await pool.request().query(`
  SELECT TOP 15 sd.SdetailKey, sm.OrderWeek, p.ProdName, sd.Descr
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
    JOIN Product p ON p.ProdKey=sd.ProdKey
   WHERE sm.OrderYear='2026' AND sm.OrderWeek LIKE N'26%'
     AND (ISNULL(sd.Descr,'') LIKE N'%차감%' OR p.ProdName LIKE N'%Hyacinthus%Top White%')`);

console.log('\n=== ShipmentDetail 26% ===');
for (const row of sd.recordset) {
  console.log(`sdk=${row.SdetailKey} ${row.OrderWeek} | ${row.ProdName}`);
  console.log(`  Descr=[${row.Descr}]`);
}

const sdt = await pool.request().query(`
  SELECT TOP 15 sdt.SdateKey, sm.OrderWeek, p.ProdName, sdt.Descr
    FROM ShipmentDate sdt
    JOIN ShipmentDetail sd ON sd.SdetailKey=sdt.SdetailKey
    JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
    JOIN Product p ON p.ProdKey=sd.ProdKey
   WHERE sm.OrderYear='2026' AND sm.OrderWeek LIKE N'26%'
     AND ISNULL(sdt.Descr,'') LIKE N'%차감%'`);

const hy26 = await pool.request().query(`
  SELECT e.EstimateKey, sm.OrderWeek, e.EstimateType, e.Quantity, e.Descr, p.ProdName, c.CustName
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Product p ON p.ProdKey=e.ProdKey
    JOIN Customer c ON c.CustKey=sm.CustKey
   WHERE sm.OrderWeek IN (N'26-01', N'26-02') AND p.ProdName LIKE N'%Hyacinthus%Top White%'`);

console.log('\n=== Hyacinthus Estimate 26-01/02 ===');
for (const row of hy26.recordset) {
  console.log(`ek=${row.EstimateKey} ${row.OrderWeek} qty=${row.Quantity} ${row.CustName}`);
  console.log(`  Descr=[${row.Descr}]`);
}

const allDed = await pool.request().query(`
  SELECT e.EstimateKey, sm.OrderWeek, e.EstimateType, e.Descr, p.ProdName
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Product p ON p.ProdKey=e.ProdKey
   WHERE sm.OrderYear='2026' AND sm.OrderWeek LIKE N'26%'
     AND ISNULL(e.EstimateType,'') LIKE N'%FEE%' OR e.EstimateType LIKE N'%kr00%'
     AND LEN(ISNULL(e.Descr,''))>0`);

console.log('\n=== Any 26% Estimate with Descr (fee types) ===');

await pool.close();
