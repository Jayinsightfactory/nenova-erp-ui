import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const migrationPath = path.join(root, 'docs', 'migrations', '2026-09-30_profit_report_snapshot.sql');
const apply = process.argv.includes('--apply');

function loadLocalEnv() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
  }
}

if (!apply) {
  console.log(`DRY RUN: ${migrationPath}`);
  console.log('Run explicitly: node scripts/apply-profit-report-snapshot-migration.mjs --apply');
  process.exit(0);
}

loadLocalEnv();
for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key} is required before applying the profit report snapshot migration.`);
}

const { getPool } = await import('../lib/db.js');
const sqlText = fs.readFileSync(migrationPath, 'utf8');
const pool = await getPool();
try {
  await pool.request().batch(sqlText);
  const result = await pool.request().query(`SELECT OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') AS S, OBJECT_ID(N'dbo.TR_WebProfitReportSnapshot_Immutable', N'TR') AS TS,
    OBJECT_ID(N'dbo.WebProfitReportConfirm', N'U') AS C, OBJECT_ID(N'dbo.WebProfitReportConfirmDetail', N'U') AS CD`);
  const row = result.recordset?.[0] || {};
  const missing = ['S', 'TS', 'C', 'CD'].filter((k) => !row[k]);
  if (missing.length) throw new Error(`WebProfitReportSnapshot migration verification failed: ${missing.join(',')}`);
  console.log('WebProfitReportSnapshot + immutable trigger + WebProfitReportConfirm ready');
} finally {
  await pool.close();
}
