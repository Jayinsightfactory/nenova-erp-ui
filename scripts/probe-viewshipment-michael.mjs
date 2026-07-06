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
  SELECT vs.SdetailKey, vs.ShipmentKey, vs.OrderWeek, vs.CustName, vs.ProdName,
         vs.Descr, vs.EstDescr, vs.EstQuantity2
    FROM ViewShipment vs
   WHERE vs.OrderWeek=N'26-01' AND vs.CustName LIKE N'%미카엘%'
     AND vs.ProdName LIKE N'%Hyacinthus%Top White%'`);

for (const row of r.recordset) {
  console.log('sdk', row.SdetailKey, 'EstQty2', row.EstQuantity2);
  console.log('  Descr', JSON.stringify(row.Descr));
  console.log('  EstDescr', JSON.stringify(row.EstDescr));
}

await pool.close();
