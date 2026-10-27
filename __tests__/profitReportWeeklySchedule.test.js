import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kstDateOnly, latestWednesdaySlot, resolveCurrentProfitWeek, resolvePreviousProfitWeek, resolveWeeklySchedule } from '../lib/profitReportWeeklySchedule.js';
import { parseBackfillArgs, assertHistoricalBackfill, inspectCacheOnlySql, createCacheSqlGuard, runBackfill } from '../scripts/backfill-profit-report-cache.mjs';

export function range(start, count, key) {
  return Array.from({ length: count }, (_, i) => ({ dateOnly: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), orderYearWeek: key }));
}
export const calendar = [...range('2026-10-14', 7, '202642'), ...range('2026-10-21', 7, '202643'), ...range('2026-10-28', 7, '202644'), ...range('2026-11-04', 7, '202645')];

assert.equal(kstDateOnly('2026-10-27T15:00:00Z'), '2026-10-28');
assert.equal(latestWednesdaySlot('2026-10-27T20:59:59Z').key, '2026-10-21');
assert.equal(latestWednesdaySlot('2026-10-27T21:00:00Z').key, '2026-10-28');
assert.equal(latestWednesdaySlot('2026-10-30T04:00:00Z').key, '2026-10-28');
assert.equal(resolveWeeklySchedule(calendar, '2026-10-27T21:00:00Z').target.major, '43');
assert.equal(resolveWeeklySchedule(calendar, '2026-10-30T04:00:00Z').target.major, '43');
assert.equal(resolveWeeklySchedule(calendar, '2026-10-27T20:59:59Z').target.major, '42');
assert.equal(resolveCurrentProfitWeek(calendar, '2026-10-28').major, '44', 'day-of-year ceil must not yield43');

for (const [year, prev] of [['2026', '2025'], ['2027', '2026']]) {
  const rows = [...range(`${prev}-12-31`, 1, `${prev}53`), ...range(`${year}-01-01`, 5, `${year}01`)];
  const current = resolveCurrentProfitWeek(rows, `${year}-01-01`);
  assert.equal(resolvePreviousProfitWeek(rows, current).major, '53');
  assert.equal(resolvePreviousProfitWeek(rows, current).orderYear, prev);
}
const fail = rows => assert.throws(() => resolveWeeklySchedule(rows, '2026-10-27T21:00:00Z'), { code: 'PROFIT_CALENDAR_INVALID' });
fail([]);
fail([...calendar, { ...calendar[10] }]);
fail(calendar.filter(row => row.dateOnly !== '2026-10-27'));
fail(calendar.filter(row => row.dateOnly !== '2026-10-30'));
fail(calendar.filter(row => row.dateOnly !== '2026-10-21'));
fail(calendar.map(row => row.dateOnly === '2026-10-28' ? { ...row, orderYearWeek: '202544' } : row));
fail(calendar.map(row => row.orderYearWeek === '202643' ? { ...row, orderYearWeek: '202641' } : row));
fail(calendar.map(row => row.dateOnly === '2026-10-28' ? { ...row, orderYearWeek: '20264401' } : row));
assert.throws(() => resolveCurrentProfitWeek(calendar, '2026-02-30'));

const args = parseBackfillArgs(['--year', '2026', '--from', '1', '--to', '42']);
assert.equal(args.apply, false);
assert.equal(args.pauseMs, 1500);
for (const bad of [[], ['--year', '2026', '--from', '0', '--to', '2'], ['--year', '2026', '--from', '1', '--to', '54'], ['--year', '2026', '--from', '1', '--to', '2', '--apply'], ['--year', '2026', '--from', '1', '--to', '2', '--pause', '-1']]) assert.throws(() => parseBackfillArgs(bad));
assertHistoricalBackfill(args, { orderYear: '2026', major: '43' });
assert.throws(() => assertHistoricalBackfill({ ...args, to: 43 }, { orderYear: '2026', major: '43' }));
assert.throws(() => assertHistoricalBackfill({ ...args, year: '2027' }, { orderYear: '2026', major: '43' }));
assertHistoricalBackfill({ ...args, year: '2025', to: 53 }, { orderYear: '2026', major: '01' });
assert.deepEqual(inspectCacheOnlySql("SELECT 'UPDATE', 'DROP', @value FROM Product WITH (NOLOCK) -- DELETE\n"), { insertAttempts: 0, appLockCalls: 0 });
assert.equal(inspectCacheOnlySql('INSERT INTO dbo.WebProfitReportSnapshot SELECT @y, @m').insertAttempts, 1);
assert.equal(inspectCacheOnlySql('DECLARE @r INT; EXEC @r = sys.sp_getapplock @Resource=@key; SELECT @r AS result').appLockCalls, 1);
// Execute the production optional-table loader with a query spy, not a DB.
const workbookSource = fs.readFileSync(new URL('../lib/sourceWorkbookFx.js', import.meta.url), 'utf8');
const loaderBody = workbookSource.slice(workbookSource.indexOf('export async function loadSourceWorkbookFxRows')).replace('export ', '');
let workbookSelects = 0;
const workbookLoader = new Function('query', 'sql', `${loaderBody}; return loadSourceWorkbookFxRows;`)(async (text, params) => {
  assert.deepEqual(inspectCacheOnlySql(text), { insertAttempts: 0, appLockCalls: 0 });
  assert.equal(params.y0.value, '2026');
  workbookSelects++;
  return { recordset: [{ OrderYear: '2026', OrderWeek: '01-01', ExchangeRate: 1400 }] };
}, { NVarChar: 'nvarchar' });
assert.equal((await workbookLoader(['2026']))[0].ExchangeRate, 1400);
assert.equal(workbookSelects, 1);
const optionalTablePrefix = "IF OBJECT_ID(N'dbo.WebArrivalCostLine', N'U') IS NOT NULL ";
for (const suffix of ['UPDATE Product SET Stock=0', 'SELECT 1; DELETE FROM Estimate', 'SELECT 1 INTO #copy', 'SELECT 1; INSERT INTO WebProfitReportSnapshot SELECT 1', 'SELECT 1; EXEC sys.sp_getapplock @Resource=@key', 'SELECT 1; EXEC usp_StockCalculation', 'BEGIN CREATE TABLE X(Y INT) END']) {
  assert.throws(() => inspectCacheOnlySql(optionalTablePrefix + suffix));
}
assert.throws(() => inspectCacheOnlySql('IF 1=1 SELECT 1'), 'unrelated IF shapes remain blocked');
for (const text of ['UPDATE Product SET Stock=1', 'DELETE FROM WebProfitReportSnapshot', 'SELECT * INTO #temp FROM Product', 'EXEC usp_StockCalculation', 'INSERT INTO Estimate SELECT 1', 'INSERT INTO WebProfitReportSnapshot SELECT 1; INSERT INTO StockHistory SELECT 1', 'ALTER TABLE X ADD Y INT', 'EXEC(@sql)', 'SELECT 1; EXEC sp_executesql @sql']) assert.throws(() => inspectCacheOnlySql(text));
const stats = { queries: 0, insertAttempts: 0, appLockCalls: 0, blocked: 0 };
const guard = createCacheSqlGuard(stats);
guard('SELECT 1');
assert.throws(() => guard('UPDATE Product SET Stock=0'), { code: 'CACHE_ONLY_SQL_BLOCKED' });
assert.throws(() => guard('INSERT INTO WebProfitReportSnapshot SELECT 1'), { code: 'CACHE_ONLY_SQL_BLOCKED' });
assert.equal(stats.insertAttempts, 0, 'a swallowed source write failure cannot be followed by cache persistence');
let active = 0; let peak = 0; let pauses = 0; const calls = [];
const result = await runBackfill({ ...args, to: 3 }, { current: { orderYear: '2026', major: '43' }, pause: async () => { pauses++; }, save: async data => {
  active++; peak = Math.max(peak, active); calls.push(data); await Promise.resolve(); active--;
  return data.major === '02' ? { action: 'skipped', reason: 'confirmed' } : { action: 'saved' };
} });
assert.equal(result.failed, false); assert.equal(peak, 1); assert.equal(pauses, 2);
assert.deepEqual(calls.map(x => x.major), ['01', '02', '03']);
assert.ok(calls.every(x => x.reason === 'BACKFILL' && x.orderYear === '2026'));
const partial = await runBackfill({ ...args, to: 3 }, { current: { orderYear: '2026', major: '43' }, pause: async () => {}, save: async ({ major }) => { if (major === '02') throw Error('private details'); return { action: 'saved' }; } });
assert.equal(partial.failed, true); assert.equal(partial.partialSuccess, true); assert.equal(partial.results.length, 2);
assert.ok(!JSON.stringify(partial).includes('private details'));
// This file already imported the CLI as a module without exiting. A real entry
// must instead terminate its own process, even if imported APIs leave timers.
const cliUrl = new URL('../scripts/backfill-profit-report-cache.mjs', import.meta.url);
for (const [cliArgs, expectedStatus] of [[['--year', '2026', '--from', '1', '--to', '42'], 0], [[], 1]]) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `process.argv=[process.execPath,${JSON.stringify(fileURLToPath(cliUrl))},...${JSON.stringify(cliArgs)}];setInterval(()=>{},1000);await import(${JSON.stringify(cliUrl.href)});`],
  { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined, 'CLI must finish despite an active timer');
  assert.equal(child.status, expectedStatus);
  if (expectedStatus === 0) assert.equal(JSON.parse(child.stdout.trim()).writes, 0);
}
console.log('✓ Profit weekly calendar, cross-year53, strict backfill and SQL-write guard');
