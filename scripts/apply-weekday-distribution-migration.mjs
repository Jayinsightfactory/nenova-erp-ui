// Approved scope: two web audit tables only. Never migrate from an API read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'docs/migrations/2026-10-01_weekday_distribution_audit.sql');
const sqlText = fs.readFileSync(migrationPath, 'utf8');
const executable = sqlText.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const targets = [...executable.matchAll(/CREATE\s+TABLE\s+(?:dbo\.)?(\w+)/gi)].map(match => match[1]);
const indexTargets = [...executable.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+(?:dbo\.)?(\w+)/gi)].map(match => match[1]);
const references = [...executable.matchAll(/REFERENCES\s+(?:dbo\.)?(\w+)/gi)].map(match => match[1]);
if (targets.length !== 2 || new Set(targets).size !== 2
  || targets.some(name => !['WebWeekdayDistributionOperation', 'WebWeekdayDistributionChange'].includes(name))
  || indexTargets.some(name => name !== 'WebWeekdayDistributionChange')
  || references.some(name => name !== 'WebWeekdayDistributionOperation')
  || /\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?)\b/i.test(executable)) {
  throw new Error('Migration exceeds the approved two-table CREATE scope.');
}
if (!process.argv.includes('--apply')) {
  console.log('DRY RUN: two weekday distribution audit tables validated; no DB connection.');
  console.log('Run explicitly: node scripts/apply-weekday-distribution-migration.mjs --apply');
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
    OBJECT_ID(N'dbo.WebWeekdayDistributionOperation',N'U') AS OperationTable,
    OBJECT_ID(N'dbo.WebWeekdayDistributionChange',N'U') AS ChangeTable,
    COL_LENGTH(N'dbo.WebWeekdayDistributionOperation',N'UUID') AS OperationUUID,
    COL_LENGTH(N'dbo.WebWeekdayDistributionOperation',N'RequestHash') AS RequestHash,
    COL_LENGTH(N'dbo.WebWeekdayDistributionOperation',N'User') AS Actor,
    COL_LENGTH(N'dbo.WebWeekdayDistributionOperation',N'Reason') AS Reason,
    COL_LENGTH(N'dbo.WebWeekdayDistributionOperation',N'ResponseJson') AS ResponseJson,
    COL_LENGTH(N'dbo.WebWeekdayDistributionOperation',N'Created') AS Created,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'OperationFK') AS OperationFK,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'Year') AS ScopeYear,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'Week') AS ScopeWeek,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'CustKey') AS CustKey,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'ProdKey') AS ProdKey,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'BeforeJson') AS BeforeJson,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'AfterJson') AS AfterJson,
    COL_LENGTH(N'dbo.WebWeekdayDistributionChange',N'StockValuesIfKnown') AS StockValuesIfKnown,
    (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.WebWeekdayDistributionOperation') AND type=N'PK') AS OperationPK,
    (SELECT COUNT(*) FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.WebWeekdayDistributionChange') AND type=N'PK') AS ChangePK,
    (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.WebWeekdayDistributionChange') AND referenced_object_id=OBJECT_ID(N'dbo.WebWeekdayDistributionOperation')) AS OperationForeignKey,
    (SELECT COUNT(*) FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.WebWeekdayDistributionChange') AND name=N'IX_WebWeekdayDistributionChange_Scope') AS ScopeIndex`);
  const row = check.recordset?.[0];
  if (!row || Object.values(row).some(value => value == null || value === 0)) {
    throw new Error('Weekday audit schema verification failed. No ERP save should be enabled.');
  }
  console.log('Weekday distribution audit: both tables and required columns verified.');
} finally { await pool.close(); }
