const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const helperPromise = import('../lib/orderStockCalculation.js');
const types = { Int: 'Int', NVarChar: 'NVarChar', Float: 'Float' };
const idle = () => ({ GateKey: '1', Mode: null, LockedAt: null, Action: null,
  OrderYear: null, OrderWeek: null, OwnerSessionID: null, OwnerToken: null,
  PendingCalc: false, CalcProdKey: null, ProtocolVersion: 2 });
const signature = () => [['@OrderYear',231,false],['@OrderWeek',231,false],['@ProdKey',56,false],
  ['@iUserID',231,false],['@oResult',56,true],['@oMessage',231,true]]
  .map(([name,system_type_id,is_output]) => ({ name,system_type_id,is_output }));

// Executing transactional fake: native GateEnter, nested commit, stock writes and
// failures mutate only staged state. No app db/auth/env imports or connection.
function fixture(options = {}) {
  const db = { state: { gate: idle(), stock: {}, orderQuantity: 2, histories: [],
    priorYear: 700, liveStock: 100, fixed: true }, calls: [], nativeCalls: [],
    commits: 0, rollbacks: 0, transactionOptions: [] };
  Object.assign(db.state.gate, options.gate);
  db.withTransactionFn = async (callback, txOptions) => {
    db.transactionOptions.push(txOptions);
    const staged = structuredClone(db.state);
    let count = 1, state = 1, marker = true;
    try {
      const rows = await callback(async (sql, params = {}) => {
        db.calls.push(sql);
        if (/SELECT OrderYear, OrderWeek FROM OrderMaster/.test(sql)) return { recordset: [{ OrderYear: '2026', OrderWeek: '40-01' }] };
        if (/SELECT od.ProdKey/.test(sql)) return { recordset: [{ ProdKey: 53, OutQuantity: staged.orderQuantity, OutUnit: '박스', B1B: 1, S1B: 1 }] };
        if (/UPDATE OrderDetail SET/.test(sql)) { staged.orderQuantity = params.oq.value; return {}; }
        if (/INSERT INTO OrderHistory/.test(sql)) { staged.histories.push(params.after.value); return {}; }
        if (/SELECT GateKey,Mode/.test(sql)) {
          if (options.lockError) throw options.lockError;
          return { recordset: options.missingGate ? [] : [{ ...staged.gate, SessionID: 311,
            TransactionCount: options.initialCount ?? count, TransactionState: options.initialState ?? state }] };
        }
        if (/EXEC dbo.usp_NenovaStockWeekGateCapability/.test(sql)) {
          if (options.capabilityError) throw options.capabilityError;
          return { recordsets: [[{ ProtocolVersion: 2, IsReady: options.ready ?? true }], options.parameters ?? signature()] };
        }
        assert.match(sql, /WHILE @ordinal</, 'all native product calls must share one request');
        assert.match(sql, /@LockOwner=N'Transaction'/);
        assert.match(sql, /@@TRANCOUNT<>@trancount/);
        assert.match(sql, /XACT_STATE\(\)<>1/);
        assert.match(sql, /APPLOCK_MODE/);
        assert.match(sql, /@r IS NULL OR @rc IS NULL OR @r<>0 OR @rc<>0/);
        assert.doesNotMatch(sql, /GateClear|GateLeave|UPDATE dbo\.NenovaStockWeekGate/);
        const values = sql.match(/FROM \(VALUES ([\d(),]+)\) p/)[1];
        const keys = [...values.matchAll(/\(\d+,(\d+)\)/g)].map(match => Number(match[1]));
        const results = [];
        for (const [index, pk] of keys.entries()) {
          const behavior = options.behaviors?.[index] || {};
          assert.equal(count, 1);
          assert.equal(state, 1);
          assert.equal(marker, true);
          assert.deepEqual(staged.gate, idle());
          db.nativeCalls.push({ pk, year: params.year.value, week: params.week.value });
          // Native Enter is protected by the outer transaction before nested BEGIN.
          Object.assign(staged.gate, { Mode: 'RUN', Action: 'CALC', OwnerSessionID: 311,
            OwnerToken: 'native-owner', OrderYear: params.year.value, OrderWeek: params.week.value,
            CalcProdKey: pk, LockedAt: 'now' });
          count += 1;
          staged.stock[`${params.year.value}|${params.week.value}|${pk}`] = pk;
          staged.stock[`2027|01-01|${pk}`] = pk + 1; // retain whole future-year cascade
          if (behavior.timeout) throw Object.assign(new Error('native timeout after RUN'), { code: 'ETIMEOUT' });
          if (behavior.error) throw new Error('native failure');
          count -= 1; // native nested COMMIT does not commit staged state
          if (behavior.rollback) { count = 0; state = 0; marker = false; }
          if (behavior.rebegin) { count = 1; state = 1; marker = false; }
          if (behavior.leak) count += 1;
          if (behavior.doomed) state = -1;
          const result = Object.hasOwn(behavior, 'result') ? behavior.result : 0;
          const returnCode = Object.hasOwn(behavior, 'returnCode') ? behavior.returnCode : 0;
          if (count !== 1 || state !== 1 || !marker) throw new Error('STOCK_CALC_ORIGINAL_TRANSACTION_REQUIRED');
          if (result == null || returnCode == null || result !== 0 || returnCode !== 0) throw new Error('STOCK_CALC_NATIVE_FAILED');
          if (!behavior.gateStillRun) staged.gate = idle();
          if (behavior.gateStillRun) throw new Error('STOCK_CALC_IDLE_GATE_REQUIRED');
          results.push({ ProdKey: pk, result, returnCode, message: '', SessionID: 311,
            TransactionCount: count, TransactionState: state, GateIdle: true, MarkerHeld: marker });
        }
        options.mutateResults?.(results);
        return { recordset: results, recordsets: [results] };
      });
      db.state = staged;
      db.commits += 1;
      return rows;
    } catch (error) { db.rollbacks += 1; throw error; }
  };
  return db;
}

async function run(db, input = {}) {
  const { runOrderStockCalculationBatch } = await helperPromise;
  return runOrderStockCalculationBatch({ withTransactionFn: db.withTransactionFn, types,
    orderYear: '2026', orderWeek: '40-01', uid: 'fixture', prodKeys: [53,54], ...input });
}

test('idle V2 success: one transaction, one native request, retries=0, explicit year and future cascade', async () => {
  const db = fixture();
  assert.deepEqual((await run(db, { prodKeys: [53,'53',54] })).map(row => row.ProdKey), [53,54]);
  assert.deepEqual(db.transactionOptions, [{ retries: 0 }]);
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0], /WITH \(UPDLOCK,HOLDLOCK,NOWAIT\)/);
  assert.equal(db.calls.filter(sql => /EXEC @rc=dbo.usp_StockCalculation/.test(sql)).length, 1);
  assert.deepEqual(db.state.gate, idle());
  assert.equal(db.state.stock['2027|01-01|54'], 55);
  assert.equal(db.state.priorYear, 700);
  assert.equal(db.state.liveStock, 100);
  assert.equal(db.state.fixed, true);
});

test('empty products and year<=2025/invalid scope do no SQL/native', async () => {
  const db = fixture();
  assert.deepEqual(await run(db, { prodKeys: [] }), []);
  for (const input of [{ orderYear: '2025' }, { orderYear: '2024' }, { orderYear: undefined },
    { orderWeek: '2026-40-01' }, { prodKeys: [0] }, { prodKeys: [-1] }, { prodKeys: [1.5] }, { prodKeys: [2147483648] }]) {
    await assert.rejects(run(db, input), { code: 'STOCK_CALC_SCOPE_INVALID' });
  }
  assert.equal(db.calls.length, 0);
  assert.equal(db.transactionOptions.length, 0);
});

for (const [label, options] of [
  ['RUN foreign owner', { gate: { Mode: 'RUN', OwnerSessionID: 999, OwnerToken: 'foreign' } }],
  ['orphan RUN same SPID', { gate: { Mode: 'RUN', OwnerSessionID: 311 } }],
  ['WAIT_CALC same scope', { gate: { Mode: 'WAIT_CALC', PendingCalc: true, OrderYear: '2026', OrderWeek: '40-01' } }],
  ['foreign prior-year pending', { gate: { Mode: 'WAIT_CALC', PendingCalc: true, OrderYear: '2025', OrderWeek: '40-01' } }],
  ...['LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'].map(key => [`idle but ${key} present`, { gate: { [key]: 'stale' } }]),
  ['pending NULL is not idle', { gate: { PendingCalc: null } }],
  ['protocol v1', { gate: { ProtocolVersion: 1 } }],
  ['NOWAIT lock conflict', { lockError: { originalError: { info: { number: 1222 } } } }],
  ['no gate', { missingGate: true }], ['no transaction', { initialCount: 0 }], ['doomed transaction', { initialState: -1 }],
  ['capability not ready', { ready: false }], ['capability missing', { capabilityError: new Error('missing capability') }],
  ['output signature absent', { parameters: signature().filter(p => p.name !== '@oResult') }],
  ['output not output', { parameters: signature().map(p => p.name === '@oResult' ? { ...p, is_output: false } : p) }],
]) test(`refuse ${label} without native/clear/steal`, async () => {
  const db = fixture(options), before = structuredClone(db.state);
  await assert.rejects(run(db));
  assert.deepEqual(db.state, before);
  assert.equal(db.nativeCalls.length, 0);
  assert.equal(db.commits, 0);
});

for (const [label, behavior] of [
  ['timeout after GateEnter RUN', { timeout: true }], ['native busy', { result: -99 }],
  ['native result failure', { result: -1 }], ['returnCode -1 with output still 0', { returnCode: -1 }],
  ['output NULL', { result: null }], ['returnCode NULL', { returnCode: null }],
  ['nested transaction leak', { leak: true }], ['native whole rollback', { rollback: true }],
  ['same SPID rollback+rebegin loses marker', { rebegin: true }], ['doomed transaction', { doomed: true }],
  ['gate remains RUN', { gateStillRun: true }], ['native thrown error', { error: true }],
]) test(`${label} on second product rolls back first product and gate, preserves order commit`, async () => {
  const db = fixture({ behaviors: [{}, behavior] }), before = structuredClone(db.state);
  await assert.rejects(run(db));
  assert.equal(db.nativeCalls.length, 2);
  assert.deepEqual(db.state, before);
  assert.equal(db.commits, 0);
  assert.equal(db.rollbacks, 1);
  assert.deepEqual(db.transactionOptions, [{ retries: 0 }]);
});

for (const key of ['result','returnCode','TransactionState','TransactionCount','SessionID','GateIdle','MarkerHeld']) {
  test(`missing ${key} in returned result is not success`, async () => {
    const db = fixture({ mutateResults: rows => { delete rows[1][key]; } });
    await assert.rejects(run(db), { code: 'STOCK_CALC_RESULT_INVALID' });
    assert.deepEqual(db.state.stock, {});
    assert.equal(db.commits, 0);
  });
}

test('actual updateOrder keeps order commit and existing warning on calculation timeout', async () => {
  const db = fixture({ behaviors: [{ timeout: true }] });
  const { runOrderStockCalculationBatch } = await helperPromise;
  const source = fs.readFileSync('pages/api/orders/index.js', 'utf8');
  const body = source.slice(source.indexOf('async function updateOrder('), source.indexOf('async function insertOrderHistory('));
  const updateOrder = new Function('withTransaction','sql','normalizeOrderUnit','toAllUnits','appLog',
    'runOrderStockCalculationBatch', `${body};return updateOrder;`)(db.withTransactionFn, types,
    unit => unit, qty => ({ box: qty, bunch: qty, steam: qty, outQ: qty }), async () => {}, runOrderStockCalculationBatch);
  const response = { status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
  await updateOrder({ user: { userId: 'fixture' }, body: { orderMasterKey: 1, items: [{ detailKey: 1, qty: 5, unit: '박스' }] } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.match(response.payload.warning, /재고 재계산 경고:.*timeout/);
  assert.equal(db.state.orderQuantity, 5);
  assert.deepEqual(db.state.histories, ['5']);
  assert.deepEqual(db.state.stock, {});
  assert.deepEqual(db.state.gate, idle());
  assert.equal(db.commits, 1);
  assert.equal(db.rollbacks, 1);
});

test('API seam is calculation-only and mycustomer/final absolute skip condition stays unchanged', () => {
  const source = fs.readFileSync('pages/api/orders/index.js', 'utf8');
  const body = source.slice(source.indexOf('async function runStockCalculation('), source.indexOf('async function insertOrderHistory('));
  assert.match(body, /runOrderStockCalculationBatch/);
  assert.doesNotMatch(body, /await query\(|stockCalculationSql|GateClear|GateLeave/);
  assert.match(source, /const stockWarning = isMyCustomerSource\s*\? null\s*: await runStockCalculation/);
  const contract = JSON.parse(fs.readFileSync('docs/contracts/order-stock-calculation.json', 'utf8'));
  assert.ok(contract.requiredTestFiles.includes('__tests__/orderStockCalculation.test.js'));
  assert.match(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['pretest:erp-contract'], /orderStockCalculation\.test\.js/);
});
