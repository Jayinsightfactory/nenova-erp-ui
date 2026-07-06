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

try {
  const r = await pool.request().input('ek', sql.Int, 7340).query(`
    SELECT TOP 5 * FROM ViewShipment vs
    WHERE vs.ShipmentKey IN (SELECT ShipmentKey FROM Estimate WHERE EstimateKey=@ek)`);
  console.log('ViewShipment cols:', r.recordset[0] ? Object.keys(r.recordset[0]).join(', ') : 'none');
  if (r.recordset[0]?.Descr) console.log('Descr', r.recordset[0].Descr);
} catch (e) {
  console.log('ViewShipment error:', e.message);
}

const hist = await pool.request().input('ek', sql.Int, 7340).query(`
  SELECT TOP 10 * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE N'%Estimate%History%'`);

console.log('Estimate history tables:', hist.recordset.map((x) => x.TABLE_NAME));

await pool.close();
