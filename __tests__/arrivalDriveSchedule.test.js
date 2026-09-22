import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { arrivalDriveTiming, ARRIVAL_DRIVE_DELAY_MS } from '../lib/arrivalDrivePolicy.js';

// Execute the production scheduler with a virtual clock, no filesystem/DB writes.
const text = fs.readFileSync(new URL('../lib/arrivalDriveAuto.js', import.meta.url), 'utf8');
const body = text.slice(text.indexOf('export function startArrivalDriveScheduler')).replace('export ', '');
let now = Date.parse('2026-09-22T00:00:00Z');
let source = { year: '2026', week: '38-2', sha: 'a', uploadedAt: new Date(now).toISOString() };
let config = { enabled: true }, states = {}, commits = 0, timer, watchers = [], globalState = {};
const read = key => states[key] || {};
const timing = (s, state) => arrivalDriveTiming(s, state, now);
const run = async () => { if (config.enabled && timing(source, read(source.sha)).ready) { commits++; states[source.sha] = { status: 'complete' }; } };
const start = new Function('global','process','fs','path','dir','setTimeout','clearTimeout','Date','runArrivalDriveAuto','arrivalDriveConfig','selectArrivalDriveCandidates','listVisible','actor','arrivalDriveTiming','read','stateFile', `${body}; return startArrivalDriveScheduler;`)(
  globalState, { env: { NODE_ENV: 'production', DB_SERVER: 'fixture' }, cwd: () => '/fixture' },
  { mkdirSync() {}, watch(folder, cb) { watchers.push(cb); return { on() {}, unref() {} }; } }, path,
  () => '/fixture/config', (fn, delay) => (timer = { fn, delay, unref() {} }), () => { timer = null; }, { now: () => now },
  run, () => config, () => [source], () => [], {}, timing, read, s => s.sha);
const fire = async () => { const current = timer; timer = null; await current.fn(); };
start(); await fire();
assert.equal(commits, 0); assert.equal(timer.delay, ARRIVAL_DRIVE_DELAY_MS);
now += ARRIVAL_DRIVE_DELAY_MS - 1; await fire();
assert.equal(commits, 0); // Even early timer delivery cannot save.
now++; await fire(); assert.equal(commits, 1); assert.equal(timer, null);
watchers[0]('change', 'index.jsonl'); await fire(); assert.equal(commits, 1); assert.equal(timer, null);
source = { ...source, sha: 'b', uploadedAt: new Date(now).toISOString() };
watchers[0]('change', 'index.jsonl'); await fire(); assert.equal(timer.delay, ARRIVAL_DRIVE_DELAY_MS);
config = { enabled: false }; watchers[1]('rename', 'config.json'); await fire(); assert.equal(timer, null);
now += ARRIVAL_DRIVE_DELAY_MS;
config = { enabled: true }; watchers[1]('rename', 'config.json'); await fire(); assert.equal(commits, 2);
assert.equal(timer, null);
assert.equal(watchers.length, 2); start(); assert.equal(watchers.length, 2);
// Due time is persisted in source metadata, not reset to restart time.
assert.equal(timing(source, {}).ready, true);
console.log('arrival drive schedule: 24h boundary, event wake, new version, disabled, dedup and restored deadline passed');

// Exercise the actual worker's gate: before due, no source download, SQL, or save.
const workerBody = text.slice(text.indexOf('export async function runArrivalDriveAuto'), text.indexOf('export function startArrivalDriveScheduler')).replace('export ', '');
let queries = 0, saves = 0, downloads = 0, workerState = {};
const worker = new Function('global','arrivalDriveConfig','selectArrivalDriveCandidates','listVisible','actor','read','stateFile','arrivalDriveTiming','write','getFile','fs','crypto','query','scopeArrivalDriveRows','parseArrivalCostWorkbook','loadMappings','createArrivalCostImport', `${workerBody}; return runArrivalDriveAuto;`)(
  {}, () => config, () => [source], () => [], {}, () => workerState, s => s.sha, timing,
  (_, s) => { workerState = s; }, () => { downloads++; return { abs: 'fixture' }; }, { readFileSync: () => Buffer.from('fixture') },
  { createHash: () => ({ update: () => ({ digest: () => source.sha }) }) },
  async () => { queries++; return { recordset: [] }; }, p => p, () => ({ rows: [], unmatchedCount: 0 }), () => ({}),
  async () => { saves++; return { importKey: 1 }; });
source = { ...source, uploadedAt: new Date(now).toISOString() };
await worker(); assert.equal(downloads, 0); assert.equal(queries, 0); assert.equal(saves, 0);
now += ARRIVAL_DRIVE_DELAY_MS;
await worker(); assert.equal(downloads, 1); assert.equal(queries, 2); assert.equal(saves, 1);
await worker(); assert.equal(saves, 1);
console.log('arrival drive actual worker: no download/SQL/save before 24h, one save when due passed');
