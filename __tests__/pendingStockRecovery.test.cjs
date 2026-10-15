'use strict';

// Offline injected fixtures only. No app db/auth/env imports or SQL connections.
const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverPendingStock, EXPECTED_CALC_SHA256, DEFAULT_MIN_PENDING_AGE_SECONDS } = require('../lib/pendingStockRecovery.cjs');

const types = { Int: Symbol('Int'), NVarChar: Symbol('NVarChar') };
const token = '34567a01-f1ba-4210-a129-c167b1551234';
function pending(overrides = {}) {
  return { GateKey: '1', Mode: 'WAIT_CALC', LockedAt: new Date('2026-10-15T08:00:00Z'),
    Action: 'CANCEL', OrderYear: '2026', OrderWeek: '41-02', OwnerSessionID: 79, OwnerToken: token,
    PendingCalc: 1, CalcProdKey: null, ProtocolVersion: 2, PendingMature: 1,
    SessionID: 123, TransactionCount: 1, TransactionState: 1, MarkerMode: 'Exclusive', ...overrides };
}
function idle(overrides = {}) {
  return pending({ Mode: null, LockedAt: null, Action: null, OrderYear: null, OrderWeek: null,
    OwnerSessionID: null, OwnerToken: null, PendingCalc: 0, CalcProdKey: null, ...overrides });
}
function capability() {
  const signature = [
    ['@OrderYear', 231, 40, 0], ['@OrderWeek', 231, 40, 0], ['@ProdKey', 56, 4, 0],
    ['@iUserID', 231, 40, 0], ['@oResult', 56, 4, 1], ['@oMessage', 231, -1, 1],
  ];
  return { recordsets: [[{ ProtocolVersion: 2, IsReady: 1 }], signature.map(([name, system_type_id, max_length, is_output], index) => ({
    parameter_id: index + 1, name, system_type_id, max_length, is_output, is_readonly: 0,
  })), [{ CalcSha256: EXPECTED_CALC_SHA256 }]] };
}
function finalResult(gate, overrides = {}) {
  const row = { ...idle(), result: 0, returnCode: 0, OrderYear: gate.OrderYear, OrderWeek: gate.OrderWeek,
    SessionID: gate.SessionID, TransactionCount: gate.TransactionCount, TransactionState: 1,
    MarkerMode: 'Exclusive', GateOrderYear: null, GateOrderWeek: null, ...overrides };
  return { recordsets: [[], [row]] };
}
function fixture({ gate = pending(), cap = capability(), output, lockError, capError, nativeError } = {}) {
  const calls = [];
  let nativeCount = 0;
  const tQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) {
      if (lockError) throw lockError;
      assert.match(sql, /WITH \(UPDLOCK,HOLDLOCK,NOWAIT\)/);
      assert.match(sql, /DATEADD\(SECOND,-@minPendingAgeSeconds,GETDATE\(\)\)/);
      return { recordset: [gate] };
    }
    if (calls.length === 2) {
      if (capError) throw capError;
      assert.match(sql, /EXEC dbo\.usp_NenovaStockWeekGateCapability/);
      return cap;
    }
    assert.equal(calls.length, 3, 'must never retry a native failure or query after its failed transaction');
    nativeCount++;
    assert.match(sql, /EXEC @rc=dbo\.usp_StockCalculation/);
    if (nativeError) throw nativeError;
    return output ?? finalResult(gate);
  };
  return { tQuery, calls, gate, get nativeCount() { return nativeCount; } };
}
async function run(f, options = {}) { return recoverPendingStock({ tQuery: f.tQuery, types, ...options }); }
async function rejectsCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error.code, code);
    assert.equal(error.message, code, 'errors must not expose native messages');
    return true;
  });
}

test('successful committed handoff uses only locked same-year/week native full CALC', async () => {
  const f = fixture();
  const result = await run(f, { uid: 'stock-worker', orderYear: '2025', orderWeek: '41-01', prodKey: 999 });
  assert.equal(result.status, 'recovered');
  assert.equal(result.code, 'PENDING_STOCK_RECOVERED');
  assert.deepEqual(result.scope, { orderYear: '2026', orderWeek: '41-02' });
  assert.equal(result.candidate.ownerToken, token);
  assert.ok(result.durationMs >= 0);
  assert.equal(f.calls.length, 3);
  assert.equal(f.nativeCount, 1);
  const { sql, params } = f.calls[2];
  assert.equal(params.year.value, f.gate.OrderYear);
  assert.equal(params.week.value, f.gate.OrderWeek);
  assert.equal(params.uid.value, 'stock-worker');
  assert.equal(params.ownerToken.value, token);
  assert.equal(params.ownerSpid.value, 79);
  assert.equal(params.spid.value, 123);
  assert.equal(params.trancount.value, 1);
  assert.equal(params.expectedCalcSha256.value, EXPECTED_CALC_SHA256);
  assert.equal(params.marker.value, f.calls[0].params.marker.value);
  assert.equal(f.calls[0].params.minPendingAgeSeconds.value, DEFAULT_MIN_PENDING_AGE_SECONDS);
  assert.match(sql, /@ProdKey=0,/);
  assert.match(sql, /Action=@action AND OrderYear=@year AND OrderWeek=@week/);
  assert.doesNotMatch(sql, /UPDATE\s+dbo\.NenovaStockWeekGate|usp_ShipmentFix|usp_NenovaStockWeekGateClear|BEGIN\s+TRANSACTION|COMMIT\s+TRANSACTION|ROLLBACK\s+TRANSACTION/i);
});

for (const action of ['FIX', 'CANCEL', 'CALC']) {
  test(`valid ${action} WAIT_CALC is consumed by the ordinary CALC0 path`, async () => {
    const f = fixture({ gate: pending({ Action: action }) });
    assert.equal((await run(f)).status, 'recovered');
    assert.equal(f.calls[2].params.action.value, action);
  });
}

test('active RUN stays untouched even with an ancient lock or missing owner', async () => {
  const gate = pending({ Mode: 'RUN', LockedAt: new Date('2000-01-01'), OwnerToken: null });
  const before = structuredClone(gate);
  const f = fixture({ gate });
  let callback = false;
  const result = await run(f, { onCandidate: async () => { callback = true; } });
  assert.equal(result.code, 'PENDING_STOCK_ACTIVE_RUN');
  assert.equal(result.status, 'skipped');
  assert.equal(result.scope, null);
  assert.equal(callback, false);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(gate, before);
});

test('fully IDLE stays untouched without capability/native calls or callback', async () => {
  const f = fixture({ gate: idle() });
  const result = await run(f, { onCandidate: () => { throw Error('must not call'); } });
  assert.equal(result.code, 'PENDING_STOCK_IDLE');
  assert.equal(f.calls.length, 1);
});

test('SQL clock grace skips young pending handoff and no JS timestamp decides eligibility', async () => {
  // Deliberately old JS date: SQL PendingMature is authoritative for scheduling.
  const f = fixture({ gate: pending({ LockedAt: new Date('2000-01-01'), PendingMature: 0 }) });
  const result = await run(f, { minPendingAgeSeconds: 120, onCandidate: () => { throw Error('must not call'); } });
  assert.equal(result.code, 'PENDING_STOCK_TOO_YOUNG');
  assert.equal(f.calls[0].params.minPendingAgeSeconds.value, 120);
  assert.equal(f.calls.length, 1);
});

test('SQL NOWAIT contention is skipped and does not inspect or change another writer', async () => {
  const f = fixture({ lockError: { originalError: { info: { number: 1222 } } } });
  assert.equal((await run(f)).code, 'PENDING_STOCK_GATE_LOCKED');
  assert.equal(f.calls.length, 1);
});

for (const [name, overrides] of [
  ['prior-year same week', { OrderYear: '2025' }], ['year suffix', { OrderYear: '2026 ' }],
  ['numeric year', { OrderYear: 2026 }], ['week prefix', { OrderWeek: '2026-41-02' }],
  ['week suffix', { OrderWeek: '41-02 ' }], ['week width', { OrderWeek: '1-02' }],
  ['missing pending flag', { PendingCalc: null }], ['pending false', { PendingCalc: 0 }],
  ['missing token', { OwnerToken: null }], ['invalid token', { OwnerToken: 'not-a-guid' }],
  ['missing owner session', { OwnerSessionID: null }], ['nonpositive owner', { OwnerSessionID: 0 }],
  ['wrong action', { Action: 'CLEAR' }], ['product-scoped pending', { CalcProdKey: 7 }],
  ['missing date', { LockedAt: null }], ['invalid date', { LockedAt: new Date('invalid') }],
  ['missing SQL maturity', { PendingMature: null }], ['V1 protocol', { ProtocolVersion: 1 }],
  ['unknown mode', { Mode: 'OTHER' }], ['malformed idle', { Mode: null }],
]) {
  test(`malformed handoff rejects ${name} without native calls`, async () => {
    const f = fixture({ gate: pending(overrides) });
    await rejectsCode(run(f), 'PENDING_STOCK_GATE_INVALID');
    assert.equal(f.calls.length, 1);
  });
}

test('later year with same week binds that locked year and never a caller year', async () => {
  const f = fixture({ gate: pending({ OrderYear: '2027' }) });
  assert.equal((await run(f, { orderYear: '2026' })).scope.orderYear, '2027');
  assert.equal(f.calls[2].params.year.value, '2027');
});

for (const overrides of [{ TransactionCount: 0 }, { TransactionState: -1 }, { SessionID: 0 }, { MarkerMode: 'NoLock' }]) {
  test(`healthy active outer transaction is mandatory ${JSON.stringify(overrides)}`, async () => {
    const f = fixture({ gate: pending(overrides) });
    await rejectsCode(run(f), 'PENDING_STOCK_TRANSACTION_REQUIRED');
    assert.equal(f.calls.length, 1);
  });
}

test('async candidate callback receives fingerprint before native work and can enforce cooldown', async () => {
  const f = fixture();
  let candidate;
  const result = await run(f, { onCandidate: async value => {
    await Promise.resolve();
    candidate = value;
    assert.equal(f.calls.length, 1);
    return false;
  } });
  assert.deepEqual(candidate, { orderYear: '2026', orderWeek: '41-02', ownerToken: token,
    action: 'CANCEL', lockedAt: '2026-10-15T08:00:00.000Z' });
  assert.ok(Object.isFrozen(candidate));
  assert.equal(result.code, 'PENDING_STOCK_COOLDOWN');
  assert.equal(f.calls.length, 1);
});

test('candidate callback failure aborts without native work and supplies safe fingerprint', async () => {
  const f = fixture();
  await assert.rejects(run(f, { onCandidate: async () => { throw Error('private persistence detail'); } }), error => {
    assert.equal(error.code, 'PENDING_STOCK_RECOVERY_FAILED');
    assert.equal(error.message, error.code);
    assert.equal(error.candidate.ownerToken, token);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

for (const [name, mutate] of [
  ['not ready', c => { c.recordsets[0][0].IsReady = 0; }],
  ['wrong protocol', c => { c.recordsets[0][0].ProtocolVersion = 1; }],
  ['missing capability row', c => { c.recordsets[0] = []; }],
  ['unpatched module hash', c => { c.recordsets[2][0].CalcSha256 = '879357e7bf8aabe4cb60f853d18331109580f673e0dc3ba21570ad984bfbc67b'; }],
  ['missing module hash', c => { c.recordsets[2] = []; }],
  ['extra signature parameter', c => { c.recordsets[1].push({}); }],
  ['missing output flag', c => { c.recordsets[1][4].is_output = null; }],
  ['wrong parameter width', c => { c.recordsets[1][0].max_length = 20; }],
  ['wrong parameter order', c => { c.recordsets[1].reverse(); }],
]) {
  test(`capability refuses ${name} before native work`, async () => {
    const cap = capability();
    mutate(cap);
    const f = fixture({ cap });
    await rejectsCode(run(f), 'PENDING_STOCK_CAPABILITY_REQUIRED');
    assert.equal(f.calls.length, 2);
    assert.equal(f.nativeCount, 0);
  });
}

for (const [name, overrides] of [
  ['NULL output', { result: null }], ['missing output', { result: undefined }],
  ['nonzero output', { result: -99 }], ['NULL return', { returnCode: null }],
  ['nonzero return', { returnCode: -1 }], ['reused physical session', { SessionID: 124 }],
  ['rolled back whole transaction', { TransactionCount: 0 }],
  ['uncommittable transaction', { TransactionState: -1 }],
  ['rollback and rebegin same SPID', { MarkerMode: 'NoLock' }],
  ['wrong scope year', { OrderYear: '2025' }], ['wrong scope week', { OrderWeek: '41-01' }],
  ['pending final gate', { Mode: 'WAIT_CALC' }], ['leftover final token', { OwnerToken: token }],
  ['leftover final scope', { GateOrderYear: '2026' }], ['leftover final week', { GateOrderWeek: '41-02' }],
  ['wrong final protocol', { ProtocolVersion: 1 }], ['final pending flag', { PendingCalc: 1 }],
]) {
  test(`native postcondition rejects ${name} and never continues`, async () => {
    const gate = pending();
    const f = fixture({ gate, output: finalResult(gate, overrides) });
    await rejectsCode(run(f), 'PENDING_STOCK_RESULT_INVALID');
    assert.equal(f.calls.length, 3);
    assert.equal(f.nativeCount, 1);
  });
}

test('SQL transaction marker guards immediately before and after native CALC', async () => {
  const f = fixture();
  await run(f);
  const sql = f.calls[2].sql;
  const callAt = sql.indexOf('EXEC @rc=dbo.usp_StockCalculation');
  const resultAt = sql.indexOf('IF @r IS NULL');
  const before = sql.slice(0, callAt);
  const after = sql.slice(callAt, resultAt);
  assert.match(f.calls[0].sql, /sp_getapplock[\s\S]*@LockOwner=N'Transaction',@LockTimeout=0/);
  assert.doesNotMatch(sql, /sp_getapplock/, 'native batch must verify the original marker, never create a replacement');
  assert.match(before, /APPLOCK_MODE\(N'public',@marker,N'Transaction'\)/);
  assert.match(after, /@@SPID<>@spid OR @@TRANCOUNT<>@trancount OR XACT_STATE\(\)<>1/);
  assert.match(after, /APPLOCK_MODE\(N'public',@marker,N'Transaction'\)/);
  assert.match(sql, /IF @r IS NULL OR @rc IS NULL OR @r<>0 OR @rc<>0/);
});

test('rollback/rebegin between candidate callback and native entry cannot reacquire lost original marker', async () => {
  const f = fixture({ nativeError: { number: 51072 } });
  let candidateRecorded = false;
  await rejectsCode(run(f, { onCandidate: async () => { candidateRecorded = true; } }),
    'PENDING_STOCK_ORIGINAL_TRANSACTION_REQUIRED');
  assert.equal(candidateRecorded, true);
  assert.equal(f.calls[0].params.marker.value, f.calls[2].params.marker.value);
  assert.doesNotMatch(f.calls[2].sql, /sp_getapplock/);
  assert.equal(f.calls.length, 3);
});

for (const [number, code] of [[51072, 'PENDING_STOCK_ORIGINAL_TRANSACTION_REQUIRED'],
  [51073, 'PENDING_STOCK_GATE_CHANGED'], [51074, 'PENDING_STOCK_CALC_HASH_REQUIRED'],
  [51075, 'PENDING_STOCK_NATIVE_FAILED'], [51076, 'PENDING_STOCK_FINAL_IDLE_REQUIRED'],
  [1205, 'PENDING_STOCK_CALC_FAILED']]) {
  test(`SQL failure ${number} aborts immediately without retries, postqueries, or native message leakage`, async () => {
    const f = fixture({ nativeError: { number, message: 'private SQL/native information' } });
    await rejectsCode(run(f), code);
    assert.equal(f.calls.length, 3);
  });
}

test('each recovery uses a new transaction marker even on same physical session', async () => {
  const a = fixture();
  const b = fixture();
  await run(a);
  await run(b);
  assert.notEqual(a.calls[2].params.marker.value, b.calls[2].params.marker.value);
});

for (const options of [{ minPendingAgeSeconds: -1 }, { minPendingAgeSeconds: 0.5 },
  { minPendingAgeSeconds: 86401 }, { uid: '' }, { uid: 'x'.repeat(21) }, { onCandidate: true }]) {
  test(`invalid options never touch SQL ${JSON.stringify(options)}`, async () => {
    const f = fixture();
    await rejectsCode(run(f, options), 'PENDING_STOCK_ARGUMENTS_INVALID');
    assert.equal(f.calls.length, 0);
  });
}

test('explicit zero grace is preserved as scheduling configuration without RUN reclaim', async () => {
  const f = fixture();
  assert.equal((await run(f, { minPendingAgeSeconds: 0 })).status, 'recovered');
  assert.equal(f.calls[0].params.minPendingAgeSeconds.value, 0);
  assert.equal(f.calls[2].params.minPendingAgeSeconds.value, 0);
});
