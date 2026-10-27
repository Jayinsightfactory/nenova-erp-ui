import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProfitWeeklyRunner, profitWeeklySchedulerEnabled, startProfitReportWeeklyScheduler } from '../lib/profitReportWeeklyScheduler.js';
const rows = Array.from({ length: 28 }, (_, i) => ({ dateOnly: new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10), orderYearWeek: `2026${42 + Math.floor(i / 7)}` }));
const normal = { NODE_ENV: 'production', DB_SERVER: 'test-server', NEXT_RUNTIME: 'nodejs' };
assert.equal(profitWeeklySchedulerEnabled(normal), true);
let timers = 0;
for (const env of [{ ...normal, NODE_ENV: 'test' }, { ...normal, NODE_ENV: 'development' }, { ...normal, NEXT_RUNTIME: 'edge' }, { ...normal, NEXT_PHASE: 'phase-production-build' }, { ...normal, npm_lifecycle_event: 'build' }, { ...normal, npm_lifecycle_script: 'next build' }, { ...normal, DB_SERVER: '' }, { ...normal, PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED: '1' }]) {
  assert.equal(profitWeeklySchedulerEnabled(env), false);
  assert.equal(startProfitReportWeeklyScheduler({ env, timers: { setTimeout() { timers++; } } }), null);
}
assert.equal(timers, 0);
const source = fs.readFileSync(new URL('../instrumentation.js', import.meta.url), 'utf8');
assert.match(source, /NEXT_PHASE !== 'phase-production-build'/);
assert.match(source, /startSalesSnapshotScheduler/);
assert.match(source, /startArrivalDriveScheduler/);
let now = '2026-10-30T00:00:00Z'; let saves = 0; let calendars = 0;
const runner = createProfitWeeklyRunner({ now: () => now, loadCalendar: async date => { calendars++; assert.ok(['2026-10-28', '2026-11-04'].includes(date)); return rows; }, save: async data => { saves++; assert.equal(data.major, saves === 1 ? '43' : '44'); return { action: 'saved' }; } });
assert.equal((await runner()).target.major, '43');
assert.equal((await runner()).reason, 'completed_slot');
assert.equal(calendars, 1); assert.equal(saves, 1);
now = '2026-11-03T21:00:00Z'; await runner(); assert.equal(saves, 2);
let retries = 0;
const retry = createProfitWeeklyRunner({ now: () => '2026-10-30T00:00:00Z', loadCalendar: async () => rows, save: async () => { if (!retries++) throw Error('failed'); return { action: 'saved' }; } });
await assert.rejects(retry); assert.equal((await retry()).action, 'saved'); assert.equal(retries, 2);
let unlock;
const deferred = new Promise(resolve => { unlock = resolve; });
const concurrent = createProfitWeeklyRunner({ now: () => '2026-10-30T00:00:00Z', loadCalendar: async () => rows, save: async () => { await deferred; return { action: 'saved' }; } });
const first = concurrent(); assert.equal((await concurrent()).reason, 'running'); unlock(); await first;
for (const reason of ['confirmed', 'schedule_duplicate', 'existing_policy_cache']) {
  let n = 0;
  const skipped = createProfitWeeklyRunner({ now: () => '2026-10-30T00:00:00Z', loadCalendar: async () => rows, save: async () => { n++; return { action: 'skipped', reason }; } });
  await skipped(); await skipped(); assert.equal(n, 1);
}
let persisted = false; let dbWrites = 0;
const service = async () => { if (persisted) return { action: 'skipped', reason: 'schedule_duplicate' }; persisted = true; dbWrites++; return { action: 'saved' }; };
const options = { now: () => '2026-10-30T00:00:00Z', loadCalendar: async () => rows, save: service };
await Promise.all([createProfitWeeklyRunner(options)(), createProfitWeeklyRunner(options)()]);
assert.equal(dbWrites, 1, 'separate workers rely on shared atomic save service, not process-only marker');
let busyCalls = 0;
const busy = createProfitWeeklyRunner({ ...options, save: async () => { busyCalls++; return { action: 'busy' }; } });
await busy(); await busy(); assert.equal(busyCalls, 2);
console.log('✓ Profit weekly runner: no build/dev/edge timers, fixed-slot catchup, retries and shared-service idempotency');
