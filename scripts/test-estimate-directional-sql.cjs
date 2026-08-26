#!/usr/bin/env node
/*
 * Isolated, real-MSSQL fixture harness for the 2026-08-26 estimate directional
 * quantity work. It deliberately does not know the upcoming helper's API. A
 * main-task adapter must inject that helper while keeping every SQL operation in
 * the transaction supplied by this file.
 *
 * Usage:
 *   node scripts/test-estimate-directional-sql.cjs --adapter <repo-relative.cjs|mjs>
 *   node scripts/test-estimate-directional-sql.cjs --help
 *
 * Adapter contract (the adapter is not part of this mechanical fixture change):
 *   export async function createAdapter(ctx) => ({
 *     contract: {
 *       actualHandler: true, transactionBoundTQ: true, withAuthStub: true,
 *       auditStub: true, leaseStub: true,
 *       locking: { ownerToken: true, enterBeforeTry: true,
 *         leaveAfterCommitOrRollback: true, failureHook: true }
 *     },
 *     async run({ operation, fromOutQuantity, toOutQuantity, cost, nativeCalcShouldFail })
 *   })
 *   operation is one of: decrease, increase, priceOnly, zero.
 *   The adapter must invoke the actual Locke helper/API handler through VM or
 *   dependency injection. It may only use ctx.fixture.transactionContext().tQ,
 *   ctx.audit, ctx.lease, and ctx.nativeCalc; it must not reimplement save logic
 *   or import lib/db directly. Sol's gate-v2 contract is checked by the locking
 *   capability flags before any SQL test is allowed to run.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const sql = require('mssql');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const DB_PREFIX = 'NenovaEstimateFixture_';
const YEAR = '2026';
const WEEK = '34-02';
const CUST_KEY = 1;
const PROD_KEY = 1;
const SDETAIL_KEY = 2601;
const SDATE_KEY = 2601;
const SENTINEL_DETAIL_KEY = 2501;
const UNRELATED_DETAIL_KEY = 2602;
const SCHEMA_FILE = path.join(REPO_ROOT, '__tests__', 'fixtures', 'estimateDirectionalSchema.sql');
const NATIVE_BACKUP = path.join(REPO_ROOT, 'docs', 'migrations', 'backup_usp_StockCalculation_2026-08-23_before_stock_week_gate.sql');

function usage() {
  console.log('Usage: node scripts/test-estimate-directional-sql.cjs [--adapter <repo-relative adapter>] [--keep-db]');
  console.log('Default adapter: scripts/fixtures/estimateDirectionalApiAdapter.cjs');
}

function fail(message) {
  throw new Error(`[estimate-directional-fixture] ${message}`);
}

function parseArgs(argv) {
  const args = { keepDb: false, adapter: 'scripts/fixtures/estimateDirectionalApiAdapter.cjs' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    if (argv[i] === '--keep-db') { args.keepDb = true; continue; }
    if (argv[i] === '--adapter') {
      args.adapter = argv[++i];
      if (!args.adapter) fail('--adapter requires a path');
      continue;
    }
    fail(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function inspectApprovedContainer() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved fixture container is not inspectable');
  let info;
  try { info = JSON.parse(result.stdout)[0]; } catch { fail('fixture container inspect response is invalid'); }
  if (!info || info.Name !== `/${CONTAINER}`) fail('container name guard failed');
  if (!info.State?.Running) fail('fixture container is not running');
  if (!/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || ''))) {
    fail('container image is not official SQL Server 2022');
  }
  if ((info.Mounts || []).length !== 0 || (info.HostConfig?.Binds || []).length !== 0) {
    fail('fixture container has a mount; refusing to connect');
  }
  const bindings = info.HostConfig?.PortBindings?.['1433/tcp'] || [];
  if (!bindings.some((b) => b.HostIp === HOST && String(b.HostPort) === String(PORT))) {
    fail('fixture port binding guard failed');
  }
  const env = new Map((info.Config?.Env || []).map((entry) => {
    const at = String(entry).indexOf('=');
    return [at < 0 ? String(entry) : entry.slice(0, at), at < 0 ? '' : entry.slice(at + 1)];
  }));
  const password = env.get('MSSQL_SA_PASSWORD');
  if (!password) fail('fixture SA password is missing');
  return { password, image: info.Config.Image };
}

function assertDatabaseName(name) {
  if (!/^NenovaEstimateFixture_[0-9]{8}_[0-9a-f]{8}$/.test(name)) {
    fail('database name guard failed');
  }
}

function newDatabaseName() {
  const stamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 8);
  const suffix = crypto.randomBytes(4).toString('hex');
  const name = `${DB_PREFIX}${stamp}_${suffix}`;
  assertDatabaseName(name);
  return name;
}

function bracketIdentifier(name) {
  assertDatabaseName(name);
  return `[${name.replace(/]/g, ']]')}]`;
}

function splitBatches(text) {
  return text.split(/^\s*GO\s*;?\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
}

function inferType(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? sql.Int : sql.Float;
  if (typeof value === 'boolean') return sql.Bit;
  return sql.NVarChar;
}

function requestFor(executor, params = {}) {
  const request = new sql.Request(executor);
  for (const [name, spec] of Object.entries(params)) {
    const item = spec && Object.prototype.hasOwnProperty.call(spec, 'value') ? spec : { value: spec };
    request.input(name, item.type || inferType(item.value), item.value);
  }
  return request;
}

async function query(executor, statement, params = {}) {
  return requestFor(executor, params).query(statement);
}

async function withTransaction(pool, fn) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  let committed = false;
  try {
    const value = await fn(tx);
    await tx.commit();
    committed = true;
    return value;
  } finally {
    if (!committed) await tx.rollback().catch(() => {});
  }
}

function makeTQuery(executor) {
  return (statement, params = {}) => query(executor, statement, params);
}

function createFixtureStubs() {
  return {
    withAuth(handler) {
      if (typeof handler !== 'function') fail('withAuth stub received a non-function handler');
      return handler;
    },
    gateContract: {
      version: 'owner-token-v2-seam',
      ownerToken: true,
      enterBeforeTry: true,
      leaveAfterCommitOrRollback: true,
      failureHook: true,
    },
  };
}

function validateAdapterContract(adapter) {
  assert(adapter && typeof adapter.run === 'function', 'adapter must export createAdapter(ctx) with run(input)');
  const contract = adapter.contract || {};
  for (const key of ['actualHandler', 'transactionBoundTQ', 'withAuthStub', 'auditStub', 'leaseStub']) {
    assert(contract[key] === true, `adapter contract missing ${key}=true`);
  }
  for (const key of ['ownerToken', 'enterBeforeTry', 'leaveAfterCommitOrRollback', 'failureHook']) {
    assert(contract.locking?.[key] === true, `adapter locking contract missing ${key}=true`);
  }
}

function invokeApiHandler(handler, { method = 'POST', url = '/api/estimate/update-date-quantity', body = {}, user = { userId: 'admin' } } = {}) {
  if (typeof handler !== 'function') fail('actual API adapter must provide a callable handler');
  return new Promise((resolve, reject) => {
    let settled = false;
    let statusCode = 200;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({ statusCode, body: value });
    };
    const res = {
      status(code) { statusCode = Number(code) || 200; return this; },
      json(value) { finish(value); return this; },
      send(value) { finish(value); return this; },
      end(value) { finish(value); return this; },
      setHeader() { return this; },
    };
    const req = { method, url, body, user, headers: {}, query: {} };
    Promise.resolve(handler(req, res)).then((value) => {
      if (!settled && value !== undefined) finish(value);
    }).catch(reject);
  });
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(6));
  return value;
}

function normalizeRow(row) {
  return Object.fromEntries(Object.keys(row).sort().map((key) => [key, normalizeValue(row[key])]));
}

const TABLES = [
  'UserInfo', 'Customer', 'Farm', 'Product', 'OrderMaster', 'OrderDetail',
  'ShipmentMaster', 'ShipmentDetail', 'ShipmentDate', 'ShipmentFarm',
  'ShipmentHistory', 'Estimate', 'WarehouseMaster', 'WarehouseDetail',
  'StockMaster', 'ProductStock', 'StockHistory', 'CodeInfo',
  'FixtureNativeCalcControl', 'NenovaStockWeekGate', 'FixtureAudit',
  'AppLog', 'SystemActionLog', 'WebErpEditLease',
];

async function snapshot(pool) {
  const result = {};
  for (const table of TABLES) {
    const rows = (await query(pool, `SELECT * FROM dbo.[${table}]`)).recordset.map(normalizeRow);
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    result[table] = rows;
  }
  return result;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message}\nexpected=${e}\nactual=${a}`);
}

function isTrueBit(value) {
  return value === true || value === 1;
}

function findOne(snapshotValue, table, predicate, message = `${table} row not found`) {
  const row = (snapshotValue[table] || []).find(predicate);
  assert(row, message);
  return row;
}

function rowsFor(snapshotValue, table, predicate) {
  return (snapshotValue[table] || []).filter(predicate);
}

function scenarioValues(options = {}) {
  const fixed = options.fixed === false ? 0 : 1;
  const incoming = options.incoming == null ? 20 : Number(options.incoming);
  const liveStock = options.liveStock == null ? (fixed ? incoming - 10 : incoming) : Number(options.liveStock);
  const currentSnapshot = options.currentSnapshot == null ? (fixed ? incoming - 10 : incoming) : Number(options.currentSnapshot);
  for (const [name, value] of Object.entries({ incoming, liveStock, currentSnapshot })) {
    if (!Number.isFinite(value)) fail(`invalid fixture ${name}`);
  }
  return {
    fixed,
    incoming,
    liveStock,
    currentSnapshot,
    withFarm: Boolean(options.withFarm),
    withTwoDates: Boolean(options.withTwoDates),
    sameProductTwoDetails: Boolean(options.sameProductTwoDetails),
  };
}

async function resetFixture(pool, options = {}) {
  const scenario = scenarioValues(options);
  await withTransaction(pool, async (tx) => {
    for (const table of [...TABLES].reverse()) await query(tx, `DELETE FROM dbo.[${table}]`);
    await query(tx, `
      INSERT dbo.UserInfo (UserID,UserName) VALUES (N'admin',N'관리자');
      INSERT dbo.Customer (CustKey,CustName) VALUES (1,N'Fixture Customer'),(2,N'Fixture Other Customer');
      INSERT dbo.Farm (FarmKey,FarmName) VALUES (1,N'Fixture Farm');
      INSERT dbo.Product (ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
        VALUES (1,N'Fixture Rose',N'Rose',N'Fixture Country',N'Rose',N'단',N'송이',16,16,16,700,@liveStock),
               (2,N'Unrelated Category',N'Orchid',N'Fixture Country',N'Orchid',N'단',N'송이',10,1,10,500,5);
      INSERT dbo.OrderMaster (OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager)
        VALUES (202601,@year,@week,N'202634',1,N'admin'),
               (202501,N'2025',@week,N'202534',1,N'admin'),
               (202602,@year,@week,N'202634',2,N'admin');
      INSERT dbo.OrderDetail (OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,OrderQuantity)
        VALUES (202601,202601,1,1,0.04,10,160,10,10),(202501,202501,1,1,0.04,7,112,7,7),(202602,202602,2,2,0.05,5,50,5,5);
      INSERT dbo.ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
        VALUES (2601,@year,@week,N'202634',1,@fixed,0,1,N'admin'),
               (2501,N'2025',@week,N'202534',1,0,0,1,N'admin'),
               (2602,@year,@week,N'202634',2,1,0,1,N'admin');
      INSERT dbo.ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix)
        VALUES (2601,2601,1,1,10,160,0.04,10,160,700,101818,10182,N'fixture target',CONVERT(datetime,'2026-08-20T12:00:00'),@fixed),
               (2501,2501,1,1,7,112,0,7,112,700,71273,7127,N'prior-year sentinel',CONVERT(datetime,'2025-08-20T12:00:00'),0),
               (2602,2602,2,2,5,50,0,5,50,500,22727,2273,N'unrelated category',CONVERT(datetime,'2026-08-20T12:00:00'),1);
      INSERT dbo.ShipmentDate (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
        VALUES (2601,2601,CONVERT(datetime,'2026-08-20T12:00:00'),10,160,700,101818,10182,N'fixture date'),
               (2501,2501,CONVERT(datetime,'2025-08-20T12:00:00'),7,112,700,71273,7127,N'prior-year date'),
               (2602,2602,CONVERT(datetime,'2026-08-20T12:00:00'),5,50,500,22727,2273,N'unrelated date');
      INSERT dbo.Estimate (EstimateKey,ShipmentKey,ProdKey,EstimateType,Unit,SdetailKey,Quantity,Cost,Amount,Vat,isFix,Descr,EstimateDtm)
        VALUES (2601,2601,1,N'견적',N'송이',2601,160,700,101818,10182,@fixed,N'fixture estimate',CONVERT(datetime,'2026-08-20T12:00:00'));
      INSERT dbo.WarehouseMaster (WarehouseKey,OrderYear,OrderWeek,UploadDtm,FileName)
        VALUES (2601,@year,@week,CONVERT(datetime,'2026-08-19T12:00:00'),N'fixture-in.xlsx'),
               (2501,N'2025',@week,CONVERT(datetime,'2025-08-19T12:00:00'),N'prior-in.xlsx');
      INSERT dbo.WarehouseDetail (WdetailKey,WarehouseKey,ProdKey,FarmKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch)
        VALUES (2601,2601,1,NULL,0,@incoming,@incoming,@incoming,@incoming,700,@incoming*700,16,1),
               (2501,2501,1,NULL,0,0,0,0,0,700,0,16,1);
      INSERT dbo.StockMaster (StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
        VALUES (2501,N'2025',@week,N'20253402',1,N'admin'),(2601,@year,@week,N'20263402',1,N'admin'),(2603,@year,@week,N'20263403',1,N'admin');
      INSERT dbo.ProductStock (StockKey,ProdKey,Stock)
        VALUES (2501,1,0),(2501,2,5),(2601,1,@currentSnapshot),(2601,2,5),(2603,1,@currentSnapshot),(2603,2,5);
      INSERT dbo.CodeInfo (Category,Descr) VALUES (N'StockType',N'재고조정');
      INSERT dbo.FixtureNativeCalcControl (ControlKey,FailNext,FailureMessage)
        VALUES (1,0,N'fixture forced native calculation failure');
      INSERT dbo.NenovaStockWeekGate (GateKey,Mode) VALUES ('1',NULL);`, {
      year: { type: sql.NVarChar, value: YEAR },
      week: { type: sql.NVarChar, value: WEEK },
      liveStock: { type: sql.Float, value: scenario.liveStock },
      fixed: { type: sql.Bit, value: scenario.fixed },
      incoming: { type: sql.Float, value: scenario.incoming },
      currentSnapshot: { type: sql.Float, value: scenario.currentSnapshot },
    });
    if (scenario.withTwoDates) {
      await query(tx, `UPDATE dbo.ShipmentDate SET ShipmentQuantity=6,EstQuantity=96,Amount=61091,Vat=6109 WHERE SdateKey=2601;
        INSERT dbo.ShipmentDate (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
        VALUES (2604,2601,CONVERT(datetime,'2026-08-21T12:00:00'),4,64,700,40727,4073,N'fixture date two');`);
    }
    if (scenario.sameProductTwoDetails) {
      await query(tx, `INSERT dbo.ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
        VALUES (2605,@year,@week,N'202634',1,@fixed,0,1,N'admin');
        INSERT dbo.ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix)
        VALUES (2605,2605,1,1,10,160,0.04,10,160,700,101818,10182,N'fixture same-product scope',CONVERT(datetime,'2026-08-20T13:00:00'),@fixed);
        INSERT dbo.ShipmentDate (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
        VALUES (2605,2605,CONVERT(datetime,'2026-08-20T13:00:00'),10,160,700,101818,10182,N'fixture same-product date');`, {
        year: { type: sql.NVarChar, value: YEAR },
        week: { type: sql.NVarChar, value: WEEK },
        fixed: { type: sql.Bit, value: scenario.fixed },
      });
    }
    if (scenario.withFarm) {
      await query(tx, `INSERT dbo.ShipmentFarm (FarmKey,ShipmentQuantity,SdetailKey,Descr) VALUES (1,10,2601,N'fixture farm')`);
    }
  });
  return scenario;
}

async function forceNativeFailure(pool) {
  await query(pool, `UPDATE dbo.FixtureNativeCalcControl SET FailNext=1 WHERE ControlKey=1`);
}

async function forceNativeNull(pool) {
  await query(pool, `UPDATE dbo.FixtureNativeCalcControl SET NullNext=1 WHERE ControlKey=1`);
}

async function gateState(pool) {
  return (await query(pool, `SELECT Mode,OwnerToken,Action,OrderYear,OrderWeek FROM dbo.NenovaStockWeekGate WHERE GateKey='1'`)).recordset[0] || {};
}

function expectedTarget(snapshotValue) {
  return {
    detail: findOne(snapshotValue, 'ShipmentDetail', (r) => r.SdetailKey === SDETAIL_KEY),
    date: findOne(snapshotValue, 'ShipmentDate', (r) => r.SdateKey === SDATE_KEY),
    product: findOne(snapshotValue, 'Product', (r) => r.ProdKey === PROD_KEY),
    stock: findOne(snapshotValue, 'ProductStock', (r) => r.StockKey === 2601 && r.ProdKey === PROD_KEY),
  };
}

function compareStableFields(before, after, fields, label) {
  for (const field of fields) assertDeepEqual(after[field], before[field], `${label}: ${field} changed`);
}

async function invoke(adapter, input) {
  if (!adapter || typeof adapter.run !== 'function') fail('adapter must export createAdapter(ctx) with run(input)');
  return adapter.run(input);
}

async function expectReject(fn, label) {
  let rejected = false;
  try { await fn(); } catch { rejected = true; }
  assert(rejected, `${label}: expected a rejected operation`);
}

async function expectRejectCode(fn, label, expectedCode) {
  try {
    await fn();
  } catch (error) {
    assert(error?.code === expectedCode, `${label}: expected ${expectedCode}, got ${error?.code || 'no-code'} (${error?.message || 'no-error-message'})`);
    return;
  }
  fail(`${label}: expected rejection code ${expectedCode}`);
}

async function runTests(ctx, adapter) {
  const fixture = ctx.fixture;
  const common = { year: YEAR, week: WEEK, custKey: CUST_KEY, prodKey: PROD_KEY, sdetailKey: SDETAIL_KEY, sdateKey: SDATE_KEY };

  await fixture.reset();
  let before = await fixture.snapshot();
  const seeded = expectedTarget(before);
  assert(seeded.detail.OutQuantity === 10 && seeded.detail.EstQuantity === 160
    && seeded.detail.Cost === 700 && seeded.detail.Amount === 101818 && seeded.detail.Vat === 10182,
  'seed must match the synthetic 34-02 quantity/cost baseline');
  assert(seeded.date.ShipmentQuantity === 10 && seeded.date.EstQuantity === 160,
    'seed date row must match the synthetic baseline');
  assert(rowsFor(before, 'OrderDetail', (r) => r.OrderDetailKey === 202601).length === 1,
    'seed must have one target order row');
  assert(rowsFor(before, 'ShipmentFarm', (r) => r.SdetailKey === SDETAIL_KEY).length === 0,
    'seed must have zero target farm rows');

  const ownerB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const entered = await query(ctx.pool, `DECLARE @r int,@m nvarchar(200),@a uniqueidentifier;
    EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'CALC',@OrderYear=@yr,@OrderWeek=@wk,
      @oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,@OwnerToken=@a OUTPUT,@CalcProdKey=1;
    SELECT @r AS result,@m AS message,@a AS ownerToken;`, {
    yr: { type: sql.NVarChar, value: YEAR }, wk: { type: sql.NVarChar, value: WEEK },
  });
  assert(Number(entered.recordset?.[0]?.result) === 0, 'gate owner A must acquire the idle singleton');
  const ownerA = String(entered.recordset?.[0]?.ownerToken || '');
  assert(ownerA.length > 0, 'gate enter must return a new owner token');
  const wrongLeave = await query(ctx.pool, `DECLARE @r int,@owner uniqueidentifier=CONVERT(uniqueidentifier,@b);
    EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'CALC',@Success=0,@ProtocolVersion=2,
      @OwnerToken=@owner,@oResult=@r OUTPUT;
    SELECT @r AS result;`, { b: { type: sql.NVarChar, value: ownerB } });
  assert(Number(wrongLeave.recordset?.[0]?.result) === -98, 'gate must reject a different owner token');
  const ownedGate = await gateState(ctx.pool);
  assert(String(ownedGate.OwnerToken) === ownerA && ownedGate.Mode === 'RUN', 'wrong owner must not clear the active gate');
  const clearOwned = await query(ctx.pool, `DECLARE @r int,@owner uniqueidentifier=CONVERT(uniqueidentifier,@a);
    EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'CALC',@Success=1,@ProtocolVersion=2,
      @OwnerToken=@owner,@oResult=@r OUTPUT;
    SELECT @r AS result;`, { a: { type: sql.NVarChar, value: ownerA } });
  assert(Number(clearOwned.recordset?.[0]?.result) === 0, 'same owner must be able to release the gate');

  await invoke(adapter, { operation: 'decrease', ...common, fromOutQuantity: 10, toOutQuantity: 9 });
  let after = await fixture.snapshot();
  let targetBefore = expectedTarget(before);
  let targetAfter = expectedTarget(after);
  assert(targetAfter.detail.OutQuantity === 9 && targetAfter.date.ShipmentQuantity === 9, 'decrease must update detail/date quantity');
  assert(isTrueBit(targetAfter.detail.isFix), 'decrease must preserve fixed state');
  assert(targetAfter.product.Stock === 11, 'fixed decrease must return one unit to Product.Stock');
  await invoke(adapter, { operation: 'increase', ...common, fromOutQuantity: 9, toOutQuantity: 10 });
  const roundTrip = expectedTarget(await fixture.snapshot());
  for (const field of ['OutQuantity','EstQuantity','Amount','Vat','isFix']) assertDeepEqual(roundTrip.detail[field], targetBefore.detail[field], `round-trip detail ${field}`);
  for (const field of ['ShipmentQuantity','EstQuantity','Amount','Vat']) assertDeepEqual(roundTrip.date[field], targetBefore.date[field], `round-trip date ${field}`);
  assertDeepEqual(roundTrip.product.Stock, targetBefore.product.Stock, 'round-trip Product.Stock');
  assertDeepEqual(roundTrip.stock.Stock, targetBefore.stock.Stock, 'round-trip ProductStock');

  await fixture.reset();
  before = await fixture.snapshot();
  const priceBefore = expectedTarget(before);
  await invoke(adapter, { operation: 'priceOnly', ...common, fromOutQuantity: 10, toOutQuantity: 10, cost: 701 });
  after = await fixture.snapshot();
  const priceAfter = expectedTarget(after);
  compareStableFields(priceBefore.detail, priceAfter.detail, ['OutQuantity','EstQuantity','isFix'], 'price-only detail');
  compareStableFields(priceBefore.date, priceAfter.date, ['ShipmentQuantity','EstQuantity'], 'price-only date');
  assertDeepEqual(priceAfter.product.Stock, priceBefore.product.Stock, 'price-only Product.Stock');
  assertDeepEqual(priceAfter.stock.Stock, priceBefore.stock.Stock, 'price-only ProductStock');

  // A decrease is allowed even when the current and recalculated future
  // snapshots remain negative; the post-calc shortage guard is increase-only.
  await fixture.reset({ incoming: 0, liveStock: -3, currentSnapshot: -3 });
  await invoke(adapter, { operation: 'decrease', ...common, fromOutQuantity: 10, toOutQuantity: 9 });
  assert(expectedTarget(await fixture.snapshot()).product.Stock === -2, 'decrease must be allowed with existing negative stock');

  // SQL Server floating noise around zero is allowed by the same predicate
  // used by the handler: ROUND(ps.Stock,3)<0.
  const noisePolicy = await fixture.query(`DECLARE @noise float = -0.00000000000003;
    SELECT ROUND(@noise,3) AS roundedStock,
           CASE WHEN ROUND(@noise,3)<0 THEN 1 ELSE 0 END AS isNegative;`);
  assert(Number(noisePolicy.recordset?.[0]?.roundedStock) === 0
    && Number(noisePolicy.recordset?.[0]?.isNegative) === 0,
  'floating stock noise near zero must be allowed by the SQL negative predicate');

  // A real -0.001 shortage must still be rejected by the directional API,
  // with the specific scarcity code rather than a generic infrastructure error.
  await fixture.reset({ fixed: false, incoming: 10.009, liveStock: 10.009, currentSnapshot: 10.009 });
  before = await fixture.snapshot();
  await expectRejectCode(() => invoke(adapter, {
    operation: 'increase', ...common, fromOutQuantity: 10, toOutQuantity: 10.01,
  }), 'negative 0.001 shortage', 'STOCK_SHORTAGE');
  assertDeepEqual(await fixture.snapshot(), before, 'negative 0.001 shortage must roll back exact rows');

  // The old unfixed total is part of the availability calculation. With only
  // five incoming units, 10 -> 11 must reject rather than checking only +1.
  await fixture.reset({ fixed: false, incoming: 5, liveStock: 5, currentSnapshot: 5 });
  before = await fixture.snapshot();
  await expectRejectCode(() => invoke(adapter, { operation: 'increase', ...common, fromOutQuantity: 10, toOutQuantity: 11 }), 'unfixed increase with insufficient total stock', 'STOCK_SHORTAGE');
  assertDeepEqual(await fixture.snapshot(), before, 'unfixed insufficient increase must roll back exact rows');

  // A valid unfixed increase must proceed. It changes only the physical/date
  // rows: isFix, Product.Stock, and ProductStock are untouched and no native
  // stock recalculation is invoked for this non-fixed scope.
  await fixture.reset({ fixed: false, incoming: 20, liveStock: 10, currentSnapshot: 10 });
  before = await fixture.snapshot();
  const unfixedBefore = expectedTarget(before);
  await invoke(adapter, { operation: 'increase', ...common, fromOutQuantity: 10, toOutQuantity: 11 });
  after = await fixture.snapshot();
  const unfixedAfter = expectedTarget(after);
  assert(unfixedAfter.detail.OutQuantity === 11 && unfixedAfter.date.ShipmentQuantity === 11, 'unfixed increase must update physical quantities');
  assert(!isTrueBit(unfixedAfter.detail.isFix), 'unfixed increase must preserve isFix=0');
  assertDeepEqual(unfixedAfter.product.Stock, unfixedBefore.product.Stock, 'unfixed increase must not change Product.Stock');
  assertDeepEqual(unfixedAfter.stock.Stock, unfixedBefore.stock.Stock, 'unfixed increase must not invoke ProductStock calculation');

  // Two increases for the same product/scope are aggregated, not checked as
  // independent one-unit requests. Each +1 would fit a one-unit remainder,
  // but the combined +2 must reject with the scarcity code.
  await fixture.reset({ fixed: false, incoming: 1, liveStock: 1, currentSnapshot: 1, sameProductTwoDetails: true });
  before = await fixture.snapshot();
  await expectRejectCode(() => invoke(adapter, {
    operation: 'increase',
    ...common,
    fromOutQuantity: 10,
    toOutQuantity: 11,
    dateItems: [
      { sdateKey: 2601, fromOutQuantity: 10, toOutQuantity: 11 },
      { sdateKey: 2605, fromOutQuantity: 10, toOutQuantity: 11, expectedOldDescr: 'fixture same-product date' },
    ],
  }), 'same-product combined increase', 'STOCK_SHORTAGE');
  assertDeepEqual(await fixture.snapshot(), before, 'same-product combined shortage must roll back exact rows');

  // Two selected dates must write two independently dated history rows.
  await fixture.reset({ withTwoDates: true });
  before = await fixture.snapshot();
  await invoke(adapter, {
    operation: 'decrease',
    ...common,
    fromOutQuantity: 10,
    toOutQuantity: 8,
    dateItems: [
      { sdateKey: 2601, fromOutQuantity: 6, toOutQuantity: 5 },
      { sdateKey: 2604, fromOutQuantity: 4, toOutQuantity: 3 },
    ],
  });
  after = await fixture.snapshot();
  const dateHistory = rowsFor(after, 'ShipmentHistory', (r) => r.SdetailKey === SDETAIL_KEY);
  assert(dateHistory.length === 2, 'two changed dates must create two ShipmentHistory rows');
  const historyByBefore = new Map(dateHistory.map((row) => [String(row.BeforeValue), row]));
  assert(String(historyByBefore.get('6')?.AfterValue) === '5', 'first date history quantity is incorrect');
  assert(String(historyByBefore.get('4')?.AfterValue) === '3', 'second date history quantity is incorrect');
  assert(new Date(historyByBefore.get('6').ShipmentDtm).toISOString().startsWith('2026-08-20T12:00'), 'first date history date is incorrect');
  assert(new Date(historyByBefore.get('4').ShipmentDtm).toISOString().startsWith('2026-08-21T12:00'), 'second date history date is incorrect');

  // A native procedure that returns null outputs is not a successful result.
  await fixture.reset();
  await fixture.setNativeCalcNull();
  before = await fixture.snapshot();
  await expectReject(() => invoke(adapter, { operation: 'decrease', ...common, fromOutQuantity: 10, toOutQuantity: 9, nativeCalcShouldBeNull: true }), 'null native calculation output');
  assertDeepEqual(await fixture.snapshot(), before, 'null native output must roll back exact rows');
  assert((await gateState(ctx.pool)).Mode == null, 'null native output must release its gate through rollback');

  await fixture.reset({ incoming: 0, liveStock: 0, currentSnapshot: 0 });
  before = await fixture.snapshot();
  await expectRejectCode(() => invoke(adapter, { operation: 'increase', ...common, fromOutQuantity: 10, toOutQuantity: 11 }), 'insufficient increase', 'STOCK_SHORTAGE');
  assertDeepEqual(await fixture.snapshot(), before, 'insufficient increase must roll back exact rows');
  assert((await gateState(ctx.pool)).Mode == null, 'insufficient increase must leave gate free');

  await fixture.reset();
  await forceNativeFailure(ctx.pool);
  before = await fixture.snapshot();
  await expectReject(() => invoke(adapter, { operation: 'decrease', ...common, fromOutQuantity: 10, toOutQuantity: 9, nativeCalcShouldFail: true }), 'forced native calculation error');
  assertDeepEqual(await fixture.snapshot(), before, 'native calculation error must roll back exact rows');
  const releasedGate = await gateState(ctx.pool);
  assert(releasedGate.Mode == null && releasedGate.OwnerToken == null, 'native calculation error must release only its own gate lease');

  await fixture.reset({ fixed: true, withFarm: true });
  before = await fixture.snapshot();
  const orderRowsBefore = rowsFor(before, 'OrderDetail', (r) => r.OrderDetailKey === 202601);
  await invoke(adapter, { operation: 'zero', ...common, fromOutQuantity: 10, toOutQuantity: 0 });
  after = await fixture.snapshot();
  assertDeepEqual(rowsFor(after, 'OrderDetail', (r) => r.OrderDetailKey === 202601), orderRowsBefore, 'zero purge must preserve OrderDetail');
  assert(rowsFor(after, 'ShipmentDetail', (r) => r.SdetailKey === SDETAIL_KEY).length === 0, 'zero purge must remove ShipmentDetail');
  assert(rowsFor(after, 'ShipmentDate', (r) => r.SdateKey === SDATE_KEY).length === 0, 'zero purge must remove ShipmentDate');
  assert(rowsFor(after, 'ShipmentFarm', (r) => r.SdetailKey === SDETAIL_KEY).length === 0, 'zero purge must remove ShipmentFarm');
  assert(findOne(after, 'Product', (r) => r.ProdKey === PROD_KEY).Stock === 20, 'zero purge must return fixed quantity to Product.Stock');
  assert(findOne(after, 'ProductStock', (r) => r.StockKey === 2601 && r.ProdKey === PROD_KEY).Stock === 20, 'zero purge must recalculate ProductStock after native calculation');

  await fixture.reset();
  before = await fixture.snapshot();
  const priorBefore = rowsFor(before, 'ShipmentDetail', (r) => r.SdetailKey === SENTINEL_DETAIL_KEY);
  const unrelatedBefore = rowsFor(before, 'ShipmentDetail', (r) => r.SdetailKey === UNRELATED_DETAIL_KEY);
  await invoke(adapter, { operation: 'decrease', ...common, fromOutQuantity: 10, toOutQuantity: 9 });
  after = await fixture.snapshot();
  assertDeepEqual(rowsFor(after, 'ShipmentDetail', (r) => r.SdetailKey === SENTINEL_DETAIL_KEY), priorBefore, 'prior-year same-week sentinel changed');
  assertDeepEqual(rowsFor(after, 'ShipmentDetail', (r) => r.SdetailKey === UNRELATED_DETAIL_KEY), unrelatedBefore, 'unrelated category changed');
  assert(await query(ctx.pool, `SELECT COUNT(*) AS cnt FROM dbo.CodeInfo WHERE Category=N'StockType' AND Descr=N'출고'`).then((r) => Number(r.recordset[0].cnt) === 0), 'StockType fixture must exclude 출고');
  console.log('PASS: directional SQL fixture scenarios (real SQL transactions)');
}

async function loadAdapter(adapterPath, ctx) {
  const absolute = path.resolve(REPO_ROOT, adapterPath);
  if (!absolute.startsWith(`${REPO_ROOT}${path.sep}`)) fail('adapter must be inside the exact workspace');
  if (!fs.existsSync(absolute)) fail(`adapter not found: ${adapterPath}`);
  const loaded = await import(pathToFileURL(absolute).href);
  const factory = loaded.createAdapter || loaded.default?.createAdapter || loaded.default;
  if (typeof factory !== 'function') fail('adapter must export createAdapter(ctx)');
  return factory(ctx);
}

function validateNativeBackup() {
  if (!fs.existsSync(NATIVE_BACKUP)) fail('native StockCalculation backup is missing');
  const source = fs.readFileSync(NATIVE_BACKUP, 'utf8');
  for (const marker of ['usp_StockCalculation', '@OrderYear', '@OrderWeek', '@ProdKey', 'StockMaster', 'ProductStock', 'ViewWarehouse', 'ViewShipment', 'StockHistory', 'CodeInfo']) {
    assert(source.includes(marker), `native backup comparison marker missing: ${marker}`);
  }
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
}

async function installExactNativeCalculator(pool) {
  const source = fs.readFileSync(NATIVE_BACKUP, 'utf8');
  const reference = source.replace(
    /CREATE\s+PROCEDURE\s+\[dbo\]\.\[usp_StockCalculation\]/i,
    'CREATE PROCEDURE dbo.usp_StockCalculation_Reference',
  );
  if (reference === source) fail('native backup procedure declaration was not found');
  await query(pool, `IF OBJECT_ID(N'dbo.usp_StockCalculation_Reference', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation_Reference;`);
  for (const batch of splitBatches(reference)) await query(pool, batch);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  const nativeDigest = validateNativeBackup();
  const { password, image } = inspectApprovedContainer();
  const dbName = newDatabaseName();
  assertDatabaseName(dbName);
  let master;
  let pool;
  try {
    master = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database: 'master', options: { encrypt: false, trustServerCertificate: true }, pool: { max: 2, min: 0 } }).connect();
    await query(master, `CREATE DATABASE ${bracketIdentifier(dbName)}`);
    await query(master, `ALTER DATABASE ${bracketIdentifier(dbName)} SET COMPATIBILITY_LEVEL = 130`);
    pool = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database: dbName, options: { encrypt: false, trustServerCertificate: true }, pool: { max: 4, min: 0 } }).connect();
    for (const batch of splitBatches(fs.readFileSync(SCHEMA_FILE, 'utf8'))) await query(pool, batch);
    await installExactNativeCalculator(pool);
    const fixture = {
      pool,
      query: (statement, params) => query(pool, statement, params),
      transaction: (fn) => withTransaction(pool, fn),
      transactionContext: (fn) => withTransaction(pool, (tx) => fn({ tx, tQ: makeTQuery(tx) })),
      reset: (options) => resetFixture(pool, options),
      snapshot: () => snapshot(pool),
      setNativeCalcFailure: () => forceNativeFailure(pool),
      setNativeCalcNull: () => forceNativeNull(pool),
      gateState: () => gateState(pool),
    };
    const nativeCalc = {
      callInTransaction: async ({ tx, orderYear = YEAR, orderWeek = WEEK, prodKey = 0, userId = 'admin' } = {}) => {
        const result = await query(tx, `DECLARE @r int, @m nvarchar(max);
          EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
          SELECT ISNULL(@r,0) AS result,@m AS message;`, {
          yr: { type: sql.NVarChar, value: orderYear }, wk: { type: sql.NVarChar, value: orderWeek },
          pk: { type: sql.Int, value: prodKey }, uid: { type: sql.NVarChar, value: userId },
        });
        const row = result.recordset?.[0] || {};
        if (Number(row.result) !== 0) throw new Error(String(row.message || 'native fixture calculation failed'));
        return row;
      },
      forceFailure: () => forceNativeFailure(pool),
    };
    const stubs = createFixtureStubs();
    const audit = {
      write: async (tQ, entry = {}) => {
        const next = await tQ('SELECT ISNULL(MAX(AuditKey),0)+1 AS nextKey FROM dbo.FixtureAudit');
        await tQ(`INSERT dbo.FixtureAudit (AuditKey,ActionName,OwnerToken,Detail)
          VALUES (@key,@action,@owner,@detail)`, {
          key: { type: sql.Int, value: Number(next.recordset?.[0]?.nextKey || 1) },
          action: { type: sql.NVarChar, value: String(entry.action || 'adapter').slice(0, 100) },
          owner: { type: sql.NVarChar, value: entry.ownerToken || null },
          detail: { type: sql.NVarChar, value: JSON.stringify(entry.detail || {}).slice(0, 1000) },
        });
      },
    };
    const lease = {
      contract: stubs.gateContract,
      enter: async (tQ, { action = 'CALC', year = YEAR, week = WEEK, ownerToken }) => {
        const result = await tQ(`DECLARE @r int,@m nvarchar(200),@newOwner uniqueidentifier;
          EXEC dbo.usp_NenovaStockWeekGateEnter @Action=@action,@OrderYear=@yr,@OrderWeek=@wk,
            @oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,
            @OwnerToken=@newOwner OUTPUT,@CalcProdKey=@pk;
          SELECT @r AS result,@m AS message,@newOwner AS ownerToken;`, {
          action: { type: sql.NVarChar, value: action }, yr: { type: sql.NVarChar, value: year },
          wk: { type: sql.NVarChar, value: week }, pk: { type: sql.Int, value: 0 },
        });
        const row = result.recordset?.[0] || {};
        if (Number(row.result) !== 0) throw new Error(String(row.message || 'fixture lease enter failed'));
        return row;
      },
      leave: async (tQ, { action = 'CALC', success = false, ownerToken }) => {
        const result = await tQ(`DECLARE @r int,@owner uniqueidentifier=CONVERT(uniqueidentifier,@ownerInput);
          EXEC dbo.usp_NenovaStockWeekGateLeave @Action=@action,@Success=@success,@ProtocolVersion=2,
            @OwnerToken=@owner,@oResult=@r OUTPUT;
          SELECT @r AS result;`, {
          action: { type: sql.NVarChar, value: action }, success: { type: sql.Bit, value: success ? 1 : 0 },
          ownerInput: { type: sql.NVarChar, value: ownerToken },
        });
        const row = result.recordset?.[0] || {};
        if (Number(row.result) !== 0) throw new Error(String(row.message || 'fixture lease leave failed'));
        return row;
      },
    };
    const ctx = {
      sql, pool, database: dbName, fixture, nativeCalc, audit, lease,
      stubs,
      invokeApiHandler,
      constants: { YEAR, WEEK, CUST_KEY, PROD_KEY, SDETAIL_KEY, SDATE_KEY },
    };
    const adapter = await loadAdapter(args.adapter, ctx);
    validateAdapterContract(adapter);
    console.log(`SETUP: image=${image}, host=${HOST}:${PORT}, database=${dbName}, compatibility=130, nativeBackupSha256=${nativeDigest}`);
    await runTests(ctx, adapter);
    if (!args.keepDb) await query(master, `ALTER DATABASE ${bracketIdentifier(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${bracketIdentifier(dbName)}`);
    else console.log(`KEEP_DB: ${dbName}`);
  } finally {
    await pool?.close().catch(() => {});
    await master?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
