import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'docs', 'migrations', '2026-08-27_web_china_volume_board.sql');

if (!process.argv.includes('--apply')) {
  console.log(`DRY RUN: ${migrationPath}`);
  console.log('Run: node scripts/apply-china-volume-board-migration.mjs --apply');
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
  if (!process.env[key]) throw new Error(`${key}가 없어 자동 중국물량표 스키마 적용을 중단했습니다.`);
}

const { getPool } = await import('../lib/db.js');
const pool = await getPool();
try {
  await pool.request().batch(fs.readFileSync(migrationPath, 'utf8'));
  const result = await pool.request().query(`
    SELECT
      OBJECT_ID(N'dbo.WebChinaVolumeBoard',N'U') BoardId,
      OBJECT_ID(N'dbo.WebChinaVolumeProductMap',N'U') ProductMapId,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'OrderYear') BoardYear,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'OrderWeek') BoardWeek,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'BoardName') BoardName,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'PackingRowsJson') PackingRowsJson,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'CellsJson') CellsJson,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'MatchOverridesJson') MatchOverridesJson,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'ReviewStateJson') ReviewStateJson,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'isDeleted') BoardDeleted,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'UpdatedAt') BoardUpdatedAt,
      COL_LENGTH(N'dbo.WebChinaVolumeBoard',N'RowVersion') BoardRowVersion,
      COL_LENGTH(N'dbo.WebChinaVolumeProductMap',N'NormalizedSourceName') NormalizedSourceName,
      COL_LENGTH(N'dbo.WebChinaVolumeProductMap',N'SourceItemName') SourceItemName,
      COL_LENGTH(N'dbo.WebChinaVolumeProductMap',N'ProdKey') MappingProdKey,
      COL_LENGTH(N'dbo.WebChinaVolumeProductMap',N'ProdNameSnapshot') ProdNameSnapshot,
      COL_LENGTH(N'dbo.WebChinaVolumeProductMap',N'isDeleted') MappingDeleted,
      COL_LENGTH(N'dbo.WebChinaVolumeProductMap',N'UpdatedAt') MappingUpdatedAt,
      (SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebChinaVolumeBoard',N'U') AND name=N'IX_WebChinaVolumeBoard_Scope') BoardScopeIndex,
      (SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebChinaVolumeProductMap',N'U') AND name=N'UX_WebChinaVolumeProductMap_ActiveNormalized' AND is_unique=1 AND has_filter=1) MappingUniqueIndex`);
  const row = result.recordset?.[0] || {};
  const required = ['BoardId', 'ProductMapId', 'BoardYear', 'BoardWeek', 'BoardName', 'PackingRowsJson', 'CellsJson', 'MatchOverridesJson', 'ReviewStateJson', 'BoardDeleted', 'BoardUpdatedAt', 'BoardRowVersion', 'NormalizedSourceName', 'SourceItemName', 'MappingProdKey', 'ProdNameSnapshot', 'MappingDeleted', 'MappingUpdatedAt', 'BoardScopeIndex', 'MappingUniqueIndex'];
  const missing = required.filter(key => !row[key]);
  if (missing.length) throw new Error(`자동 중국물량표 migration verification failed: ${missing.join(', ')}`);
  console.log('WebChinaVolumeBoard + WebChinaVolumeProductMap schema ready');
} finally {
  await pool.close();
}
