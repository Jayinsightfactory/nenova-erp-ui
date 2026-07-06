/**
 * 견적 비고 — DB ShipmentDetail/ShipmentDate vs API 병합 시뮬
 * node scripts/probe-estimate-descr-sample.mjs [weekLike] [custLike]
 */
import fs from 'fs';
import sql from 'mssql';
import { mergeEstimateDescrRaw, sanitizeDescrTextForPrint } from '../lib/estimateInvariants.js';

for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const weekLike = process.argv[2] || '26-%';
const custLike = process.argv[3] || '%';

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

const r = await pool.request()
  .input('w', sql.NVarChar, weekLike)
  .input('c', sql.NVarChar, custLike)
  .query(`
    SELECT TOP 15 c.CustName, sm.OrderWeek, p.ProdName,
           ISNULL(sd.Descr,'') AS DetailDescr,
           ISNULL(sdd.Descr,'') AS DateDescr,
           CONVERT(NVARCHAR(10), sdd.ShipmentDtm, 120) AS outDate
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey=sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderWeek LIKE @w AND c.CustName LIKE @c
       AND sm.isDeleted=0 AND ISNULL(sd.OutQuantity,0)<>0
       AND (ISNULL(sd.Descr,'')<>'' OR ISNULL(sdd.Descr,'')<>'')
     ORDER BY sm.OrderWeek DESC, c.CustName, p.ProdName
  `);

console.log(`Samples (${r.recordset.length} rows with descr in week ${weekLike}):`);
for (const row of r.recordset) {
  const raw = mergeEstimateDescrRaw(row.DetailDescr, row.DateDescr);
  const display = sanitizeDescrTextForPrint(raw);
  console.log(`\n${row.CustName} / ${row.OrderWeek} / ${row.ProdName} / ${row.outDate}`);
  console.log(`  Detail: ${JSON.stringify(row.DetailDescr)}`);
  console.log(`  Date:   ${JSON.stringify(row.DateDescr)}`);
  console.log(`  → web:  ${JSON.stringify(display)}`);
}

const r2 = await pool.request()
  .input('w', sql.NVarChar, weekLike)
  .query(`
    SELECT TOP 10 c.CustName, sm.OrderWeek, p.ProdName,
           ISNULL(sd.Descr,'') AS DetailDescr, ISNULL(sdd.Descr,'') AS DateDescr
      FROM ShipmentMaster sm
      JOIN Customer c ON c.CustKey=sm.CustKey
      JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      LEFT JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderWeek LIKE @w AND sm.isDeleted=0
       AND (ISNULL(sd.Descr,'')<>'' OR ISNULL(sdd.Descr,'')<>'')
       AND ISNULL(sd.Descr,'') NOT LIKE N'%>%'
       AND ISNULL(sdd.Descr,'') NOT LIKE N'%>%'
     ORDER BY sm.OrderWeek DESC
  `);
console.log(`\nUser-memo-like samples (no > pattern): ${r2.recordset.length}`);
for (const row of r2.recordset) {
  const raw = mergeEstimateDescrRaw(row.DetailDescr, row.DateDescr);
  console.log(`  ${row.CustName} / ${row.ProdName}: raw=${JSON.stringify(raw)} → ${JSON.stringify(sanitizeDescrTextForPrint(raw))}`);
}

await pool.close();
