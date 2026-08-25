import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const migrationPath = path.join(here, '..', 'docs', 'migrations', '2026-08-25_web_erp_edit_presence.sql');
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
  console.log('Run: node scripts/apply-erp-edit-presence-migration.mjs --apply');
  process.exit(0);
}

loadLocalEnv();
for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key}가 없어 편집 보호 스키마 적용을 중단했습니다.`);
}

// DB 설정은 모듈을 불러오는 시점에 읽히므로 .env.local 처리 뒤 가져온다.
const { getPool } = await import('../lib/db.js');
const sqlText = fs.readFileSync(migrationPath, 'utf8');
const pool = await getPool();
try {
  await pool.request().batch(sqlText);
  const result = await pool.request().query(
    "SELECT OBJECT_ID(N'dbo.WebErpEditLease', N'U') AS TableId, COUNT(*) AS LeaseCount FROM dbo.WebErpEditLease",
  );
  if (!result.recordset?.[0]?.TableId) throw new Error('WebErpEditLease migration verification failed');
  console.log(`WebErpEditLease ready (active/history rows: ${result.recordset[0].LeaseCount || 0})`);
} finally {
  await pool.close();
}
