const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const carries = require('../lib/weekdayCarryoverStore.js');

const identity = { year: 2026, majorWeek: '38', custKey: 7, prodKey: 101 };
const scope = { year: 2026, majorWeek: '38', custKey: 7 };
const context = { startDate: '2026-09-17' };
const input = (changes = {}) => ({ ...identity, unit: '박스', quantity: 5, reason: '마감 확인', expectedRevision: 0, ...changes });
const code = expected => error => error instanceof carries.WeekdayCarryoverError && error.code === expected;

async function temporary(run) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weekday-carryover-store-test-'));
  try { await run(directory); }
  finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}weekday-carryover-store-test-`));
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
}

async function child(directory, payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [__filename, '--carryover-child', directory,
      Buffer.from(JSON.stringify(payload)).toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', chunk => { out += chunk; });
    proc.stderr.on('data', chunk => { err += chunk; });
    proc.on('error', reject);
    proc.on('exit', status => status === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
}

if (process.argv[2] === '--carryover-child') {
  carries.createWeekdayCarryoverStore({ directory: process.argv[3] })
    .save(JSON.parse(Buffer.from(process.argv[4], 'base64').toString()), 'child', context)
    .then(record => process.stdout.write(JSON.stringify({ revision: record.revision })))
    .catch(error => process.stdout.write(JSON.stringify({ code: error.code })));
} else {
  test('carryover exact input schema rejects hidden scope/actor/calendar/revision fields and coercion', () => {
    assert.deepEqual(carries.normalizeCarryoverInput(input()), input());
    assert.deepEqual(carries.normalizeCarryoverScope({ year: '2026', majorWeek: '38', custKey: '7' }, { query: true }), scope);
    for (const patch of [{ year: '2026' }, { year: false }, { year: 1999 }, { year: 2201 },
      { majorWeek: '8' }, { majorWeek: '00' }, { majorWeek: '54' }, { majorWeek: ['38'] },
      { custKey: 0 }, { custKey: '7' }, { prodKey: '../101' }, { prodKey: 2147483648 },
      { unit: 'BOX' }, { unit: null }, { quantity: '0' }, { quantity: null }, { quantity: false },
      { quantity: NaN }, { quantity: Infinity }, { quantity: Number.MAX_SAFE_INTEGER + 1 },
      { reason: '' }, { reason: ' padded' }, { reason: 'x'.repeat(1001) }, { reason: 'bad\0' },
      { expectedRevision: -1 }, { expectedRevision: '0' }, { expectedRevision: null }, { expectedRevision: false },
      { startDate: context.startDate }, { updatedBy: 'admin' }, { history: [] }, { extra: 1 }]) {
      assert.throws(() => carries.normalizeCarryoverInput(input(patch)), carries.WeekdayCarryoverError);
    }
    for (const field of Object.keys(input())) {
      const missing = input(); delete missing[field];
      assert.throws(() => carries.normalizeCarryoverInput(missing), code('INVALID_FIELDS'));
    }
    for (const value of [null, undefined, [], 0]) assert.throws(() => carries.normalizeCarryoverInput(value), carries.WeekdayCarryoverError);
  });

  test('explicit zero and negative closing values survive full audit history, reload and digest', async () => temporary(async directory => {
    let count = 0;
    const store = carries.createWeekdayCarryoverStore({ directory, now: () => new Date(1760000000000 + count++ * 1000) });
    assert.equal(await store.get(identity), null);
    assert.deepEqual(await store.listCustomer(7), []);
    const first = await store.save(input(), 'staff', context);
    const zero = await store.save(input({ expectedRevision: 1, quantity: 0, reason: '소진 확인' }), 'staff2', context);
    const negative = await store.save(input({ expectedRevision: 2, quantity: -2.75, reason: '부족 확인' }), 'staff3', context);
    assert.equal(first.quantity, 5); assert.equal(zero.quantity, 0); assert.equal(negative.quantity, -2.75);
    assert.deepEqual(negative.history.map(({ before, after, reason, actor, revision }) => ({ before, after, reason, actor, revision })), [
      { before: null, after: 5, reason: '마감 확인', actor: 'staff', revision: 1 },
      { before: 5, after: 0, reason: '소진 확인', actor: 'staff2', revision: 2 },
      { before: 0, after: -2.75, reason: '부족 확인', actor: 'staff3', revision: 3 },
    ]);
    assert.equal(negative.updatedAt, negative.history[2].timestamp);
    assert.equal(negative.updatedBy, 'staff3'); assert.equal(negative.startDate, context.startDate);
    assert.deepEqual(await carries.createWeekdayCarryoverStore({ directory }).get(identity), negative);
    assert.deepEqual(await store.list(scope), [negative]);
    const envelope = JSON.parse(await fs.promises.readFile(path.join(directory, '2026_38_7_101.json'), 'utf8'));
    assert.deepEqual(Object.keys(envelope).sort(), ['digest', 'record']);
    assert.equal(envelope.digest, carries.carryoverDigest(negative));
    assert.equal(carries.normalizeCarryoverInput(input({ quantity: -0 })).quantity, 0);
  }));

  test('customer listing isolates same week across years, customers/products and ordered anchors', async () => temporary(async directory => {
    const store = carries.createWeekdayCarryoverStore({ directory });
    for (const [patch, startDate] of [[{}, context.startDate], [{ prodKey: 2 }, context.startDate],
      [{ year: 2025 }, '2025-09-18'], [{ custKey: 8 }, context.startDate], [{ majorWeek: '39' }, '2026-09-24']]) {
      await store.save(input(patch), 'staff', { startDate });
    }
    assert.deepEqual((await store.list(scope)).map(record => record.prodKey), [2, 101]);
    assert.equal((await store.listCustomer(7)).length, 4);
    assert.deepEqual((await store.listCustomer(8)).map(record => record.custKey), [8]);
    // Another customer's corruption must not block or expose this customer's list.
    await fs.promises.writeFile(path.join(directory, '2026_38_8_101.json'), '{corrupt');
    assert.equal((await store.listCustomer(7)).length, 4);
    await assert.rejects(store.listCustomer(8), code('CARRYOVER_STORAGE_CORRUPT'));
    await assert.rejects(store.listCustomer('7'), code('INVALID_INPUT'));
  }));

  test('revision CAS, immutable unit/anchor and mandatory authenticated server injection', async () => temporary(async directory => {
    const store = carries.createWeekdayCarryoverStore({ directory });
    const first = await store.save(input(), 'staff', context);
    for (const expectedRevision of [0, 2]) {
      await assert.rejects(store.save(input({ expectedRevision }), 'staff', context), error => code('REVISION_CONFLICT')(error) && error.currentRevision === 1);
    }
    for (const user of ['', undefined, null, false, ' staff', 'staff\0']) await assert.rejects(store.save(input({ expectedRevision: 1 }), user, context), code('UNAUTHENTICATED'));
    for (const server of [undefined, {}, { startDate: '2026-09-18' }, { startDate: '2026-02-30' }, { ...context, custKey: 8 }]) {
      await assert.rejects(store.save(input({ expectedRevision: 1 }), 'staff', server), carries.WeekdayCarryoverError);
    }
    await assert.rejects(store.save(input({ expectedRevision: 1, unit: '단' }), 'staff', context), code('CARRYOVER_IDENTITY_CHANGED'));
    await assert.rejects(store.save(input({ expectedRevision: 1 }), 'staff', { startDate: '2026-09-24' }), code('CARRYOVER_IDENTITY_CHANGED'));
    assert.deepEqual(await store.get(identity), first);
  }));

  test('concurrent process-local and cross-process writers append exactly one revision/history', async () => temporary(async directory => {
    const writers = Array.from({ length: 6 }, () => carries.createWeekdayCarryoverStore({ directory }));
    const local = await Promise.allSettled(writers.map(store => store.save(input(), 'staff', context)));
    assert.equal(local.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(local.filter(result => result.status === 'rejected').every(result => result.reason.code === 'REVISION_CONFLICT'));
    const remote = await Promise.all(Array.from({ length: 5 }, () => child(directory, input({ expectedRevision: 1, quantity: 0 }))));
    assert.equal(remote.filter(result => result.revision === 2).length, 1);
    assert.equal(remote.filter(result => result.code === 'REVISION_CONFLICT').length, 4);
    const saved = await writers[0].get(identity);
    assert.equal(saved.history.length, 2); assert.equal(saved.quantity, 0);
    assert.deepEqual(await fs.promises.readdir(directory), ['2026_38_7_101.json']);
  }));

  test('owned wx lock is never stolen or removed on timeout', async () => temporary(async directory => {
    const lock = path.join(directory, '2026_38_7_101.json.lock');
    await fs.promises.writeFile(lock, 'other-owner', { flag: 'wx' });
    const store = carries.createWeekdayCarryoverStore({ directory, lockTimeoutMs: 15, lockRetryMs: 5 });
    await assert.rejects(store.save(input(), 'staff', context), code('CARRYOVER_LOCKED'));
    assert.equal(await fs.promises.readFile(lock, 'utf8'), 'other-owner');
    assert.equal(await store.get(identity), null);
  }));

  test('history chain, exact record/envelope, digest/identity and oversized corruption fail closed', async () => temporary(async directory => {
    const store = carries.createWeekdayCarryoverStore({ directory });
    await store.save(input(), 'staff', context);
    const file = path.join(directory, '2026_38_7_101.json');
    const original = await fs.promises.readFile(file, 'utf8');
    const variants = ['{broken', 'x'.repeat(carries.MAX_FILE_BYTES + 1)];
    for (const mutate of [value => { value.record.quantity = 999; }, value => { value.record.extra = 1; },
      value => { value.record.history = []; }, value => { value.record.history[0].before = 0; },
      value => { value.record.history[0].revision = 2; }, value => { value.record.history[0].actor = 'other'; },
      value => { value.record.history[0].timestamp = 'not-a-date'; }, value => { value.extra = 1; },
      value => { value.record.custKey = 8; value.digest = carries.carryoverDigest(value.record); },
      value => { value.record.history[0].reason = 'tampered'; }]) {
      const changed = JSON.parse(original); mutate(changed); variants.push(JSON.stringify(changed));
    }
    for (const serialized of variants) {
      await fs.promises.writeFile(file, serialized);
      await assert.rejects(store.get(identity), code('CARRYOVER_STORAGE_CORRUPT'));
      await assert.rejects(store.listCustomer(7), code('CARRYOVER_STORAGE_CORRUPT'));
      await assert.rejects(store.save(input({ expectedRevision: 1 }), 'staff', context), code('CARRYOVER_STORAGE_CORRUPT'));
      assert.equal(await fs.promises.readFile(file, 'utf8'), serialized);
    }
    await fs.promises.writeFile(file, original);
    for (const target of [file, directory]) {
      const io = { ...fs.promises, lstat: async value => value === target
        ? { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => true, size: 10 } : fs.promises.lstat(value) };
      await assert.rejects(carries.createWeekdayCarryoverStore({ directory, io }).get(identity), code('CARRYOVER_STORAGE_CORRUPT'));
    }
  }));

  test('full history/byte limits reject new save without truncation or changing committed bytes', async () => temporary(async directory => {
    const store = carries.createWeekdayCarryoverStore({ directory, maxHistory: 2 });
    await store.save(input(), 'staff', context);
    const second = await store.save(input({ expectedRevision: 1 }), 'staff', context);
    const file = path.join(directory, '2026_38_7_101.json');
    const before = await fs.promises.readFile(file, 'utf8');
    await assert.rejects(store.save(input({ expectedRevision: 2 }), 'staff', context), code('CARRYOVER_HISTORY_LIMIT'));
    const tiny = carries.createWeekdayCarryoverStore({ directory, maxFileBytes: Buffer.byteLength(before) });
    await assert.rejects(tiny.save(input({ expectedRevision: 2 }), 'staff', context), code('CARRYOVER_HISTORY_LIMIT'));
    assert.equal(await fs.promises.readFile(file, 'utf8'), before); assert.deepEqual(await store.get(identity), second);
  }));

  test('write, fsync and rename failures preserve current value+history atomically and clean owned files', async () => temporary(async directory => {
    const store = carries.createWeekdayCarryoverStore({ directory });
    const first = await store.save(input(), 'staff', context);
    for (const stage of ['writeFile', 'sync', 'rename']) {
      const io = { ...fs.promises,
        ...(stage === 'rename' ? { rename: async () => { throw new Error('injected'); } } : {
          open: async (...args) => {
            const handle = await fs.promises.open(...args);
            if (!String(args[0]).endsWith('.tmp')) return handle;
            return { writeFile: stage === 'writeFile' ? async () => { throw new Error('injected'); } : (...values) => handle.writeFile(...values),
              sync: stage === 'sync' ? async () => { throw new Error('injected'); } : () => handle.sync(), close: () => handle.close() };
          },
        }) };
      await assert.rejects(carries.createWeekdayCarryoverStore({ directory, io }).save(input({ expectedRevision: 1, quantity: -3 }), 'staff', context), code('CARRYOVER_STORAGE_FAILED'));
      assert.deepEqual(await store.get(identity), first);
      assert.deepEqual(await fs.promises.readdir(directory), ['2026_38_7_101.json']);
    }
  }));

  test('private directory/temp/lock modes are explicitly 0700/0600', async () => temporary(async directory => {
    const modes = [];
    const io = { ...fs.promises,
      mkdir: async (target, options) => { modes.push(['mkdir', options.mode]); return fs.promises.mkdir(target, options); },
      open: async (target, flags, mode) => { modes.push([flags, mode]); return fs.promises.open(target, flags, mode); } };
    await carries.createWeekdayCarryoverStore({ directory, io }).save(input(), 'staff', context);
    assert.ok(modes.some(([kind, mode]) => kind === 'mkdir' && mode === 0o700));
    assert.equal(modes.filter(([kind, mode]) => kind === 'wx' && mode === 0o600).length, 2);
  }));
}
