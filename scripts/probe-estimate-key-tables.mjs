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

const ek = 7340;
const e = await pool.request().input('ek', sql.Int, ek).query(`
  SELECT e.*, sm.OrderWeek, c.CustName, p.ProdName
    FROM Estimate e
    JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
    JOIN Product p ON p.ProdKey=e.ProdKey
   WHERE e.EstimateKey=@ek`);
console.log('Estimate:', e.recordset[0]);

const tables = await pool.request().query(`
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE COLUMN_NAME IN (N'EstimateKey', N'EstKey')
   GROUP BY TABLE_NAME`);
console.log('\nTables with EstimateKey:', tables.recordset.map((r) => r.TABLE_NAME).join(', '));

await pool.close();
