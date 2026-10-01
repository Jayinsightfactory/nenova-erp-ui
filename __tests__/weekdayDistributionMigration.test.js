import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../docs/migrations/2026-10-01_weekday_distribution_audit.sql', import.meta.url);

test('migration은 승인된 sidecar 두 테이블과 scope index만 만든다', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const creates = [...sql.matchAll(/CREATE TABLE\s+dbo\.([A-Za-z0-9_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(creates, ['WebWeekdayDistributionOperation', 'WebWeekdayDistributionChange']);
  assert.match(sql, /UUID uniqueidentifier NOT NULL/);
  assert.match(sql, /OperationFK uniqueidentifier NOT NULL/);
  assert.match(sql, /FOREIGN KEY \(OperationFK\)[\s\S]*REFERENCES dbo\.WebWeekdayDistributionOperation\(UUID\)/);
  assert.match(sql, /IX_WebWeekdayDistributionChange_Scope/);
  assert.doesNotMatch(sql, /ALTER\s+(?:TABLE|PROCEDURE)|CREATE\s+PROCEDURE|EXEC\s+dbo\./i);
  const executable = sql.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(executable, /\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?)\b/i);
  assert.match(sql, /ISJSON\(BeforeJson\)/);
  assert.match(sql, /ISJSON\(AfterJson\)/);
});

test('배포 migration은 명시 apply와 대상 검증을 요구하고 dry run은 접속하지 않는다', async () => {
  const runner = await readFile(new URL('../scripts/apply-weekday-distribution-migration.mjs', import.meta.url), 'utf8');
  assert.match(runner, /process\.argv\.includes\('--apply'\)/);
  assert.match(runner, /Migration exceeds the approved two-table CREATE scope/);
  assert.match(runner, /System databases are not permitted/);
  assert.doesNotMatch(runner, /console\.(?:log|error)\([^\n]*(?:password|process\.env|config)/i);
  const result = spawnSync(process.execPath, ['scripts/apply-weekday-distribution-migration.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validated; no DB connection/);
  const deployment = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(deployment, /node scripts\/apply-weekday-distribution-migration\.mjs --apply \|\| exit 1/);
});
