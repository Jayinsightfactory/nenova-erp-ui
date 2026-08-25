import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPaths = [
  path.join(root, 'docs', 'migrations', '2026-08-25_web_pre_shipment_management.sql'),
  path.join(root, 'docs', 'migrations', '2026-08-25_web_pre_shipment_item_matching.sql'),
];
if (!process.argv.includes('--apply')) { console.log(`DRY RUN: ${migrationPaths.join(', ')}`); process.exit(0); }
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) { const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (match && process.env[match[1]] == null) process.env[match[1]] = match[2]; }
for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!process.env[key]) throw new Error(`${key}가 없어 선출고 스키마 적용을 중단했습니다.`);
const { getPool } = await import('../lib/db.js');
const pool = await getPool();
try {
  for (const migrationPath of migrationPaths) await pool.request().batch(fs.readFileSync(migrationPath, 'utf8'));
  const result = await pool.request().query("SELECT OBJECT_ID(N'dbo.WebPreShipmentPlan',N'U') PlanId,OBJECT_ID(N'dbo.WebPreShipmentAllocation',N'U') AllocationId,COL_LENGTH(N'dbo.WebPreShipmentItem',N'ProdKey') ProdKey,COL_LENGTH(N'dbo.WebPreShipmentItem',N'MatchedProdName') MatchedProdName");
  if (!result.recordset?.[0]?.PlanId || !result.recordset?.[0]?.AllocationId || !result.recordset?.[0]?.ProdKey || !result.recordset?.[0]?.MatchedProdName) throw new Error('선출고 migration verification failed');
  console.log('WebPreShipment schema ready');
} finally { await pool.close(); }
