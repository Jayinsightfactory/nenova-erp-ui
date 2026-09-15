import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const migrationPath = path.join(root, 'docs', 'migrations', '2026-09-15_pnl_special_notes.sql');
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
  console.log('Run explicitly: node scripts/apply-pnl-special-notes-migration.mjs --apply');
  process.exit(0);
}

loadLocalEnv();
for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key} is required before applying the P&L special notes migration.`);
}

const { getPool } = await import('../lib/db.js');
const sqlText = fs.readFileSync(migrationPath, 'utf8');
const pool = await getPool();
try {
  await pool.request().batch(sqlText);
  const result = await pool.request().query("SELECT OBJECT_ID(N'dbo.WebRaumPnlSpecialNote', N'U') AS TableId");
  if (!result.recordset?.[0]?.TableId) throw new Error('WebRaumPnlSpecialNote migration verification failed');
  console.log('WebRaumPnlSpecialNote ready');
} finally {
  await pool.close();
}
