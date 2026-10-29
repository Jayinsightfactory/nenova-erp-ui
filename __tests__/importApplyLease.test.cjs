const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { acquireImportApplyLease, withImportApplyLease } = require('../lib/importApplyLease.cjs');

test('lease wrapper preserves explicit year and result; errors propagate', async () => {
  for (const year of ['2025', '2026']) {
    const input = { year, week: '44-01', custKey: 1, prodKey: 2, uploadQty: 0 };
    assert.equal(await withImportApplyLease(async () => input, { enabled: false }), input);
  }
  await assert.rejects(withImportApplyLease(async () => { throw new Error('rollback'); }, { enabled: false }), /rollback/);
});

test('real Linux leases block deployment until every import finishes, and gate blocks new writes', { skip: process.platform !== 'linux' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-lease-'));
  const lockPath = path.join(dir, 'apply.lock');
  const opts = { enabled: true, lockPath };
  const exclusive = () => spawnSync('flock', ['-xn', lockPath, 'true']).status;
  let release1, release2, gate;
  try {
    release1 = acquireImportApplyLease(opts);
    release2 = acquireImportApplyLease(opts);
    assert.equal(exclusive(), 1, 'flock child exit does not release parent descriptor lease');
    release1(); release1();
    assert.equal(exclusive(), 1, 'second import still protects server');
    gate = fs.openSync(`${lockPath}.gate`, 'a');
    assert.equal(spawnSync('flock', ['-xn', '3'], { stdio: ['ignore', 'ignore', 'ignore', gate] }).status, 0);
    let writes = 0;
    await assert.rejects(withImportApplyLease(() => { writes++; }, opts), { code: 'IMPORT_DEPLOY_BUSY' });
    assert.equal(writes, 0);
    assert.equal(exclusive(), 1, 'admission rejection does not release an existing import');
    release2();
    assert.equal(exclusive(), 0);
    fs.closeSync(gate); gate = undefined;
    await assert.rejects(withImportApplyLease(async () => { throw new Error('rollback'); }, opts), /rollback/);
    assert.equal(exclusive(), 0, 'exception releases lease');
    await withImportApplyLease(async () => assert.equal(exclusive(), 1), opts);
    assert.equal(exclusive(), 0, 'successful audit/readback releases lease');
  } finally {
    release1?.(); release2?.();
    if (gate !== undefined) fs.closeSync(gate);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lease creation failure fails closed before business work', async () => {
  let called = false;
  await assert.rejects(withImportApplyLease(() => { called = true; }, { enabled: true, lockPath: '/dev/null/impossible' }), { code: 'IMPORT_DEPLOY_BUSY' });
  assert.equal(called, false);
});

test('production deploy takes admission then exclusive lease before stopping or swapping server', () => {
  const source = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  const gate = source.indexOf('flock --exclusive --timeout 10 8');
  const drain = source.indexOf('flock --exclusive --timeout 1200 9');
  assert(gate > 0 && drain > gate);
  assert(drain < source.indexOf('pm2 stop nenova-erp'));
  assert(drain < source.indexOf('mv .next .next-previous'));
  assert(source.includes('IMPORT_DRAIN_TIMEOUT: existing app preserved'));
  assert(source.includes('pm2 reload nenova-erp --update-env 8>&- 9>&-'));
  assert(source.includes("trap 'flock --unlock 9; exec 9>&-; flock --unlock 8; exec 8>&-' EXIT"));
  const core = fs.readFileSync('lib/shipmentImport.js', 'utf8');
  assert(core.includes('return withImportApplyLease(() => applyImportRowsLeased(args));'));
});
