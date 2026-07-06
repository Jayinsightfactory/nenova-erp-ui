#!/usr/bin/env node
/** Apply estimate deduction descr trigger migration */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const APPLY = process.argv.includes('--apply');
const sqlText = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'migrations', '2026-06-16_estimate_deduction_descr_trigger.sql'),
  'utf8',
);

const batches = sqlText.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | batches=${batches.length}`);
if (!APPLY) {
  console.log(sqlText.slice(0, 500), '...');
  console.log('\nAdd --apply to run on DB');
  await pool.close();
  process.exit(0);
}

for (const batch of batches) {
  await pool.request().query(batch);
}
console.log('Trigger + function applied.');

// test trigger
await pool.request().query(`
  UPDATE TOP (0) Estimate SET Descr = Descr WHERE 1=0`);
console.log('OK');

await pool.close();
