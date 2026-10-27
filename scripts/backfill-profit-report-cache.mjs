// Explicit operator operation only. No invocation on import; dry-run opens no SQL connection.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { kstDateOnly, loadProfitReportCalendar, resolveCurrentProfitWeek } from '../lib/profitReportWeeklySchedule.js';

export function parseBackfillArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === '--apply') { if (values.apply) throw Error('duplicate --apply'); values.apply = true; continue; }
    if (!['--year', '--from', '--to', '--pause', '--report'].includes(key) || values[key] != null || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('invalid arguments');
    values[key] = args[++i];
  }
  if (!/^20\d{2}$/.test(values['--year'] || '') || !/^\d{1,2}$/.test(values['--from'] || '') || !/^\d{1,2}$/.test(values['--to'] || '')) throw Error('explicit --year/--from/--to required');
  const result = { year: values['--year'], from: Number(values['--from']), to: Number(values['--to']), pauseMs: Number(values['--pause'] ?? 1500), apply: values.apply === true, reportPath: values['--report'] || null };
  if (result.from < 1 || result.to > 53 || result.to < result.from || !Number.isInteger(result.pauseMs) || result.pauseMs < 0 || result.pauseMs > 60000) throw Error('invalid range/pause');
  if (result.apply && !result.reportPath) throw Error('--apply requires --report for per-week results');
  return result;
}

export function assertHistoricalBackfill(options, current) {
  if (Number(options.year) > Number(current.orderYear) || (options.year === current.orderYear && options.to >= Number(current.major))) throw Error('현재·미래 차수는 backfill할 수 없습니다.');
}

export function inspectCacheOnlySql(text) {
  // Remove comments/literals before inspecting SQL verbs; values are never logged.
  const clean = String(text).replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|--[^\r\n]*/g, ' ').replace(/[\[\]]/g, '');
  if (/\b(UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|BULK|DBCC|GRANT|REVOKE|DENY|USE|BACKUP|RESTORE|WRITETEXT|UPDATETEXT)\b/i.test(clean)) throw Error('CACHE_ONLY_SQL_BLOCKED');
  const inserts = [...clean.matchAll(/\bINSERT\b/gi)];
  const allowedInserts = [...clean.matchAll(/\bINSERT\s+(?:INTO\s+)?(?:dbo\.)?WebProfitReportSnapshot\b/gi)];
  if (inserts.length !== allowedInserts.length || inserts.length > 1) throw Error('CACHE_ONLY_SQL_BLOCKED');
  const execs = [...clean.matchAll(/\bEXEC(?:UTE)?\b/gi)];
  const allowedExecs = [...clean.matchAll(/\bEXEC(?:UTE)?\s+(?:@\w+\s*=\s*)?(?:sys\.|dbo\.)?sp_(?:getapplock|releaseapplock)\b/gi)];
  if (execs.length !== allowedExecs.length || /\bINTO\b/i.test(clean.replace(/\bINSERT\s+INTO\s+(?:dbo\.)?WebProfitReportSnapshot\b/gi, ''))) throw Error('CACHE_ONLY_SQL_BLOCKED');
  // sourceWorkbookFx reads an optional table via IF OBJECT_ID(N'...',N'U')
  // IS NOT NULL SELECT. Literals above become whitespace (their N prefix remains).
  // Allow only this conditional read shape: no INSERT or EXEC anywhere in it.
  const optionalTableRead = inserts.length === 0 && execs.length === 0
    && /^\s*IF\s+OBJECT_ID\s*\(\s*N?\s*,\s*N?\s*\)\s+IS\s+NOT\s+NULL\s+SELECT\b/i.test(clean);
  if (!/^\s*(SELECT|WITH|DECLARE|SET|EXEC|INSERT)\b/i.test(clean) && !optionalTableRead) throw Error('CACHE_ONLY_SQL_BLOCKED');
  return { insertAttempts: inserts.length, appLockCalls: allowedExecs.length };
}

export function createCacheSqlGuard(stats) {
  return text => {
    try {
      // A helper must not swallow a blocked write and persist its fallback result.
      if (stats.blocked > 0) throw Error('CACHE_ONLY_SQL_BLOCKED');
      const observation = inspectCacheOnlySql(text);
      stats.queries += 1;
      stats.insertAttempts += observation.insertAttempts;
      stats.appLockCalls += observation.appLockCalls;
    } catch (error) {
      stats.blocked += 1;
      throw Object.assign(error, { code: 'CACHE_ONLY_SQL_BLOCKED' });
    }
  };
}

export async function runBackfill(options, { current, save, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), onProgress = () => {} }) {
  assertHistoricalBackfill(options, current);
  const results = [];
  for (let m = options.from; m <= options.to; m += 1) {
    const major = String(m).padStart(2, '0');
    const start = Date.now();
    try {
      const result = await save({ orderYear: options.year, major, reason: 'BACKFILL', actor: 'explicit-backfill' });
      if (!['saved', 'skipped'].includes(result?.action) || (result.action === 'skipped' && !['confirmed', 'existing_policy_cache', 'schedule_duplicate'].includes(result.reason))) throw Error('CACHE_SAVE_NOT_COMPLETE');
      results.push({ orderYear: options.year, major, action: result.action, reason: result.reason || null, elapsedMs: Date.now() - start, snapKey: result.snapshot?.snapKey ?? null });
    } catch (error) {
      results.push({ orderYear: options.year, major, action: 'failed', code: String(error?.code || 'CACHE_SAVE_FAILED'), elapsedMs: Date.now() - start });
      await onProgress(results);
      return { results, failed: true, partialSuccess: results.some(row => row.action === 'saved') };
    }
    await onProgress(results);
    if (m < options.to) await pause(options.pauseMs);
  }
  return { results, failed: false, partialSuccess: false };
}

async function main() {
  const options = parseBackfillArgs(process.argv.slice(2));
  if (!options.apply) {
    console.log(JSON.stringify({ mode: 'dry-run', ...options, writes: 0, note: 'No DB connection; calendar/schema checks occur only with explicit --apply.' }));
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const reportPath = path.resolve(root, options.reportPath);
  if (fs.existsSync(reportPath)) throw Error('Report already exists; choose a new --report path.');
  if (!fs.existsSync(path.dirname(reportPath))) throw Error('Report parent directory does not exist.');
  const report = { startedAt: new Date().toISOString(), scope: { orderYear: options.year, from: options.from, to: options.to }, status: 'starting', sql: { queries: 0, insertAttempts: 0, appLockCalls: 0, blocked: 0, allowedWriteTable: 'WebProfitReportSnapshot' }, results: [] };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.env.PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED = '1';
  const envFile = path.join(root, '.env.local');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  register('data:text/javascript,' + encodeURIComponent(`
    import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
    export async function resolve(spec, ctx, next) { try { return await next(spec,ctx); } catch(e) { if(spec.startsWith('.')) for(const ext of ['.js','/index.js']) { try { return await next(spec+ext,ctx); } catch {} } throw e; } }
    export async function load(url,ctx,next) { if(url.endsWith('.json')) return {format:'json',source:fs.readFileSync(fileURLToPath(url)),shortCircuit:true}; return next(url,ctx); }
  `));
  const { sql, query } = await import('../lib/db.js');
  const originalQuery = sql.Request.prototype.query;
  const originalBatch = sql.Request.prototype.batch;
  const originalExecute = sql.Request.prototype.execute;
  const guard = createCacheSqlGuard(report.sql);
  sql.Request.prototype.query = function guarded(text, ...args) {
    guard(text);
    return originalQuery.call(this, text, ...args);
  };
  sql.Request.prototype.execute = sql.Request.prototype.batch = () => { report.sql.blocked += 1; throw Object.assign(Error('CACHE_ONLY_SQL_BLOCKED'), { code: 'CACHE_ONLY_SQL_BLOCKED' }); };
  try {
    const schema = await query("SELECT OBJECT_ID(N'dbo.WebProfitReportSnapshot',N'U') AS SnapshotId, OBJECT_ID(N'dbo.WebProfitReportConfirm',N'U') AS ConfirmId, OBJECT_ID(N'dbo.WebProfitReportConfirmDetail',N'U') AS DetailId");
    if (!schema.recordset?.[0]?.SnapshotId || !schema.recordset[0].ConfirmId || !schema.recordset[0].DetailId) throw Error('Existing report-cache schema required; no automatic migration.');
    const today = kstDateOnly();
    const current = resolveCurrentProfitWeek(await loadProfitReportCalendar(today), today);
    assertHistoricalBackfill(options, current);
    const { saveProfitReportCache } = await import('../pages/api/sales/profit-report.js');
    report.status = 'running'; report.current = current; persist();
    const result = await runBackfill(options, { current, save: saveProfitReportCache, onProgress: rows => {
      report.results = rows; persist();
      console.log(JSON.stringify(rows.at(-1)));
    } });
    Object.assign(report, result, { status: result.failed ? 'failed' : 'complete' });
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    report.status = 'failed'; report.errorCode = String(error?.code || 'BACKFILL_FAILED'); process.exitCode = 1;
    console.error('Backfill stopped; inspect the scoped JSON report.');
  } finally {
    report.finishedAt = new Date().toISOString(); persist();
    sql.Request.prototype.query = originalQuery; sql.Request.prototype.batch = originalBatch; sql.Request.prototype.execute = originalExecute;
    await sql.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The report API imports legacy timers. Exit this CLI only after main's report
  // persistence and awaited DB close finish; ordinary module imports never exit.
  main().then(() => process.exit(process.exitCode || 0)).catch(() => {
    console.error('Backfill argument/setup failure; no success claimed.');
    process.exit(1);
  });
}
