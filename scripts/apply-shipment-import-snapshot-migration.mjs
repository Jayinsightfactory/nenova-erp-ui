import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'docs', 'migrations', '2026-08-31_shipment_import_snapshot_rollback.sql');

if (!process.argv.includes('--apply')) {
  console.log(`DRY RUN: ${migrationPath}`);
  console.log('Run: node scripts/apply-shipment-import-snapshot-migration.mjs --apply');
  process.exit(0);
}

const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
  }
}

for (const key of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key}가 없어 엑셀 업로드 복원 스키마 적용을 중단했습니다.`);
}

const { getPool } = await import('../lib/db.js');
const pool = await getPool();
try {
  await pool.request().batch(fs.readFileSync(migrationPath, 'utf8'));
  const result = await pool.request().query(`
    SELECT
      OBJECT_ID(N'dbo.ShipmentImportSnapshot',N'U') SnapshotTable,
      COL_LENGTH(N'dbo.ShipmentImportSnapshot',N'AuditKey') SnapshotAuditKey,
      COL_LENGTH(N'dbo.ShipmentImportSnapshot',N'BeforeJson') SnapshotBefore,
      COL_LENGTH(N'dbo.ShipmentImportSnapshot',N'AfterJson') SnapshotAfter,
      COL_LENGTH(N'dbo.ShipmentImportAudit',N'RollbackStatus') RollbackStatus,
      COL_LENGTH(N'dbo.ShipmentImportAudit',N'RolledBackDtm') RolledBackDtm,
      COL_LENGTH(N'dbo.ShipmentImportAudit',N'RolledBackBy') RolledBackBy,
      COL_LENGTH(N'dbo.ShipmentImportAudit',N'RollbackReason') RollbackReason,
      (SELECT COUNT(*) FROM sys.indexes
        WHERE object_id=OBJECT_ID(N'dbo.ShipmentImportSnapshot',N'U')
          AND name=N'IX_ShipmentImportSnapshot_AuditKey') AuditIndex,
      (SELECT COUNT(*) FROM sys.indexes
        WHERE object_id=OBJECT_ID(N'dbo.ShipmentImportSnapshot',N'U')
          AND name=N'IX_ShipmentImportSnapshot_Entity') EntityIndex`);
  const row = result.recordset?.[0] || {};
  const required = ['SnapshotTable', 'SnapshotAuditKey', 'SnapshotBefore', 'SnapshotAfter', 'RollbackStatus', 'RolledBackDtm', 'RolledBackBy', 'RollbackReason', 'AuditIndex', 'EntityIndex'];
  const missing = required.filter((key) => !row[key]);
  if (missing.length) throw new Error(`엑셀 업로드 복원 스키마 확인 실패: ${missing.join(', ')}`);
  console.log('ShipmentImportSnapshot + rollback audit schema ready');
} finally {
  await pool.close();
}
