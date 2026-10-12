#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import { stripSqlAuditFromDescr } from '../lib/shipmentDescr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = [
  path.join(__dirname, '..', '.env.local'),
  'C:/Users/USER/nenova-erp-ui/.env.local',
].find((p) => fs.existsSync(p));
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const APPLY = process.argv.includes('--apply');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
  });
  const r = await pool.request().query(`
    SELECT sd.SdetailKey, ISNULL(sd.Descr,N'') AS Descr
      FROM ShipmentDetail sd
     WHERE ISNULL(sd.Descr,N'') LIKE N'%node-mssql%'
        OR ISNULL(sd.Descr,N'') LIKE N'%SqlClient%'
        OR ISNULL(sd.Descr,N'') LIKE N'%Data Provider%'
        OR ISNULL(sd.Descr,N'') LIKE N'%] [%'`);
  const targets = [];
  for (const row of r.recordset) {
    const before = String(row.Descr || '');
    const after = stripSqlAuditFromDescr(before);
    if (before !== after) targets.push({ key: row.SdetailKey, before, after });
  }
  console.log(`Mode:${APPLY ? 'APPLY' : 'DRY'} count=${targets.length}`);
  for (const t of targets.slice(0, 15)) {
    console.log(t.key, JSON.stringify(t.before).slice(0, 120), '=>', JSON.stringify(t.after).slice(0, 80));
  }
  if (APPLY) {
    for (const t of targets) {
      await pool.request().input('dk', sql.Int, t.key).input('d', sql.NVarChar, t.after)
        .query('UPDATE ShipmentDetail SET Descr=@d WHERE SdetailKey=@dk');
    }
    console.log('updated', targets.length);
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
