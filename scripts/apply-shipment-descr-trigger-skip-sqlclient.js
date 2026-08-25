#!/usr/bin/env node
/** Apply TR_ShipmentDetail_OutQty_Log migration that skips SqlClient APP_NAME. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = [
  path.join(__dirname, '..', '.env.local'),
  'C:/Users/USER/nenova-erp-ui/.env.local',
].find((p) => fs.existsSync(p));
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

async function main() {
  const sqlText = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'migrations', '2026-08-25_shipment_detail_trigger_skip_sqlclient.sql'),
    'utf8',
  );
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });
  const batches = sqlText.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  for (const batch of batches) {
    await pool.request().batch(batch);
  }
  const check = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('TR_ShipmentDetail_OutQty_Log')) AS def`);
  const def = String(check.recordset[0]?.def || '');
  console.log('trigger_has_sqlclient_skip=', /SqlClient/.test(def));
  console.log(def.slice(0, 800));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
