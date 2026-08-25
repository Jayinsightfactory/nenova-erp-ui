#!/usr/bin/env node
/**
 * ShipmentDetail.Descr 에서 SqlClient 트리거 감사줄만 제거.
 * 사용자 메모와 "재용3>2" 형식은 유지.
 *
 *   node scripts/cleanup-shipment-descr-sqlclient.js
 *   node scripts/cleanup-shipment-descr-sqlclient.js --apply
 */
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
    SELECT sd.SdetailKey, sm.OrderYear, sm.OrderWeek, c.CustName,
           ISNULL(sd.Descr, N'') AS Descr
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      JOIN Customer c ON c.CustKey = sm.CustKey
     WHERE ISNULL(sd.Descr, N'') LIKE N'%SqlClient%'
        OR ISNULL(sd.Descr, N'') LIKE N'%Data Provider%'
        OR ISNULL(sd.Descr, N'') LIKE N'%node-mssql%'
     ORDER BY sd.SdetailKey DESC`);

  const targets = [];
  for (const row of r.recordset) {
    const before = String(row.Descr || '');
    const after = stripSqlAuditFromDescr(before);
    if (before !== after) targets.push({ ...row, before, after });
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | candidates=${targets.length}`);
  for (const row of targets.slice(0, 20)) {
    console.log(`sdk=${row.SdetailKey} ${row.OrderWeek} ${row.CustName}`);
    console.log(`  before: ${JSON.stringify(row.before).slice(0, 180)}`);
    console.log(`  after:  ${JSON.stringify(row.after).slice(0, 180)}`);
  }
  if (targets.length > 20) console.log(`... +${targets.length - 20} more`);

  if (!APPLY) {
    console.log('\nRe-run with --apply to update ShipmentDetail.Descr');
    await pool.close();
    return;
  }

  let updated = 0;
  for (const row of targets) {
    await pool.request()
      .input('dk', sql.Int, row.SdetailKey)
      .input('descr', sql.NVarChar, row.after)
      .query('UPDATE ShipmentDetail SET Descr=@descr WHERE SdetailKey=@dk');
    updated += 1;
  }
  console.log(`updated=${updated}`);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
