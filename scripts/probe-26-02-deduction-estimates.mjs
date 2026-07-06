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
  SELECT e.EstimateKey, sm.OrderWeek, e.EstimateType, ci.Descr2, e.Quantity, e.Descr, p.ProdName, c.CustName,
         CONVERT(NVARCHAR(10), e.EstimateDtm, 120) AS estDtm
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Product p ON p.ProdKey=e.ProdKey
    JOIN Customer c ON c.CustKey=sm.CustKey
    LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
   WHERE sm.OrderWeek=N'26-02' AND ISNULL(sm.isDeleted,0)=0
     AND (e.EstimateType LIKE N'%FEE%' OR ci.Descr2 LIKE N'%검역%' OR ci.Descr2 LIKE N'%불량%')
   ORDER BY c.CustName, p.ProdName`);

console.log('26-02 deduction estimates:', r.recordset.length);
for (const row of r.recordset) {
  console.log(`ek=${row.EstimateKey} ${row.EstimateType}/${row.Descr2} qty=${row.Quantity} ${row.estDtm}`);
  console.log(`  ${row.CustName} | ${row.ProdName}`);
  console.log(`  Descr len=${String(row.Descr||'').length} [${JSON.stringify(row.Descr)}]`);
}

await pool.close();
