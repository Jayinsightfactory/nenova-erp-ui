import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ESTIMATE_DUPLICATE_REVIEW_REQUIRED,
  acquireEstimateDuplicateWriteLock,
  assertNoDuplicateEstimateWrite,
  estimateDuplicateLockResource,
  normalizeEstimateDuplicateUnit,
} from '../lib/estimateDuplicateWriteGuard.js';

const base = Object.freeze({
  year: 2026,
  parentWeek: 41,
  fullWeek: '41-01',
  custKey: 433,
  prodKey: 2377,
  shipmentKey: 6655,
  estimateType: 'FEE03-KR0010',
  unit: '단',
  quantity: -20,
  cost: 10000,
  estimateDate: '2026-10-13',
  descr: '40차 누락',
});

const candidate = Object.freeze({
  EstimateKey: 10051,
  EstimateType: 'FEE03-KR0010',
  Unit: '단',
  Quantity: -20,
  Cost: 10000,
  StoredDescr: '40차 누락',
  EstimateDtm: '2026-10-13T00:00:00.000Z',
  ShipmentKey: 6655,
  TypeDetailCode: 'FEE03-KR0010',
  TypeDescr: '불량차감/단',
  TypeDescr2: '불량차감',
});

function value(params, key) { return params?.[key]?.value; }

function fakeQuery({ lockResult = 0, typeRows, candidates = [] } = {}) {
  const calls = [];
  const q = async (statement, params = {}) => {
    calls.push({ statement, params });
    if (/sp_getapplock/i.test(statement)) return { recordset: lockResult === 'missing' ? [] : [{ LockResult: lockResult }] };
    if (/FROM CodeInfo/i.test(statement)) return { recordset: typeRows ?? [{ DetailCode: 'FEE03-KR0010', Descr: '불량차감/단', Descr2: '불량차감', CanonicalDescr: '40차 누락' }] };
    if (/FROM Estimate e/i.test(statement)) {
      const exclude = Number(value(params, 'excludeEstimateKey') || 0);
      return { recordset: candidates.filter((row) => !exclude || Number(row.EstimateKey) !== exclude) };
    }
    throw new Error(`unexpected query: ${statement}`);
  };
  return { q, calls };
}

test('scope key and normalized units are stable and cross-year/customer/product isolated', () => {
  const resource = estimateDuplicateLockResource(base);
  assert.match(resource, /^nenova:estimate-duplicate:v1:[a-f0-9]{64}$/);
  assert.equal(resource, estimateDuplicateLockResource({ ...base }));
  assert.notEqual(resource, estimateDuplicateLockResource({ ...base, year: 2025 }));
  assert.notEqual(resource, estimateDuplicateLockResource({ ...base, custKey: 434 }));
  assert.notEqual(resource, estimateDuplicateLockResource({ ...base, prodKey: 2378 }));
  assert.equal(normalizeEstimateDuplicateUnit('BUNCH'), normalizeEstimateDuplicateUnit('단'));
  assert.equal(normalizeEstimateDuplicateUnit('stem'), normalizeEstimateDuplicateUnit('스팀(대)'));
  assert.throws(() => estimateDuplicateLockResource({ ...base, year: 0 }), /업무 범위/);
});

test('leading-zero week and support/direct callers resolve the same lock resource', async () => {
  const january = { ...base, parentWeek: '01', fullWeek: '01-01' };
  const direct = fakeQuery();
  const support = fakeQuery();
  await acquireEstimateDuplicateWriteLock(direct.q, january);
  await acquireEstimateDuplicateWriteLock(support.q, { ...january, parentWeek: 1 });
  assert.equal(value(direct.calls[0].params, 'resource'), value(support.calls[0].params, 'resource'));

  const checked = fakeQuery();
  assert.equal((await assertNoDuplicateEstimateWrite(checked.q, january)).checked, true);
  assert.equal(value(checked.calls.at(-1).params, 'fullWeek'), '01-01');
});

test('lock is the first query and lock failure performs no family/candidate query or write', async () => {
  for (const lockResult of [-1, null, undefined, false, 'missing']) {
    const calls = [];
    const q = async (statement) => {
      calls.push(String(statement));
      return { recordset: lockResult === 'missing' ? [] : [{ LockResult: lockResult }] };
    };
    await assert.rejects(acquireEstimateDuplicateWriteLock(q, base), (error) => {
      assert.equal(error.code, 'ESTIMATE_DUPLICATE_LOCK_FAILED');
      assert.equal(error.statusCode, 409);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /sp_getapplock/i);
    assert.doesNotMatch(calls[0], /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  }
});

test('simulated serialized transactions allow one insert and block the concurrent replay', async () => {
  // This is an in-memory lock-order simulation, not a real MSSQL concurrency test.
  let tail = Promise.resolve();
  const ledger = [];
  let inserts = 0;
  const withFakeTransactionLock = async (work) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  };
  const create = () => withFakeTransactionLock(async () => {
    const db = fakeQuery({ candidates: ledger.slice() });
    await assertNoDuplicateEstimateWrite(db.q, base);
    ledger.push({ ...candidate });
    inserts += 1;
    return db.calls;
  });

  const results = await Promise.allSettled([create(), create()]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ reason }) => reason?.code === ESTIMATE_DUPLICATE_REVIEW_REQUIRED).length, 1);
  assert.equal(inserts, 1);
  assert.equal(ledger.length, 1);
});

test('exact replay blocks with stable 409 and existing key after lock then family resolution', async () => {
  const db = fakeQuery({ candidates: [candidate] });
  await assert.rejects(assertNoDuplicateEstimateWrite(db.q, base), (error) => {
    assert.equal(error.code, ESTIMATE_DUPLICATE_REVIEW_REQUIRED);
    assert.equal(error.statusCode, 409);
    assert.equal(error.existingEstimateKey, 10051);
    assert.equal(error.conflictEstimateKey, 10051);
    return true;
  });
  assert.match(db.calls[0].statement, /sp_getapplock/i);
  assert.match(db.calls[1].statement, /FROM CodeInfo/i);
  assert.match(db.calls[2].statement, /FROM Estimate e/i);
  assert.equal(value(db.calls[2].params, 'year'), 2026);
  assert.equal(value(db.calls[2].params, 'fullWeek'), '41-01');
  assert.equal(value(db.calls[2].params, 'shipmentKey'), 6655);
  assert.ok(db.calls.every(({ statement }) => !/\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i.test(statement)));
});

test('self update is excluded and lockAlreadyHeld avoids reacquiring the same business lock', async () => {
  const self = fakeQuery({ candidates: [candidate] });
  const result = await assertNoDuplicateEstimateWrite(self.q, { ...base, excludeEstimateKey: 10051 });
  assert.equal(result.checked, true);
  assert.equal(value(self.calls.at(-1).params, 'excludeEstimateKey'), 10051);

  const held = fakeQuery({ candidates: [] });
  const heldResult = await assertNoDuplicateEstimateWrite(held.q, { ...base, lockAlreadyHeld: true });
  assert.equal(heldResult.checked, true);
  assert.equal(held.calls.some(({ statement }) => /sp_getapplock/i.test(statement)), false);
  assert.match(held.calls[0].statement, /FROM CodeInfo/i);
});

test('other family and every exact-field near miss remain allowed', async () => {
  const variants = [
    { label: 'other family', patch: { TypeDescr2: '단가차감', TypeDescr: '단가차감/단' } },
    { label: 'unit', patch: { Unit: '스팀(대)' } },
    { label: 'quantity', patch: { Quantity: -19 } },
    { label: 'cost', patch: { Cost: 9999 } },
    { label: 'date', patch: { EstimateDtm: '2026-10-12T00:00:00.000Z' } },
    { label: 'descr', patch: { StoredDescr: '' } },
  ];
  for (const { label, patch } of variants) {
    const db = fakeQuery({ candidates: [{ ...candidate, ...patch }] });
    const result = await assertNoDuplicateEstimateWrite(db.q, base);
    assert.equal(result.checked, true, label);
  }
});

test('positive estimates bypass the lock and unknown or ambiguous types fail closed before candidate read', async () => {
  const positive = fakeQuery({ candidates: [candidate] });
  assert.deepEqual(await assertNoDuplicateEstimateWrite(positive.q, { ...base, quantity: 20 }), { checked: false, reason: 'positive-estimate' });
  assert.equal(positive.calls.length, 0);

  const invalidQuantity = fakeQuery();
  await assert.rejects(assertNoDuplicateEstimateWrite(invalidQuantity.q, { ...base, quantity: Number.NaN }), (error) => {
    assert.equal(error.code, 'ESTIMATE_DUPLICATE_SCOPE_INVALID');
    return true;
  });
  assert.equal(invalidQuantity.calls.length, 0);

  for (const typeRows of [[], [
    { DetailCode: 'A', Descr: '불량차감/단', Descr2: '불량차감' },
    { DetailCode: 'B', Descr: '단가차감/단', Descr2: '단가차감' },
  ]]) {
    const db = fakeQuery({ typeRows });
    await assert.rejects(assertNoDuplicateEstimateWrite(db.q, base), (error) => {
      assert.equal(error.code, 'ESTIMATE_TYPE_IDENTITY_UNKNOWN');
      assert.equal(error.statusCode, 409);
      return true;
    });
    assert.equal(db.calls.filter(({ statement }) => /FROM Estimate e/i.test(statement)).length, 0);
  }
});

test('candidate SQL declares all business dimensions and integrations call the shared guard', () => {
  const helper = fs.readFileSync(new URL('../lib/estimateDuplicateWriteGuard.js', import.meta.url), 'utf8');
  for (const predicate of [
    /sm\.OrderYear=@year/,
    /sm\.OrderWeek=@fullWeek/,
    /sm\.CustKey=@custKey/,
    /e\.ShipmentKey=@shipmentKey/,
    /e\.ProdKey=@prodKey/,
    /ABS\(ABS\(e\.Quantity\)-ABS\(@quantity\)\)/,
    /ABS\(ISNULL\(e\.Cost,0\)-@cost\)/,
    /CONVERT\(date,e\.EstimateDtm\)=@estimateDate/,
    /ISNULL\(e\.Descr,N''\)=@canonicalDescr/,
    /e\.EstimateKey<>@excludeEstimateKey/,
  ]) assert.match(helper, predicate);

  const create = fs.readFileSync(new URL('../pages/api/estimate/index.js', import.meta.url), 'utf8');
  const update = fs.readFileSync(new URL('../pages/api/estimate/update-entry.js', import.meta.url), 'utf8');
  const defect = fs.readFileSync(new URL('../lib/salesDefectDeductions.js', import.meta.url), 'utf8');
  assert.match(create, /acquireEstimateDuplicateWriteLock/);
  assert.match(create, /assertNoDuplicateEstimateWrite/);
  assert.match(update, /acquireEstimateDuplicateWriteLock/);
  assert.match(update, /assertNoDuplicateEstimateWrite/);
  assert.match(defect, /acquireEstimateDuplicateWriteLock/);
});

test('legacy update-entry payload omits orderWeek while negative rows lock before reread and recheck scope', () => {
  const page = fs.readFileSync(new URL('../pages/estimate.js', import.meta.url), 'utf8');
  const requestStart = page.indexOf("fetch('/api/estimate/update-entry'");
  const requestEnd = page.indexOf('const data = await response.json()', requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  const legacyRequest = page.slice(requestStart, requestEnd);
  assert.match(legacyRequest, /orderYear:\s*yearStr/);
  assert.match(legacyRequest, /custKey:\s*capturedRefresh\.ship\.custKey/);
  assert.doesNotMatch(legacyRequest, /\borderWeek\s*:/,
    'the shipped editor payload does not send orderWeek');

  const update = fs.readFileSync(new URL('../pages/api/estimate/update-entry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(update, /body\.orderWeek[^\n]{0,120}(?:필요|400)/,
    'missing body.orderWeek must not be rejected');
  const preflightAt = update.indexOf('const preflight = await query(');
  const transactionAt = update.indexOf('const result = await withTransaction(');
  assert.ok(preflightAt >= 0 && preflightAt < transactionAt, 'read-only PK preflight precedes the transaction');
  const transaction = update.slice(transactionAt);
  const lockAt = transaction.indexOf('await acquireEstimateDuplicateWriteLock');
  const lockedReadAt = transaction.indexOf('FROM Estimate e WITH (UPDLOCK, HOLDLOCK)');
  assert.ok(lockAt >= 0 && lockAt < lockedReadAt, 'negative scope lock is the first transaction query');
  assert.match(transaction.slice(0, lockAt), /if \(preflightIsNegative\)/,
    'positive rows bypass the duplicate applock');
  const scopeRecheck = transaction.slice(lockedReadAt, transaction.indexOf('await assertErpEditGuard'));
  assert.match(scopeRecheck, /row\.ShipmentKey[\s\S]*preflightRow\.ShipmentKey/);
  assert.match(scopeRecheck, /row\.OrderWeek[\s\S]*preflightRow\.OrderWeek/);
  assert.match(scopeRecheck, /Number\(row\.Quantity\) < 0\)[\s\S]*preflightIsNegative/,
    'locked reread rechecks the quantity sign used to choose the lock path');
  assert.match(transaction, /if \(signedQuantity < 0\)[\s\S]*assertNoDuplicateEstimateWrite/);
});
