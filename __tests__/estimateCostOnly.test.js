// Run only: node __tests__/estimateCostOnly.test.js
// Executes the production helper against a transaction-bound SQL fake; no DB/env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeEstimateCostOnly, normalizeEstimateCostRequest } from '../lib/estimateCostOnly.js';
import { amountVatFromCostEst } from '../lib/distributeUnits.js';

const clone = (value) => structuredClone(value);
const sql = { Int: 'Int', Float: 'Float', NVarChar: 'NVarChar' };
const dt = new Date('2026-08-20T00:00:00.000Z');
const schema = {
  // Live sys.columns, not the stale doc: no ShipmentMaster.ShipmentDtm.
  ShipmentMaster: ['ShipmentKey', 'OrderYear', 'CustKey', 'OrderWeek', 'OrderYearWeek', 'isFix', 'isDeleted', 'EstimateName', 'LastUpdateID', 'LastUpdateDtm'],
  ShipmentDetail: ['SdetailKey', 'ShipmentKey', 'CustKey', 'ProdKey', 'OutQuantity', 'BoxQuantity', 'BunchQuantity', 'SteamQuantity', 'EstQuantity', 'EstQuantity2', 'ShipmentDtm', 'isFix', 'Descr', 'EstDescr', 'Cost', 'Amount', 'Vat'],
  ShipmentDate: ['SdateKey', 'SdetailKey', 'ShipmentDtm', 'ShipmentQuantity', 'EstQuantity', 'Descr', 'Cost', 'Amount', 'Vat'],
  Estimate: ['EstimateKey', 'ShipmentKey', 'ProdKey', 'Quantity', 'Unit', 'EstimateType', 'EstimateDtm', 'Descr', 'Cost', 'Amount', 'Vat'],
  CustomerProdCost: ['AutoKey', 'CustKey', 'ProdKey', 'Cost', 'Descr'],
  WeekProdCost: ['AutoKey', 'OrderYear', 'OrderWeek', 'CustKey', 'ProdKey', 'Cost', 'UpdatedAt', 'UpdatedBy'],
};

function fixture() {
  const master = (ShipmentKey, OrderYear = '2026', OrderWeek = '34-01', CustKey = 515, isFix = true) => ({
    ShipmentKey, OrderYear, OrderWeek, CustKey, isFix, isDeleted: null,
    OrderYearWeek: `${OrderYear}-${OrderWeek}`, EstimateName: 'keep estimate name', LastUpdateID: null, LastUpdateDtm: dt,
  });
  const detail = (SdetailKey, ShipmentKey, ProdKey, extra = {}) => ({
    SdetailKey, ShipmentKey, CustKey: 515, ProdKey,
    OutQuantity: 99.75, BoxQuantity: null, BunchQuantity: 20.5, SteamQuantity: 205,
    EstQuantity: 5.17, ShipmentDtm: dt, isFix: true, Descr: 'keep detail', Cost: 11400, Amount: 30, Vat: 3,
    EstQuantity2: 17.25, EstDescr: 'keep estimate note',
    ...extra,
  });
  const date = (SdateKey, SdetailKey, Cost, EstQuantity) => ({
    SdateKey, SdetailKey, Cost, EstQuantity, ShipmentDtm: dt, ShipmentQuantity: 50.125,
    Descr: null, Amount: 10, Vat: 1,
  });
  return {
    ShipmentMaster: [master(101, '2025'), master(102), master(103, '2026', '34-02', 515, 1), master(104, '2026', '34-01', 999), master(105, '2026', '35-01')],
    ShipmentDetail: [detail(1, 102, 11), detail(2, 102, 12, { isFix: null, EstQuantity: null, EstQuantity2: null, EstDescr: null }), detail(3, 103, 11), detail(4, 101, 11), detail(5, 104, 11), detail(6, 105, 11), detail(7, 102, 11, { isFix: false })],
    ShipmentDate: [date(11, 1, 0, 1.6), date(12, 1, 8000, 3.57), date(13, 2, null, null), date(31, 3, 11400, 5.17), date(41, 4, 11400, 5.17), date(71, 7, 11400, 5.17)],
    Estimate: [{ EstimateKey: 91, ShipmentKey: 102, ProdKey: 99, Quantity: -3.4, Unit: '단', EstimateType: '차감', EstimateDtm: dt, Descr: 'legacy text', Cost: 700, Amount: -2000, Vat: -100 }],
    CustomerProdCost: [{ AutoKey: 201, CustKey: 515, ProdKey: 11, Cost: 3000, Descr: 'preserve baseline description' }, { AutoKey: 202, CustKey: 999, ProdKey: 11, Cost: 5555, Descr: 'other customer' }],
    WeekProdCost: [{ AutoKey: 301, OrderYear: '2025', OrderWeek: '34-01', CustKey: 515, ProdKey: 11, Cost: 4000, UpdatedAt: dt, UpdatedBy: 'old' }],
    // Sentinels: the fake refuses even a query against any stock/order/farm table.
    Product: [{ ProdKey: 11, Stock: 100 }], ProductStock: [{ Stock: 99 }], StockHistory: [], StockMaster: [{ isFix: null }],
    OrderDetail: [{ OutQuantity: 5 }], ShipmentFarm: [{ ShipmentQuantity: 5 }], WebProfitReport: [{ Amount: 999 }],
    revision: 7,
  };
}

const item = (extra = {}) => ({ shipmentKey: 102, sdetailKey: 1, cost: 12700, expectedOldCost: 11400, ...extra });
const request = (items = [item()], extra = {}) => ({ orderYear: '2026', week: '34-01', custKey: 515, mode: 'once', items, ...extra });
const isWrite = (statement) => /^(UPDATE|INSERT|MERGE)\b/i.test(statement);

function database(initial = fixture(), options = {}) {
  let committed = clone(initial);
  const log = [];
  const events = [];
  let rollbacks = 0;
  let commits = 0;
  async function save(body) {
    const working = clone(committed);
    const tQ = async (raw, params = {}) => {
      const statement = raw.replace(/\s+/g, ' ').trim();
      const p = Object.fromEntries(Object.entries(params).map(([key, param]) => [key, param.value]));
      log.push({ statement, params: clone(p) });
      events.push(statement);
      assert.doesNotMatch(statement, /\b(EXEC|CREATE|ALTER|DROP|DELETE)\b/i);
      if (statement.startsWith('SELECT CASE WHEN OBJECT_ID')) return { recordset: [{ ok: options.schemaMissing ? 0 : 1 }] };
      const table = statement.match(/^(?:SELECT .*? FROM|UPDATE|INSERT INTO|MERGE INTO) (\w+)/i)?.[1];
      assert.ok(schema[table], `Unexpected/forbidden table or SQL: ${statement}`);
      const matches = (row) => {
        if (table === 'ShipmentMaster') return row.ShipmentKey === p.sk && !row.isDeleted;
        if (table === 'ShipmentDetail') return row.SdetailKey === p.sdk && row.ShipmentKey === p.sk;
        if (table === 'ShipmentDate') return row.SdetailKey === p.sdk && (p.dk == null || row.SdateKey === p.dk);
        if (table === 'Estimate') return row.EstimateKey === p.ek && (p.sk == null || row.ShipmentKey === p.sk);
        if (table === 'CustomerProdCost') return row.CustKey === p.ck && row.ProdKey === p.pk && (p.ak == null || row.AutoKey === p.ak);
        return row.OrderYear === p.yr && row.OrderWeek === p.wk && row.CustKey === p.ck && row.ProdKey === p.pk;
      };
      if (statement.startsWith('SELECT ')) {
        if (!(table === 'Estimate' && p.sk == null)) assert.match(statement, /WITH \(UPDLOCK, HOLDLOCK\)/);
        const columns = statement.match(/^SELECT (.*?) FROM/)[1].split(',').map((col) => col.trim());
        for (const col of columns) assert.ok(schema[table].includes(col), `Invented column ${table}.${col}`);
        return { recordset: working[table].filter(matches).map((row) => clone(Object.fromEntries(columns.map((col) => [col, row[col]])))) };
      }
      if (options.failWriteTable === table) throw new Error(`injected write failure: ${table}`);
      if (statement.startsWith('UPDATE ')) {
        const fields = statement.match(/ SET (.*?) WHERE/)[1].split(',').map((entry) => entry.trim().split('='));
        const allowed = table === 'CustomerProdCost' ? ['Cost'] : ['Cost', 'Amount', 'Vat'];
        assert.deepEqual(fields.map(([column]) => column), allowed, 'SQL must only SET allowed money columns');
        for (const row of working[table].filter(matches)) {
          for (const [column, param] of fields) row[column] = p[param.slice(1)];
          if (table === 'Estimate') row.Descr = 'sanitized legacy';
        }
      } else if (statement.startsWith('INSERT INTO CustomerProdCost')) {
        working.CustomerProdCost.push({ AutoKey: 1000 + working.CustomerProdCost.length, CustKey: p.ck, ProdKey: p.pk, Cost: p.cost, Descr: null });
      } else if (statement.startsWith('MERGE INTO WeekProdCost')) {
        assert.match(statement, /WITH \(HOLDLOCK\)/);
        assert.match(statement, /t\.OrderYear=s\.OrderYear AND t\.OrderWeek=s\.OrderWeek/);
        const found = working.WeekProdCost.find(matches);
        if (found) Object.assign(found, { Cost: p.cost, UpdatedAt: dt, UpdatedBy: p.uid });
        else working.WeekProdCost.push({ AutoKey: 2000 + working.WeekProdCost.length, OrderYear: p.yr, OrderWeek: p.wk, CustKey: p.ck, ProdKey: p.pk, Cost: p.cost, UpdatedBy: p.uid, UpdatedAt: dt });
      } else assert.fail(`Unexpected write: ${statement}`);
      options.afterWrite?.(working, table, p);
      return { recordset: [], rowsAffected: [1] };
    };
    try {
      const result = await executeEstimateCostOnly(tQ, body, {
        sql, user: { userId: 'tester' },
        assertEditGuard: async (executor, scope, user, input) => {
          assert.equal(executor, tQ);
          const firstLockedSk = log.find((entry) => /FROM ShipmentMaster/.test(entry.statement)).params.sk;
          const actualWeek = working.ShipmentMaster.find((row) => row.ShipmentKey === firstLockedSk).OrderWeek;
          assert.deepEqual(scope, { orderYear: '2026', orderWeek: actualWeek, custKey: 515 });
          assert.match(scope.orderWeek, /^34-/);
          assert.equal(input, body);
          assert.equal(user.userId, 'tester');
          assert.ok(!log.some((entry) => isWrite(entry.statement)));
          events.push('assertGuard');
          if (options.guardError) throw Object.assign(new Error(options.guardError), { code: options.guardError });
        },
        advanceEditGuard: async (executor, scope, user, input) => {
          assert.equal(executor, tQ);
          assert.equal(input, body);
          events.push('advanceGuard');
          if (options.advanceFailure) throw new Error('lease advance failed');
          if (body.editGuard) working.revision++;
          return { editDigestAfter: body.editGuard ? 'after-digest' : null, revision: body.editGuard ? working.revision : null };
        },
      });
      committed = working;
      commits++;
      return result;
    } catch (err) {
      rollbacks++;
      throw err;
    }
  }
  return { save, log, events, get state() { return clone(committed); }, get rollbacks() { return rollbacks; }, get commits() { return commits; } };
}

function withoutMoney(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !['Cost', 'Amount', 'Vat'].includes(key)));
}
async function rejectedUnchanged(db, body, code) {
  const before = db.state;
  await assert.rejects(db.save(body), code ? { code } : undefined);
  assert.deepEqual(db.state, before, 'every failed batch must roll back all ledger and baseline writes');
  assert.equal(db.rollbacks, 1);
}

test('fixed 34-01 saves with later 34-02 fixed; raw flags/quantities/dates and unrelated ledgers preserved', async () => {
  const db = database();
  const before = db.state;
  const result = await db.save(request([item(), item({ sdetailKey: 2, cost: 0 }), item({ sdetailKey: 7, cost: 500 })]));
  const after = db.state;
  assert.equal(result.changedCount, 3);
  assert.deepEqual(result.fixedShipmentKeys, [102]);
  assert.equal(result.customerCostUpdated, 0);
  assert.deepEqual(after.ShipmentMaster, before.ShipmentMaster);
  for (const table of ['ShipmentDetail', 'ShipmentDate']) {
    assert.deepEqual(after[table].map(withoutMoney), before[table].map(withoutMoney));
  }
  for (const table of ['Product', 'ProductStock', 'StockHistory', 'StockMaster', 'OrderDetail', 'ShipmentFarm', 'Estimate', 'WebProfitReport', 'CustomerProdCost', 'WeekProdCost']) assert.deepEqual(after[table], before[table]);
  for (const key of [3, 4, 5, 6]) assert.deepEqual(after.ShipmentDetail.find((row) => row.SdetailKey === key), before.ShipmentDetail.find((row) => row.SdetailKey === key));
  assert.equal(after.ShipmentDetail[0].Amount + after.ShipmentDetail[0].Vat, 12700 * 5);
  assert.equal(after.ShipmentDate[0].Amount + after.ShipmentDate[0].Vat, 12700 * 2);
  assert.equal(after.ShipmentDate[1].Amount + after.ShipmentDate[1].Vat, 12700 * 4);
  assert.equal(after.ShipmentDetail[1].EstQuantity, null);
  assert.equal(after.ShipmentDetail[1].Cost, 0);
  assert.equal(db.commits, 1);
  assert.equal(db.events.at(-1), 'advanceGuard');
});

test('every duplicate date baseline is retained; one detail write, distinct stored date quantities', async () => {
  const db = database();
  const result = await db.save(request([item({ sdateKey: 11, expectedOldCost: 0 }), item({ sdateKey: 12, expectedOldCost: 8000 }), item({ sdateKey: 11, expectedOldCost: 0 })]));
  assert.equal(result.changedCount, 1);
  assert.equal(db.log.filter((entry) => entry.statement.startsWith('UPDATE ShipmentDetail')).length, 1);
  assert.equal(db.log.filter((entry) => entry.statement.startsWith('UPDATE ShipmentDate')).length, 2);
});

test('a stale second duplicate is rejected before any write (not deduped away)', async () => {
  const db = database();
  await rejectedUnchanged(db, request([item({ sdateKey: 11, expectedOldCost: 0 }), item({ sdateKey: 12, expectedOldCost: 7999 })]), 'STALE_DATA');
  assert.ok(!db.log.some((entry) => isWrite(entry.statement)));
});

test('DateCost zero/null uses raw date cost, never displayed/detail fallback', async () => {
  const db = database();
  await db.save(request([item({ sdateKey: 11, expectedOldCost: 0, cost: 0 }), item({ sdetailKey: 2, sdateKey: 13, expectedOldCost: 0, cost: 0 })]));
  const staleDb = database();
  await rejectedUnchanged(staleDb, request([item({ sdateKey: 11, expectedOldCost: 11400 })]), 'STALE_DATA');
});

for (const sdateKey of [31, 999]) test(`wrong/deleted SdateKey ${sdateKey} never falls back to detail cost`, async () => {
  await rejectedUnchanged(database(), request([item({ sdateKey, expectedOldCost: 11400 })]), 'STALE_DATA');
});

test('legacy no-date stale check uses Detail.Cost, including duplicate legacy baselines', async () => {
  await database().save(request([item(), item()]));
  await rejectedUnchanged(database(), request([item(), item({ expectedOldCost: 11399 })]), 'STALE_DATA');
});

test('sub-cent raw price change is stale rather than silently tolerated', async () => {
  await rejectedUnchanged(database(), request([item({ expectedOldCost: 11400.0001 })]), 'STALE_DATA');
});

test('different requested prices for the same detail reject the entire batch', async () => {
  await rejectedUnchanged(database(), request([item(), item({ cost: 12701 })]), 'CONFLICTING_COST');
});

test('same product can differ in once mode, but fixed/weekFav must reject conflicts', async () => {
  const items = [item(), item({ sdetailKey: 7, cost: 14000 })];
  await database().save(request(items));
  for (const mode of ['fixed', 'weekFav']) await rejectedUnchanged(database(), request(items, { mode }), 'CONFLICTING_PRODUCT_COST');
});

test('fixed updates existing identity/description and inserts only absent customer-product pair', async () => {
  const db = database();
  const before = db.state;
  const result = await db.save(request([item(), item({ sdetailKey: 7 }), item({ sdetailKey: 2, cost: 0 })], { mode: 'fixed' }));
  assert.equal(result.customerCostUpdated, 2);
  assert.deepEqual(db.state.CustomerProdCost[0], { ...before.CustomerProdCost[0], Cost: 12700 });
  assert.deepEqual(db.state.CustomerProdCost[1], before.CustomerProdCost[1]);
  assert.equal(db.state.CustomerProdCost[2].Cost, 0);
  assert.equal(db.state.CustomerProdCost[2].ProdKey, 12);
  const baselineReads = db.log.filter((entry) => /FROM CustomerProdCost/.test(entry.statement));
  assert.equal(baselineReads.length, 4);
  assert.ok(baselineReads.every((entry) => /UPDLOCK, HOLDLOCK/.test(entry.statement)));
});

test('existing customer-product duplicates reject before money writes, even equal prices', async () => {
  const state = fixture();
  state.CustomerProdCost.push({ ...state.CustomerProdCost[0], AutoKey: 203 });
  const db = database(state);
  await rejectedUnchanged(db, request([item()], { mode: 'fixed' }), 'CUSTOMER_COST_DUPLICATE');
  assert.ok(!db.log.some((entry) => isWrite(entry.statement)));
});

test('designated price write failure rolls back detail/date amounts too', async () => {
  const db = database(fixture(), { failWriteTable: 'CustomerProdCost' });
  await rejectedUnchanged(db, request([item()], { mode: 'fixed' }));
  assert.ok(db.log.some((entry) => entry.statement.startsWith('UPDATE ShipmentDate')));
});

test('Estimate negative quantity/missing parent compatibility; legacy Descr trigger allowed, no baseline write', async () => {
  const db = database();
  const before = db.state;
  const result = await db.save(request([{ estimateKey: 91, cost: 3333, expectedOldCost: 700 }], { mode: 'fixed' }));
  const saved = db.state.Estimate[0];
  assert.equal(saved.Quantity, -3.4);
  assert.equal(saved.Amount + saved.Vat, 3333 * -3);
  assert.equal(saved.Descr, 'sanitized legacy');
  for (const key of ['EstimateKey', 'ShipmentKey', 'ProdKey', 'Unit', 'EstimateType', 'EstimateDtm']) assert.deepEqual(saved[key], before.Estimate[0][key]);
  assert.equal(result.customerCostUpdated, 0);
  assert.equal(result.customerCostSkippedEstimate, 1);
  assert.equal(result.changes[0].source, 'Estimate');
  assert.deepEqual(db.state.CustomerProdCost, before.CustomerProdCost);
  assert.ok(!db.log.some((entry) => /CustomerProdCost/.test(entry.statement)));
});

test('mixed Estimate/detail fixed mode excludes Estimate product and preserves topSk broadcast', async () => {
  const db = database();
  const result = await db.save(request([
    { sdetailKey: 1, cost: 800, expectedOldCost: 11400 },
    { estimateKey: 91, shipmentKey: null, cost: 900, expectedOldCost: 700 },
  ], { shipmentKey: 102, mode: 'fixed' }));
  assert.equal(result.changedCount, 2);
  assert.equal(result.customerCostUpdated, 1);
  assert.ok(!db.state.CustomerProdCost.some((row) => row.ProdKey === 99));
});

test('weekFav keeps existing mode and explicit year/pair isolation, no runtime DDL', async () => {
  const db = database();
  const before = db.state;
  await db.save(request([item()], { mode: 'weekFav' }));
  assert.deepEqual(db.state.WeekProdCost[0], before.WeekProdCost[0]);
  assert.equal(db.state.WeekProdCost[1].OrderYear, '2026');
  assert.equal(db.state.WeekProdCost[1].Cost, 12700);
  assert.deepEqual(db.state.CustomerProdCost, before.CustomerProdCost);
  assert.equal(db.log.filter((entry) => entry.statement.startsWith('SELECT CASE WHEN OBJECT_ID')).length, 1);
});

test('weekFav year schema absence fails with 503, no writes or DDL', async () => {
  const db = database(fixture(), { schemaMissing: true });
  await assert.rejects(db.save(request([item()], { mode: 'weekFav' })), { code: 'WEEK_PROD_COST_SCHEMA_REQUIRED', status: 503 });
  assert.ok(!db.log.some((entry) => isWrite(entry.statement)));
});

for (const [label, body] of [
  ['previous-year same week', request([item({ shipmentKey: 101, sdetailKey: 4 })])],
  ['other customer', request([item({ shipmentKey: 104, sdetailKey: 5 })])],
  ['wrong detail parent', request([item({ sdetailKey: 3 })])],
  ['multiple parent weeks', request([item(), item({ shipmentKey: 105, sdetailKey: 6 })])],
  ['request parent mismatch', request([item()], { week: '35-01' })],
  ['wrong Estimate parent', request([{ estimateKey: 91, shipmentKey: 103, cost: 800 }])],
]) test(`scope near-miss: ${label}`, async () => {
  await rejectedUnchanged(database(), body, 'ESTIMATE_SCOPE_MISMATCH');
});

test('deleted master blocks regardless of valid keys', async () => {
  const state = fixture();
  state.ShipmentMaster[1].isDeleted = true;
  await rejectedUnchanged(database(state), request(), 'ESTIMATE_SCOPE_MISMATCH');
});

for (const [label, badItem] of [
  ['junk key', item({ sdetailKey: '1x' })], ['fractional key', item({ sdetailKey: 1.2 })],
  ['overflow key', item({ sdetailKey: 2147483648 })], ['zero key', item({ sdetailKey: 0 })],
  ['boolean key', item({ shipmentKey: true })], ['both source keys', item({ estimateKey: 91 })],
  ['neither source key', { shipmentKey: 102, cost: 1 }], ['negative price', item({ cost: -1 })],
  ['infinite price', item({ cost: Infinity })], ['junk price', item({ cost: '12oops' })],
  ['null price', item({ cost: null })], ['empty price', item({ cost: '' })],
  ['NaN baseline', item({ expectedOldCost: NaN })], ['date without baseline', item({ sdateKey: 11, expectedOldCost: undefined })],
  ['Estimate with date', { estimateKey: 91, sdateKey: 11, cost: 1, expectedOldCost: 0 }],
]) test(`input near-miss: ${label}`, async () => {
  const db = database();
  await rejectedUnchanged(db, request([badItem]), 'INVALID_COST_ITEM');
  assert.equal(db.log.length, 0);
});

test('zero price/numeric strings supported; missing year/cust/mode/week rejected', () => {
  assert.equal(normalizeEstimateCostRequest(request([item({ sdetailKey: '1', cost: '0' })])).items[0].cost, 0);
  for (const changes of [{ orderYear: undefined }, { custKey: 0 }, { custKey: true }, { mode: 'unknown' }, { mode: 'weekFav', week: null }]) assert.throws(() => normalizeEstimateCostRequest(request([item()], changes)));
});

for (const guardError of ['ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID']) test(`broad editGuard rejection remains atomic: ${guardError}`, async () => {
  const db = database(fixture(), { guardError });
  await rejectedUnchanged(db, request([item()], { editGuard: { token: 'test' } }), guardError);
  assert.ok(!db.log.some((entry) => isWrite(entry.statement)));
  assert.ok(!db.events.includes('advanceGuard'));
});

test('lease advance same transaction and response; failure rolls back money and baseline', async () => {
  const db = database();
  const result = await db.save(request([item()], { editGuard: { token: 'test' }, mode: 'fixed' }));
  assert.equal(result.revision, 8);
  assert.equal(result.editDigestAfter, 'after-digest');
  assert.equal(db.events.at(-1), 'advanceGuard');
  await rejectedUnchanged(database(fixture(), { advanceFailure: true }), request([item()], { mode: 'fixed', editGuard: {} }));
});

for (const [label, mutate] of [
  ['raw null master flag', (s) => { s.ShipmentMaster[1].isFix = null; }],
  ['master year-week identity', (s) => { s.ShipmentMaster[1].OrderYearWeek = '2025-34-01'; }],
  ['master estimate name', (s) => { s.ShipmentMaster[1].EstimateName = 'changed'; }],
  ['master update identity', (s) => { s.ShipmentMaster[1].LastUpdateID = 'changed'; }],
  ['master update timestamp', (s) => { s.ShipmentMaster[1].LastUpdateDtm = new Date('2026-08-21'); }],
  ['raw detail quantity', (s) => { s.ShipmentDetail[0].OutQuantity++; }],
  ['null quantity normalization', (s) => { s.ShipmentDetail[0].BoxQuantity = 0; }],
  ['detail estimated quantity', (s) => { s.ShipmentDetail[0].EstQuantity = 5; }],
  ['detail secondary estimated quantity', (s) => { s.ShipmentDetail[0].EstQuantity2 = 0; }],
  ['detail estimate note', (s) => { s.ShipmentDetail[0].EstDescr = 'changed'; }],
  ['detail note', (s) => { s.ShipmentDetail[0].Descr = 'changed'; }],
  ['date shipment quantity', (s) => { s.ShipmentDate[0].ShipmentQuantity = 0; }],
  ['date estimated quantity', (s) => { s.ShipmentDate[0].EstQuantity = 2; }],
  ['date timestamp', (s) => { s.ShipmentDate[0].ShipmentDtm = new Date('2026-08-21'); }],
  ['date money', (s) => { s.ShipmentDate[0].Amount++; }],
  ['extra date', (s) => { s.ShipmentDate.push({ ...s.ShipmentDate[0], SdateKey: 9999 }); }],
  ['missing date', (s) => { s.ShipmentDate = s.ShipmentDate.filter((row) => row.SdateKey !== 11); }],
]) test(`readback mismatch rolls back: ${label}`, async () => {
  const db = database(fixture(), { afterWrite: (state, table, p) => { if (table === 'ShipmentDate' && p.dk === 12) mutate(state); } });
  await rejectedUnchanged(db, request(), 'COST_READBACK_MISMATCH');
});

test('customer identity/description readback mismatch rolls back all amounts', async () => {
  for (const field of ['AutoKey', 'Descr']) {
    const db = database(fixture(), { afterWrite: (state, table) => { if (table === 'CustomerProdCost') state.CustomerProdCost[0][field] = field === 'AutoKey' ? 999 : 'changed'; } });
    await rejectedUnchanged(db, request([item()], { mode: 'fixed' }), 'COST_READBACK_MISMATCH');
  }
});

test('money uses canonical helper including fractional/negative quantities; nonfinite overflow rejects', async () => {
  const db = database();
  await db.save(request([item({ cost: 3333 })]));
  const expected = amountVatFromCostEst(3333, 5.17);
  assert.equal(db.state.ShipmentDetail[0].Amount, expected.amount);
  assert.equal(db.state.ShipmentDetail[0].Vat, expected.vat);
  await rejectedUnchanged(database(), request([item({ cost: Number.MAX_VALUE })]), 'INVALID_COST_AMOUNT');
});

test('quantity-first alive date requires refreshed successful baseline; old baseline still stale', async () => {
  const state = fixture();
  state.ShipmentDate[0].Cost = 11400;
  state.ShipmentDate[0].EstQuantity = 2.5;
  await rejectedUnchanged(database(state), request([item({ sdateKey: 11, expectedOldCost: 0 })]), 'STALE_DATA');
  const db = database(state);
  await db.save(request([item({ sdateKey: 11, expectedOldCost: 11400 })]));
  assert.equal(db.state.ShipmentDate[0].EstQuantity, 2.5);
});

test('quantity-first deleted date requires explicit surviving-detail baseline; purged detail stays rejected', async () => {
  const state = fixture();
  state.ShipmentDate = state.ShipmentDate.filter((row) => row.SdateKey !== 11);
  await rejectedUnchanged(database(state), request([item({ sdateKey: 11, expectedOldCost: 0 })]), 'STALE_DATA');
  await database(state).save(request([item()]));
  state.ShipmentDetail = state.ShipmentDetail.filter((row) => row.SdetailKey !== 1);
  await rejectedUnchanged(database(state), request(), 'ESTIMATE_SCOPE_MISMATCH');
});

test('Raum legacy once request omits week and date, still validates year/customer/detail cost', async () => {
  const body = request();
  delete body.week;
  const db = database();
  const result = await db.save(body);
  assert.equal(result.changedCount, 1);
  assert.equal(result.revision, null);
  assert.equal(db.state.ShipmentDetail[0].EstQuantity, 5.17);
  assert.ok(!db.log.some((entry) => /WeekProdCost|CustomerProdCost/.test(entry.statement)));
});

test('nullable/zero master flags are preserved while fixed detail price is editable', async () => {
  for (const isFix of [null, false, 0]) {
    const state = fixture();
    state.ShipmentMaster[1].isFix = isFix;
    const db = database(state);
    const result = await db.save(request());
    assert.equal(db.state.ShipmentMaster[1].isFix, isFix);
    assert.equal(db.state.ShipmentDetail[0].isFix, true);
    assert.deepEqual(result.fixedShipmentKeys, []);
  }
});

test('weekFav existing current-year row keeps identity; equal prior-year week is untouched', async () => {
  const state = fixture();
  state.WeekProdCost.push({ ...state.WeekProdCost[0], AutoKey: 302, OrderYear: '2026' });
  const db = database(state);
  await db.save(request([item()], { mode: 'weekFav' }));
  assert.equal(db.state.WeekProdCost.length, 2);
  assert.equal(db.state.WeekProdCost[1].AutoKey, 302);
  assert.equal(db.state.WeekProdCost[1].Cost, 12700);
  assert.deepEqual(db.state.WeekProdCost[0], state.WeekProdCost[0]);
});

test('date write failure rolls back already written detail money', async () => {
  const db = database(fixture(), { failWriteTable: 'ShipmentDate' });
  await rejectedUnchanged(db, request());
  assert.ok(db.log.some((entry) => entry.statement.startsWith('UPDATE ShipmentDetail')));
});
