import assert from 'node:assert/strict';
import fs from 'node:fs';
import sql from 'mssql';
import {
  materializeOverflowTargets,
  nextEstimateSubweek,
  overflowRequestHash,
  planEstimateOverflow,
  readOverflowResult,
  recordOverflowResult,
  splitEstimateIncrease,
  validateOverflowOperationId,
  verifyOverflowTargets,
} from '../lib/estimateOverflow.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/estimateOverflowCases.json', import.meta.url), 'utf8'));
const operationId = '11111111-1111-4111-8111-111111111111';

const valueOf = value => value && typeof value === 'object' && 'value' in value ? value.value : value;
const param = (params, key) => valueOf(params?.[key]);
const factKey = (year, week, prodKey) => `${year}|${week}|${prodKey}`;
const targetKey = (year, week, custKey, prodKey) => `${year}|${week}|${custKey}|${prodKey}`;

function sourceRow(overrides = {}) {
  return {
    OrderYear: '2026', OrderWeek: '36-01', CustKey: 533, ProdKey: 1239,
    ProdName: 'Deep Silver 50cm', CountryFlower: 'Deep Silver',
    OutUnit: '단', EstUnit: '단', BunchOf1Box: 10, SteamOf1Bunch: 1, SteamOf1Box: 10,
    SdetailKey: 88237, DetailOutQuantity: 10, DetailEstQuantity: 10,
    DetailBoxQuantity: 1, DetailBunchQuantity: 10, DetailSteamQuantity: 10,
    DetailCost: 700, DetailAmount: 70000, DetailVat: 7000, DetailIsFix: 1, MasterIsFix: 1,
    SdateKey: 882371, ShipmentDtm: '2026-09-03T00:00:00.000Z',
    DateShipmentQuantity: 10, DateEstQuantity: 10, DateCost: 700, DateDescr: 'source date',
    OutQuantity: 10,
    ...overrides,
  };
}

function baseFacts({ currentRemain = 0, nextRemain = 10, year = '2026', prodKey = 1239 } = {}) {
  const make = (week, remain) => ({
    MasterCount: 1,
    StoredStock: remain,
    PrevStock: 0,
    Incoming: remain,
    ConfirmedOut: 0,
    ReservedOut: 0,
    AdjustQty: 0,
  });
  return {
    [factKey(year, '36-01', prodKey)]: make('36-01', currentRemain),
    [factKey(year, '36-02', prodKey)]: make('36-02', nextRemain),
  };
}

function defaultTarget(overrides = {}) {
  return {
    masters: [{ ShipmentKey: 3602, isFix: 1 }],
    periodRows: [{ BaseYmd: '2026-09-03T00:00:00.000Z', CustName: 'Fixture Customer', Manager: 'admin', OrderCode: 'FIX' }],
    details: [],
    dates: [],
    orders: [],
    managerRows: [{ UserID: 'admin' }],
    ...overrides,
  };
}

function makeQuery({ facts = baseFacts(), targets = {}, logs = [], failOn = null } = {}) {
  const calls = [];
  const writes = [];
  const tQ = async (statement, params = {}) => {
    const text = String(statement).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (failOn && failOn.test(text)) throw new Error('fixture forced transaction failure');

    if (/SELECT Payload FROM SystemActionLog/.test(text)) {
      const op = param(params, 'op');
      const uid = param(params, 'uid');
      return { recordset: logs.filter(row => row.SessionId === op && row.Actor === uid && row.Result === 'SUCCESS').map(row => ({ Payload: row.Payload })) };
    }
    if (/MasterCount/.test(text)) {
      const key = factKey(param(params, 'yr'), param(params, 'wk'), param(params, 'pk'));
      return { recordset: [facts[key] || { MasterCount: 0, StoredStock: null, PrevStock: 0, Incoming: 0, ConfirmedOut: 0, ReservedOut: 0, AdjustQty: 0 }] };
    }
    if (/SELECT ShipmentKey,isFix FROM ShipmentMaster/.test(text)) {
      const key = targetKey(param(params, 'yr'), param(params, 'wk'), param(params, 'ck'), param(params, 'pk'));
      return { recordset: (targets[key] || defaultTarget()).masters };
    }
    if (/FROM Customer c/.test(text)) {
      const key = targetKey(param(params, 'yr'), param(params, 'wk'), param(params, 'ck'), param(params, 'pk'));
      return { recordset: (targets[key] || defaultTarget()).periodRows };
    }
    if (/FROM ShipmentDetail sd/.test(text)) {
      const key = targetKey(param(params, 'yr'), param(params, 'wk'), param(params, 'ck'), param(params, 'pk'));
      return { recordset: (targets[key] || defaultTarget()).details };
    }
    if (/FROM ShipmentDate/.test(text)) {
      const target = Object.values(targets).find(row => row.detailKey === param(params, 'sdk'));
      return { recordset: target?.dates || [] };
    }
    if (/FROM OrderMaster om/.test(text)) {
      const key = targetKey(param(params, 'yr'), param(params, 'wk'), param(params, 'ck'), param(params, 'pk'));
      return { recordset: (targets[key] || defaultTarget()).orders };
    }
    if (/SELECT u\.UserID FROM UserInfo/.test(text) || /SELECT UserID FROM UserInfo/.test(text)) {
      const key = targetKey(param(params, 'yr'), param(params, 'wk'), param(params, 'ck'), param(params, 'pk'));
      return { recordset: (targets[key] || defaultTarget()).managerRows };
    }
    if (/FROM sys\.columns/.test(text)) return { recordset: [{ is_computed: 0 }] };
    if (/SELECT ISNULL\(MAX\(/.test(text)) return { recordset: [{ nk: 900001 }] };
    if (/OUTPUT INSERTED\.SdateKey/.test(text)) {
      writes.push({ kind: 'insert', table: 'ShipmentDate', params });
      return { recordset: [{ SdateKey: 990001 }] };
    }
    if (/INSERT INTO SystemActionLog/.test(text)) {
      writes.push({ kind: 'insert', table: 'SystemActionLog', params });
      logs.push({ SessionId: param(params, 'op'), Actor: param(params, 'uid'), Result: 'SUCCESS', Payload: param(params, 'payload') });
      return { recordset: [] };
    }
    if (/^INSERT INTO|^IF EXISTS|^UPDATE |^DELETE /.test(text)) {
      writes.push({ kind: 'insert', table: text.match(/^INSERT INTO\s+([\w.]+)/)?.[1] || 'unknown', params });
      return { recordset: [] };
    }
    throw new Error(`unknown fixture SQL: ${text}`);
  };
  return { tQ, calls, writes, logs };
}

function overflowPlan({ currentRemain = 0, nextRemain = 10, source = {}, target = defaultTarget(), targetWeek = '36-02', targetProdKey = 1239 } = {}) {
  const row = sourceRow(source);
  const query = makeQuery({
    facts: baseFacts({ currentRemain, nextRemain, prodKey: row.ProdKey }),
    targets: { [targetKey(row.OrderYear, targetWeek, row.CustKey, targetProdKey)]: target },
  });
  const change = {
    row,
    item: { sdateKey: row.SdateKey, quantity: 20, unit: row.EstUnit },
    newDateOutQuantity: 20,
    newDateEstQuantity: 20,
  };
  const group = { row, changes: [change], fixed: true, oldDetailOutQuantity: row.DetailOutQuantity };
  return { query, row, group };
}

function assertNoWrites(query, message = 'planner must not write') {
  assert.equal(query.writes.length, 0, message);
  assert.equal(query.calls.some(call => /\b(INSERT|UPDATE|DELETE)\b/i.test(call.text)), false, `${message}: mutating SQL was observed`);
}

function expectCode(promise, code) {
  return assert.rejects(promise, error => error?.code === code, `expected ${code}`);
}

// The JSON fixture is executable evidence, not just documentation.
assert.equal(cases.id, 'estimate-next-subweek-overflow-cases');
assert.equal(cases.scenarios.length, 11);
for (const id of ['current-exhausted-next-capacity', 'current-partial-carries-next', 'next-capacity-shortfall', 'negative-prior-stock', 'duplicate-default-dates', 'invalid-default-date', 'cross-year-same-week-isolation', 'multiple-products-share-capacity']) {
  assert.ok(cases.scenarios.some(row => row.id === id), `fixture scenario missing: ${id}`);
}

assert.equal(nextEstimateSubweek('36-01'), '36-02');
assert.equal(nextEstimateSubweek('36-02'), '36-03');
assert.throws(() => nextEstimateSubweek('36-03'), /다음 세부차수/);

{
  const first = cases.scenarios.find(row => row.id === 'current-exhausted-next-capacity');
  const result = splitEstimateIncrease({ increase: first.request.increase, currentRemain: first.current.remaining, nextRemain: first.next.remaining });
  assert.deepEqual(result, { currentIncrease: 0, nextIncrease: 10, currentOut: 0, nextOut: 10 });
  assert.equal(first.expected.carryCalculation.nextRemainingAfter, 0);
}
{
  const partial = cases.scenarios.find(row => row.id === 'current-partial-carries-next');
  const result = splitEstimateIncrease({ increase: partial.request.increase, currentRemain: partial.current.remaining, nextRemain: partial.next.remaining });
  assert.deepEqual(result, { currentIncrease: 4, nextIncrease: 6, currentOut: 4, nextOut: 6 });
  assert.equal(partial.expected.carryCalculation.nextRemainingAfter, 0, 'whole increase is subtracted from next remaining');
}
await expectCode(Promise.resolve().then(() => splitEstimateIncrease({ increase: 10, currentRemain: 0, nextRemain: 9 })), 'OVERFLOW_STOCK_SHORTAGE');

{
  const { query, group } = overflowPlan({ currentRemain: 10, nextRemain: 10 });
  const result = await planEstimateOverflow(query.tQ, sql, [group]);
  assert.equal(result.preview.required, false);
  assert.equal(result.plan[0].changes[0].newDateOutQuantity, 20);
  assertNoWrites(query, 'preview/no-overflow path');
}

{
  const { query, group } = overflowPlan({ currentRemain: 4, nextRemain: 10 });
  const result = await planEstimateOverflow(query.tQ, sql, [group]);
  assert.equal(result.preview.required, true);
  assert.equal(result.preview.rows[0].currentIncrease, 4);
  assert.equal(result.preview.rows[0].nextIncrease, 6);
  assert.equal(result.preview.rows[0].toWeek, '36-02');
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].newDetail, true);
  assert.equal(result.targets[0].newDate, true);
  assert.equal(result.targets[0].newDetailOutQuantity, 6);
  assert.equal(result.targets[0].row.DetailIsFix, 1, 'new target detail is fixed only through the explicitly confirmed plan');
  assert.equal(result.targets[0].row.MasterIsFix, 1, 'target master must already be fixed; no implicit confirmation');
  assertNoWrites(query, 'overflow planning is read-only');
}

{
  const { query, group } = overflowPlan({ currentRemain: 0, nextRemain: 9 });
  await expectCode(planEstimateOverflow(query.tQ, sql, [group]), 'OVERFLOW_STOCK_SHORTAGE');
  assertNoWrites(query, 'shortage planning is read-only');
}

{
  const source = sourceRow({ OrderYear: '2026', OrderWeek: '36-01' });
  const query = makeQuery({ facts: {
    ...baseFacts({ currentRemain: 0, nextRemain: 10, year: '2026' }),
    ...baseFacts({ currentRemain: 99, nextRemain: 99, year: '2025' }),
  } });
  const result = await planEstimateOverflow(query.tQ, sql, [{
    row: source,
    changes: [{ row: source, item: { sdateKey: source.SdateKey, quantity: 20, unit: '단' }, newDateOutQuantity: 20, newDateEstQuantity: 20 }],
    fixed: true,
    oldDetailOutQuantity: source.DetailOutQuantity,
  }]);
  assert.equal(result.preview.rows[0].nextIncrease, 10);
  const factQueries = query.calls.filter(call => /MasterCount/.test(call.text));
  assert.deepEqual(factQueries.map(call => param(call.params, 'yr')), ['2026', '2026']);
}

{
  const target = defaultTarget({
    detailKey: 36021,
    details: [{ SdetailKey: 36021, DetailOutQuantity: 10, DetailEstQuantity: 10, DetailBoxQuantity: 1, DetailBunchQuantity: 10, DetailSteamQuantity: 10, DetailCost: 700, DetailAmount: 70000, DetailVat: 7000, DetailIsFix: 1 }],
    dates: [
      { SdateKey: 360211, ShipmentDtm: '2026-09-03T00:00:00.000Z', DateShipmentQuantity: 4, DateEstQuantity: 4, DateCost: 700, DateDescr: 'default' },
      { SdateKey: 360212, ShipmentDtm: '2026-09-04T00:00:00.000Z', DateShipmentQuantity: 6, DateEstQuantity: 6, DateCost: 700, DateDescr: 'preserve' },
    ],
    orders: [{ OrderMasterKey: 36020, OrderDetailKey: 360201, OutQuantity: 4 }],
  });
  const { query, group } = overflowPlan({ currentRemain: 0, nextRemain: 10, target });
  const result = await planEstimateOverflow(query.tQ, sql, [group]);
  assert.equal(result.targets[0].newDetail, false);
  assert.equal(result.targets[0].newDate, false);
  assert.equal(result.targets[0].allDates.length, 2);
  assert.equal(result.targets[0].allDates[1].DateDescr, 'preserve');
  assert.equal(result.targets[0].orders[0].OutQuantity, 4);
  assert.equal(query.calls.some(call => /FROM UserInfo/.test(call.text)), false, 'existing positive next order needs no new manager lookup');
  assertNoWrites(query, 'existing two-date target planning');
}

{
  const duplicatePeriod = defaultTarget({ periodRows: [
    { BaseYmd: '2026-09-03T00:00:00.000Z', CustName: 'Fixture Customer', Manager: 'admin', OrderCode: 'FIX' },
    { BaseYmd: '2026-09-03T00:00:00.000Z', CustName: 'Fixture Customer', Manager: 'admin', OrderCode: 'FIX' },
  ] });
  const { query, group } = overflowPlan({ currentRemain: 0, nextRemain: 10, target: duplicatePeriod });
  await assert.rejects(planEstimateOverflow(query.tQ, sql, [group]), /기본 출고일/);
  assertNoWrites(query, 'duplicate PeriodDay is fail-closed');
}

{
  const missingPeriod = defaultTarget({ periodRows: [] });
  const { query, group } = overflowPlan({ currentRemain: 0, nextRemain: 10, target: missingPeriod });
  await assert.rejects(planEstimateOverflow(query.tQ, sql, [group]), /기본 출고일/);
  assertNoWrites(query, 'missing PeriodDay is fail-closed');
}

{
  const unfixed = defaultTarget({ masters: [{ ShipmentKey: 3602, isFix: 0 }] });
  const { query, group } = overflowPlan({ currentRemain: 0, nextRemain: 10, target: unfixed });
  await assert.rejects(planEstimateOverflow(query.tQ, sql, [group]), /미확정/);
  assertNoWrites(query, 'unfixed target is never auto-confirmed');
}

{
  const source = sourceRow({ OutUnit: '단', EstUnit: '송이', BunchOf1Box: 10, SteamOf1Bunch: 10, SteamOf1Box: 100, DateShipmentQuantity: 1, DateEstQuantity: 10, DetailOutQuantity: 1, DetailEstQuantity: 10 });
  const rowChange = { row: source, item: { sdateKey: source.SdateKey, quantity: 30, unit: '송이' }, newDateOutQuantity: 3, newDateEstQuantity: 30 };
  const query = makeQuery({ facts: baseFacts({ currentRemain: 0, nextRemain: 2 }) });
  const result = await planEstimateOverflow(query.tQ, sql, [{ row: source, changes: [rowChange], fixed: true, oldDetailOutQuantity: 1 }]);
  assert.equal(result.preview.rows[0].nextIncrease, 20);
  assert.equal(result.preview.rows[0].nextQuantity, undefined);
  assert.equal(result.targets[0].newDetailOutQuantity, 2);
  assertNoWrites(query, 'unit round-trip planning');
}

{
  const shared = cases.scenarios.find(row => row.id === 'multiple-products-share-capacity');
  let current = shared.capacityPools.current.remaining;
  let next = shared.capacityPools.next.remaining;
  const allocations = shared.requests.map(request => {
    const currentPart = Math.min(current, request.increase);
    const nextPart = Math.min(next, request.increase - currentPart);
    current -= currentPart;
    next -= nextPart;
    return { prodKey: request.prodKey, current: currentPart, next: nextPart, unallocated: request.increase - currentPart - nextPart };
  });
  assert.deepEqual(allocations, shared.expected.allocations);
  assert.deepEqual({ current, next }, shared.expected.capacityAfter);
}

// Materialization/verification use a stateful mock and a rollback wrapper; no MSSQL connection is opened.
{
  const state = { inserted: [], rolledBack: false };
  const { query, group } = overflowPlan({ currentRemain: 4, nextRemain: 10 });
  const planned = await planEstimateOverflow(query.tQ, sql, [group]);
  const before = JSON.stringify(state);
  const writeQuery = makeQuery({ failOn: /INSERT INTO ShipmentDate/ });
  const transactionalTQ = async (...args) => {
    try {
      const result = await writeQuery.tQ(...args);
      if (/INSERT INTO/.test(String(args[0]))) state.inserted.push(String(args[0]));
      return result;
    } catch (error) {
      state.inserted = JSON.parse(before).inserted;
      state.rolledBack = true;
      throw error;
    }
  };
  await assert.rejects(materializeOverflowTargets(transactionalTQ, sql, planned.targets, 'admin'), /fixture forced transaction failure/);
  assert.equal(state.rolledBack, true);
  assert.deepEqual(state.inserted, []);
}

{
  const target = {
    row: { OrderYear: '2026', OrderWeek: '36-02', CustKey: 533, ProdKey: 1239, SdetailKey: 990001 },
    newDetailOutQuantity: 10,
    newDetail: false,
    newDate: false,
    changes: [],
  };
  const verifyQuery = makeQuery();
  verifyQuery.tQ = async (statement, params = {}) => {
    const text = String(statement).replace(/\s+/g, ' ').trim();
    verifyQuery.calls.push({ text, params });
    if (/FROM ViewShipment vs/.test(text)) return { recordset: [{ SdetailKey: 990001, OutQuantity: 10, DetailFix: 1, DateVisible: 1, OrderVisible: 1 }] };
    throw new Error(`unknown verification SQL: ${text}`);
  };
  await verifyOverflowTargets(verifyQuery.tQ, sql, [target]);
}

{
  const logs = [];
  const query = makeQuery({ logs });
  const body = { orderYear: '2026', custKey: 533, items: [{ sdateKey: 88237, quantity: 60 }] };
  const result = { success: true, updatedCount: 1 };
  await recordOverflowResult(query.tQ, sql, { ...body, overflowOperationId: operationId }, 'admin', result);
  validateOverflowOperationId(operationId);
  assert.deepEqual(await readOverflowResult(query.tQ, sql, {
    operationId, userId: 'admin', orderYear: '2026', custKey: 533, requestHash: overflowRequestHash(body), lock: true,
  }), result);
  await expectCode(readOverflowResult(query.tQ, sql, {
    operationId, userId: 'admin', orderYear: '2026', custKey: 533, requestHash: overflowRequestHash({ ...body, items: [{ sdateKey: 88237, quantity: 61 }] }),
  }), 'OVERFLOW_OPERATION_CONFLICT');
  assert.throws(() => validateOverflowOperationId('not-a-uuid'), /작업 식별자/);
}

console.log('estimateOverflow tests passed');
