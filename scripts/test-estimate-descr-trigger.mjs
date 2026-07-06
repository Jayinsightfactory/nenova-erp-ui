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

const ek = 7340;
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

await pool.request().input('ek', sql.Int, ek).input('d', sql.NVarChar, '차감수량 -1>-2차감수량 -2>-1')
  .query('UPDATE Estimate SET Descr=@d WHERE EstimateKey=@ek');
const r = await pool.request().input('ek', sql.Int, ek).query('SELECT Descr FROM Estimate WHERE EstimateKey=@ek');
console.log('after trigger:', JSON.stringify(r.recordset[0].Descr));
await pool.request().input('ek', sql.Int, ek).query("UPDATE Estimate SET Descr=N'' WHERE EstimateKey=@ek");
await pool.close();
