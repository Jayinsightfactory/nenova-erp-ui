// Approved scope: three linked early-shipment audit tables only. Never migrate from an API read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'docs/migrations/2026-10-08_weekday_early_shipment.sql');
const sqlText = fs.readFileSync(migrationPath, 'utf8');
const executable = sqlText.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const targets = [...executable.matchAll(/CREATE\s+TABLE\s+(?:dbo\.)?(\w+)/gi)].map(match => match[1]);
const indexTargets = [...executable.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+(?:dbo\.)?(\w+)/gi)].map(match => match[1]);
const references = [...executable.matchAll(/REFERENCES\s+(?:dbo\.)?(\w+)/gi)].map(match => match[1]);
if (targets.length !== 3 || new Set(targets).size !== 3
  || targets.some(name => !['WebEarlyShipmentOperation', 'WebEarlyShipmentEffect', 'WebEarlyShipmentRevision'].includes(name))
  || indexTargets.some(name => name !== 'WebEarlyShipmentOperation')
  || references.some(name => !['WebEarlyShipmentOperation', 'StockHistory'].includes(name))
  || /\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?)\b/i.test(executable)) {
  throw new Error('Migration exceeds the approved three-table CREATE scope.');
}
if (!process.argv.includes('--apply')) {
  console.log('DRY RUN: three early shipment audit tables validated; no DB connection.');
  console.log('Run explicitly: node scripts/apply-weekday-early-shipment-migration.mjs --apply');
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
  if (!process.env[key]) throw new Error(`${key} is required for the approved weekday audit migration.`);
}
if (['master', 'model', 'msdb', 'tempdb'].includes(process.env.DB_NAME.toLowerCase())) {
  throw new Error('System databases are not permitted migration targets.');
}
const { getPool } = await import('../lib/db.js');
const pool = await getPool();
try {
  await pool.request().batch(sqlText);
  const check = await pool.request().query(`SELECT
    OBJECT_ID(N'dbo.WebEarlyShipmentOperation',N'U') AS OperationTable,
    OBJECT_ID(N'dbo.WebEarlyShipmentEffect',N'U') AS EffectTable,
    OBJECT_ID(N'dbo.WebEarlyShipmentRevision',N'U') AS RevisionTable,
    COL_LENGTH(N'dbo.WebEarlyShipmentOperation',N'TargetImportWeek') AS ImportAnchor,
    COL_LENGTH(N'dbo.WebEarlyShipmentOperation',N'ReversalOperationId') AS ReversalId,
    COL_LENGTH(N'dbo.WebEarlyShipmentOperation',N'ReversalRequestHash') AS ReversalHash,
    COL_LENGTH(N'dbo.WebEarlyShipmentRevision',N'Reason') AS RevisionReason,
    COL_LENGTH(N'dbo.WebEarlyShipmentEffect',N'StockHistoryKey') AS HistoryLink,
    (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.WebEarlyShipmentOperation') AND type=N'PK') AS OperationPK,
    (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.WebEarlyShipmentEffect') AND type=N'PK') AS EffectPK,
    (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.WebEarlyShipmentRevision') AND type=N'PK') AS RevisionPK,
    (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.WebEarlyShipmentEffect') AND referenced_object_id=OBJECT_ID(N'dbo.StockHistory')) AS HistoryFK,
    (SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebEarlyShipmentOperation') AND name=N'IX_WebEarlyShipmentOperation_TargetActive') AS TargetIndex`);
  const row = check.recordset?.[0];
  if (!row || Object.values(row).some(value => value == null || value === 0)) {
    throw new Error('Weekday audit schema verification failed. No ERP save should be enabled.');
  }
  console.log('Weekday early shipment audit: three tables, linked history and required columns verified.');
} finally { await pool.close(); }
