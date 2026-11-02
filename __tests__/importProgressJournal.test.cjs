const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { createImportProgressJournal } = require('../lib/importProgressJournal.cjs');
const jobId = 'apply_restart_fixture_123';
function temporary(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-progress-'));
  return Promise.resolve().then(() => work(directory)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}
function progress(year = '2026') {
  return { year, week: '44-01', total: 750, done: 0, stage: '준비', startedAt: 1000, updatedAt: 1000,
    finished: false, failed: false, auditKey: 137 };
}

test('completed aggregate results survive a fresh worker, preserve zero, exclude private row data', () => temporary(directory => {
  const first = createImportProgressJournal({ directory });
  assert.equal(first.create(jobId, 'owner-secret', progress()), true);
  first.save(jobId, 'owner-secret', { ...progress(), finished: true,
    current: 'CUSTOMER-SECRET', logs: ['FILE-SECRET'], result: { success: true, appliedCount: 0,
      skippedNoChangeCount: 750, sourceFileName: 'FILE-SECRET', appliedRows: [{ custName: 'CUSTOMER-SECRET' }],
      auditBatchKey: 137, verification: { checked: 750, matched: 750, mismatchCount: 0 } } });
  const second = createImportProgressJournal({ directory });
  const restored = second.get(jobId, 'owner-secret');
  assert.equal(restored.result.success, true);
  assert.equal(restored.result.appliedCount, 0);
  assert.equal(restored.result.verification.checked, 750);
  assert.deepEqual(restored.result.appliedRows, []);
  const disk = fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8');
  for (const secret of ['owner-secret', 'CUSTOMER-SECRET', 'FILE-SECRET']) assert(!disk.includes(secret));
  assert.equal(second.get(jobId, 'other-owner'), null);
  assert.equal(second.create(jobId, 'other-owner', progress()), false);
  first.save(jobId, 'owner-secret', { ...progress(), finished: true, failed: true, error: { code: 'ESOCKET' } });
  assert.equal(second.get(jobId, 'owner-secret').result.success, true, 'late response failure cannot overwrite success');
}));

test('unknown worker, terminal failure, corruption and unavailable storage fail closed', () => temporary(directory => {
  const journal = createImportProgressJournal({ directory, alive: () => false });
  journal.create(jobId, 'owner', progress());
  assert.equal(journal.get(jobId, 'owner').workerAlive, false);
  journal.save(jobId, 'owner', { ...progress(), finished: true, failed: true, error: { code: 'QTY_WARNING', message: 'PRIVATE-NAME' } });
  assert.equal(journal.get(jobId, 'owner').error.code, 'QTY_WARNING');
  const file = path.join(directory, fs.readdirSync(directory)[0]);
  assert(!fs.readFileSync(file, 'utf8').includes('PRIVATE-NAME'));
  fs.writeFileSync(file, '{');
  assert.throws(() => journal.get(jobId, 'owner'), { code: 'IMPORT_PROGRESS_STORAGE' });
  const unavailable = createImportProgressJournal({ directory: file });
  assert.throws(() => unavailable.create('new-job', 'owner', progress()), { code: 'IMPORT_PROGRESS_STORAGE' });
}));

test('dead worker audit recovery is SELECT-only, scoped and never calls a commit-only record complete', async () => {
  const { recoverImportProgress } = await import('../lib/importProgressRecovery.js');
  for (const year of ['2025', '2026']) {
    const record = { ...progress(year), workerAlive: false };
    for (const status of ['SUCCESS', 'SUCCESS_WITH_WARNINGS', 'STARTED', 'FAILED', null]) {
      let reads = 0;
      const result = await recoverImportProgress(record, 'owner', async scope => {
        reads++;
        assert.deepEqual(scope, { auditKey: 137, owner: 'owner', year, week: '44-01' });
        return status ? { AuditStatus: status } : null;
      });
      assert.equal(reads, 1);
      assert.equal(result.result.success, false);
      assert.equal(result.outcomeUnknown, true);
      assert.equal(result.committed, ['SUCCESS', 'SUCCESS_WITH_WARNINGS'].includes(status));
    }
  }
  for (const record of [{ ...progress(), workerAlive: true }, { ...progress(), finished: true }]) {
    assert.equal(await recoverImportProgress(record, 'owner', () => assert.fail('not orphaned')), record);
  }
  assert.equal((await recoverImportProgress({ ...progress(), auditKey: null, workerAlive: false }, 'owner', () => assert.fail('no audit'))).committed, false);
  assert.equal((await recoverImportProgress({ ...progress(), finished: true, error: { code: 'IMPORT_PROGRESS_LOST' } }, 'owner', async () => ({ AuditStatus: 'SUCCESS' }))).committed, true);
});

test('browser refresh restores only job identity; another user and newer pending work are isolated', async () => {
  const { importPendingKey, readPendingImport, savePendingImport, clearPendingImport } = await import('../lib/importApplyClient.js');
  const values = new Map();
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const key = await importPendingKey('owner-secret', webcrypto);
  const otherKey = await importPendingKey('other-owner', webcrypto);
  assert(!key.includes('owner-secret'));
  savePendingImport(storage, key, { jobId, year: 2026, week: '44-01', sourceFileName: 'PRIVATE', token: 'SECRET' });
  assert.deepEqual(readPendingImport(storage, key), { jobId, year: '2026', week: '44-01' });
  assert.equal(readPendingImport(storage, otherKey), null);
  assert.throws(() => savePendingImport(storage, key, { jobId: `${jobId}_2`, year: 2026, week: '44-01' }));
  clearPendingImport(storage, key, 'unrelated');
  assert(readPendingImport(storage, key));
  clearPendingImport(storage, key, jobId);
  assert.equal(readPendingImport(storage, key), null);
  storage.setItem(key, '{}');
  assert.throws(() => readPendingImport(storage, key));
});

test('API rejection and duplicate job must not finish or overwrite an existing operation', async () => {
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  const source = fs.readFileSync('pages/api/shipment/distribute-import-apply.js', 'utf8');
  const transformed = await swc.transform(source, { filename: 'apply.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } });
  let allowed = true, claimed = true, applied = 0, finished = 0, applyError = null, storageError = null;
  const mocks = {
    auth: { withAuth: f => f }, withActionLog: { withActionLog: f => f },
    shipmentImport: { applyImportRows: async () => { applied++; if (applyError) throw applyError; return { success: true }; } },
    weekdayEarlyShipmentImport: { requireEarlyImportMode: () => 'ORIGINAL_INCLUDES_EARLY' },
    'shipmentReplacementPlan.js': { assertReplacementPlan: () => { if (!allowed) throw Object.assign(new Error('stale'), { statusCode: 409 }); } },
    importApplyProgress: { initApplyProgress: () => { if (storageError) throw storageError; return claimed; }, progressStep: () => {}, finishApplyProgress: () => { finished++; } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(transformed.code, { module: mod, exports: mod.exports, require: name => {
    const value = mocks[name.split('/').pop()]; if (!value) throw Error(name); return value;
  } });
  const req = { method: 'POST', user: { userId: 'owner' }, body: { jobId, year: '2026', week: '44-01', earlyLedgerFingerprint: 'fp', rows: [{ earlyLedgerFingerprint: 'fp' }] } };
  const res = { status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
  allowed = false; await mod.exports.default(req, res);
  assert.equal(finished, 0); assert.equal(applied, 0);
  allowed = true; claimed = false; await mod.exports.default(req, res);
  assert.equal(res.body.code, 'JOB_ID_EXISTS'); assert.equal(finished, 0); assert.equal(applied, 0);
  claimed = true; await mod.exports.default(req, res);
  assert.equal(applied, 1); assert.equal(finished, 1);
  storageError = Object.assign(new Error('storage'), { code: 'IMPORT_PROGRESS_STORAGE', statusCode: 503 });
  await mod.exports.default(req, res);
  assert.equal(applied, 1); assert.equal(finished, 1); assert.equal(res.statusCode, 503);
  storageError = null;
  applyError = Object.assign(new Error('lost commit response'), { code: 'ESOCKET' });
  await mod.exports.default(req, res);
  assert.equal(res.body.outcomeUnknown, true); assert.equal(res.body.code, 'IMPORT_PROGRESS_LOST');
  applyError.transactionRolledBack = true;
  await mod.exports.default(req, res);
  assert.equal(res.body.outcomeUnknown, false); assert.equal(res.body.code, 'ESOCKET');
});

test('journal survives a real worker exit; unfinished work is identified without being restarted', () => temporary(async directory => {
  const { spawnSync } = require('node:child_process');
  const child = spawnSync(process.execPath, ['-e', `
    const {createImportProgressJournal}=require(${JSON.stringify(require.resolve('../lib/importProgressJournal.cjs'))});
    const journal=createImportProgressJournal({directory:process.argv[1]});
    journal.create('real_worker_test', 'owner', {year:'2026',week:'44-01',total:750,done:749,finished:false,startedAt:1,updatedAt:2,auditKey:137});
  `, directory], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  const restored = createImportProgressJournal({ directory }).get('real_worker_test', 'owner');
  assert.equal(restored.done, 749); assert.equal(restored.workerAlive, false);
  assert.equal(restored.finished, false);
}));

test('active progress remains visible beyond 30 minutes while old terminal memory is pruned', async () => {
  const api = await import('../lib/importApplyProgress.js');
  assert(api.initApplyProgress('long_running_test', 750, 'owner'));
  global._importApplyProgress.get('long_running_test').updatedAt = Date.now() - 2 * 60 * 60 * 1000;
  assert.equal(api.getApplyProgress('long_running_test', 'owner').finished, false);
  api.finishApplyProgress('long_running_test', { result: { success: true } });
  api.finishApplyProgress('long_running_test', { failed: true, error: { code: 'ESOCKET' } });
  assert.equal(api.getApplyProgress('long_running_test', 'owner').result.success, true);
  global._importApplyProgress.get('long_running_test').updatedAt = Date.now() - 2 * 60 * 60 * 1000;
  assert.equal(api.getApplyProgress('long_running_test', 'owner'), null);
});

test('750-row job progresses past 12 minutes and terminal result clears only its pending key', async () => {
  const { waitForImportResult } = await import('../lib/importApplyClient.js');
  let now = 0, calls = 0;
  const result = await waitForImportResult({ jobId, year: '2026', week: '44-01', now: () => now,
    delay: async () => { now += 1200; }, fetchFn: async (_url, options) => {
      assert.equal(options.method, undefined);
      calls++;
      return { ok: true, status: 200, json: async () => ({ progress: { year: '2026', week: '44-01', total: 750,
        done: Math.min(calls, 750), updatedAt: now, finished: calls > 750,
        ...(calls > 750 ? { result: { success: true, appliedCount: 750 } } : {}) } }) };
    } });
  assert(now > 12 * 60 * 1000); assert.equal(result.appliedCount, 750); assert.equal(calls, 751);
});
